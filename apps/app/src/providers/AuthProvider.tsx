/**
 * Authentication Provider
 * Manages user authentication state, token storage, and auto-refresh
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { User } from '@huishype/shared';
import { propertyKeys } from '../hooks/useProperties';
import { savedPropertyKeys } from '../hooks/useSavedProperties';
import { API_URL, setApiAccessTokenResolver } from '../utils/api';

// Complete auth session for web
WebBrowser.maybeCompleteAuthSession();

// Storage keys
const ACCESS_TOKEN_KEY = 'huishype_access_token';
const REFRESH_TOKEN_KEY = 'huishype_refresh_token';
const USER_KEY = 'huishype_user';
const TOKEN_EXPIRY_KEY = 'huishype_token_expiry';

const API_BASE_URL = API_URL;

function getGoogleClientId(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';
}

// Types
export interface AuthUser extends User {
  email?: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  authError: string | null;
}

export interface AuthContextValue extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signInWithMockToken: (token: string) => Promise<void>;
  requestEmailLink: (email: string) => Promise<void>;
  verifyEmailToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  updateAuthUserProfile?: (updates: {
    displayName?: string;
    handle?: string;
    profilePhotoUrl?: string | null;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Secure storage helpers with web fallback
async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Use localStorage for web (not truly secure, but acceptable for dev)
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

function extractEmailTokenFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).searchParams.get('emailToken');
  } catch {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
      return null;
    }
    return new URLSearchParams(url.slice(queryIndex + 1)).get('emailToken');
  }
}

async function backfillStoredUserEmail(
  user: AuthUser,
  accessToken: string | null
): Promise<AuthUser> {
  if (user.email || !accessToken) {
    return user;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      return user;
    }

    const data = (await response.json()) as { user: AuthUser };
    if (!data.user.email) {
      return user;
    }

    const hydratedUser = { ...user, ...data.user };
    await setSecureItem(USER_KEY, JSON.stringify(hydratedUser));
    return hydratedUser;
  } catch {
    return user;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

class ExpectedEmailAuthError extends Error {}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    accessToken: null,
    authError: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAuthRef = useRef<() => Promise<boolean>>(null!);
  const authSignatureRef = useRef<string | null>(null);

  /**
   * Schedule token refresh before expiry.
   * Uses refreshAuthRef so the timer always calls the CURRENT refreshAuth,
   * not the one captured at first render (avoids stale closure).
   */
  const scheduleTokenRefresh = useCallback((expiresAt: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    // Refresh 1 minute before expiry
    const refreshTime = expiryTime - now - 60000;

    if (refreshTime > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshAuthRef.current();
      }, refreshTime);
    }
  }, []);

  /**
   * Store auth data securely
   */
  const storeAuthData = useCallback(
    async (
      accessToken: string,
      refreshToken: string,
      user: AuthUser,
      expiresAt: string
    ) => {
      await Promise.all([
        setSecureItem(ACCESS_TOKEN_KEY, accessToken),
        setSecureItem(REFRESH_TOKEN_KEY, refreshToken),
        setSecureItem(USER_KEY, JSON.stringify(user)),
        setSecureItem(TOKEN_EXPIRY_KEY, expiresAt),
      ]);

      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        accessToken,
        authError: null,
      });

      // Schedule token refresh
      scheduleTokenRefresh(expiresAt);
    },
    [scheduleTokenRefresh]
  );

  /**
   * Clear all auth data
   */
  const clearAuthData = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    await Promise.all([
      deleteSecureItem(ACCESS_TOKEN_KEY),
      deleteSecureItem(REFRESH_TOKEN_KEY),
      deleteSecureItem(USER_KEY),
      deleteSecureItem(TOKEN_EXPIRY_KEY),
    ]);

    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      accessToken: null,
      authError: null,
    });
  }, []);

  /**
   * Refresh the access token
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const refreshToken = await getSecureItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        await clearAuthData();
        return false;
      }

      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        await clearAuthData();
        return false;
      }

      const data = (await response.json()) as {
        accessToken: string;
        expiresAt: string;
      };

      await setSecureItem(ACCESS_TOKEN_KEY, data.accessToken);
      await setSecureItem(TOKEN_EXPIRY_KEY, data.expiresAt);

      setState((prev) => ({
        ...prev,
        accessToken: data.accessToken,
      }));

      scheduleTokenRefresh(data.expiresAt);
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await clearAuthData();
      return false;
    }
  }, [clearAuthData, scheduleTokenRefresh]);

  // Keep the ref in sync so scheduleTokenRefresh's timer always calls the latest refreshAuth
  refreshAuthRef.current = refreshAuth;

  /**
   * Get the current access token, refreshing if necessary
   */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const expiry = await getSecureItem(TOKEN_EXPIRY_KEY);
    const token = await getSecureItem(ACCESS_TOKEN_KEY);

    if (!token || !expiry) {
      return null;
    }

    // Check if token is expired or about to expire (within 30 seconds)
    const expiryTime = new Date(expiry).getTime();
    if (Date.now() > expiryTime - 30000) {
      const refreshed = await refreshAuth();
      if (!refreshed) {
        return null;
      }
      return getSecureItem(ACCESS_TOKEN_KEY);
    }

    return token;
  }, [refreshAuth]);

  const updateAuthUserProfile = useCallback(
    async (updates: {
      displayName?: string;
      handle?: string;
      profilePhotoUrl?: string | null;
    }) => {
      if (!state.user) {
        return;
      }

      const nextUser: AuthUser = {
        ...state.user,
        ...(updates.displayName !== undefined
          ? { displayName: updates.displayName }
          : {}),
        ...(updates.profilePhotoUrl !== undefined
          ? { profilePhotoUrl: updates.profilePhotoUrl ?? undefined }
          : {}),
        handle: updates.handle ?? state.user.handle,
        username: updates.handle ?? state.user.username,
      };

      await setSecureItem(USER_KEY, JSON.stringify(nextUser));
      setState((prev) => ({
        ...prev,
        user: prev.user ? nextUser : prev.user,
      }));
    },
    [state.user]
  );

  useEffect(() => {
    setApiAccessTokenResolver(() => getAccessToken());

    return () => {
      setApiAccessTokenResolver(null);
    };
  }, [getAccessToken]);

  useEffect(() => {
    if (state.isLoading) {
      return;
    }

    const signature =
      state.isAuthenticated && state.user ? `auth:${state.user.id}` : 'anon';
    const previousSignature = authSignatureRef.current;
    authSignatureRef.current = signature;

    const shouldInvalidatePropertyDetails =
      previousSignature === null ? state.isAuthenticated : previousSignature !== signature;

    if (shouldInvalidatePropertyDetails) {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.details() });
      void queryClient.invalidateQueries({ queryKey: savedPropertyKeys.all });
    }
  }, [
    queryClient,
    state.isAuthenticated,
    state.isLoading,
    state.user,
  ]);

  /**
   * Sign in with Google
   */
  const signInWithGoogle = useCallback(async () => {
    try {
      const googleClientId = getGoogleClientId();

      if (!googleClientId) {
        throw new Error(
          'Google Sign-In is not configured for this app build. Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in apps/app/.env and restart Expo.'
        );
      }

      setState((prev) => ({ ...prev, isLoading: true }));

      // Create auth request
      const discovery = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
      };

      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'huishype',
        path: 'auth/callback',
      });

      const request = new AuthSession.AuthRequest({
        clientId: googleClientId,
        scopes: ['openid', 'email', 'profile'],
        redirectUri,
        responseType: AuthSession.ResponseType.IdToken,
        usePKCE: false,
        extraParams: {
          nonce: Crypto.randomUUID(),
        },
      });

      const result = await request.promptAsync(discovery);

      if (result.type !== 'success') {
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }

      // Extract ID token from params
      const params = result.params as { id_token?: string };
      const idToken = params.id_token;

      if (!idToken) {
        throw new Error('No ID token received from Google');
      }

      // Send to our backend
      const response = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message || 'Authentication failed');
      }

      const data = (await response.json()) as {
        session: {
          user: AuthUser;
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
        };
        isNewUser: boolean;
      };

      await storeAuthData(
        data.session.accessToken,
        data.session.refreshToken,
        data.session.user,
        data.session.expiresAt
      );
    } catch (error) {
      console.error('Google sign in failed:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, [storeAuthData]);

  /**
   * Sign in with a mock token (dev/test only).
   *
   * Token format: mock-google-{emailPrefix}-{googleId}
   * The backend splits on '-' and takes parts[2] as email prefix + @gmail.com,
   * parts[3] as googleId.
   *
   * Gated behind __DEV__ — throws in production builds.
   */
  const signInWithMockToken = useCallback(
    async (token: string) => {
      if (!__DEV__) {
        throw new Error('signInWithMockToken is only available in development');
      }

      try {
        setState((prev) => ({ ...prev, isLoading: true }));

        const response = await fetch(`${API_BASE_URL}/auth/google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ idToken: token }),
        });

        if (!response.ok) {
          const error = (await response.json()) as { message?: string };
          throw new Error(error.message || 'Mock authentication failed');
        }

        const data = (await response.json()) as {
          session: {
            user: AuthUser;
            accessToken: string;
            refreshToken: string;
            expiresAt: string;
          };
          isNewUser: boolean;
        };

        await storeAuthData(
          data.session.accessToken,
          data.session.refreshToken,
          data.session.user,
          data.session.expiresAt
        );
      } catch (error) {
        console.error('Mock token sign in failed:', error);
        setState((prev) => ({ ...prev, isLoading: false }));
        throw error;
      }
    },
    [storeAuthData]
  );

  /**
   * Verify an email sign-in link token.
   *
   * Calls POST /auth/email/verify and stores the returned session.
   * This is invoked either from deep-link handling (production) or
   * automatically in dev mode after requestEmailLink.
   */
  const verifyEmailToken = useCallback(
    async (token: string) => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, authError: null }));

        const response = await fetch(`${API_BASE_URL}/auth/email/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          const errorData = (await response.json()) as { error: string; message: string };
          const message = errorData.message || 'Invalid or expired link';
          if (response.status === 400 || response.status === 401) {
            throw new ExpectedEmailAuthError(message);
          }
          throw new Error(message);
        }

        const data = (await response.json()) as {
          session: {
            user: AuthUser;
            accessToken: string;
            refreshToken: string;
            expiresAt: string;
          };
          isNewUser: boolean;
        };

        await storeAuthData(
          data.session.accessToken,
          data.session.refreshToken,
          data.session.user,
          data.session.expiresAt
        );
      } catch (error) {
        if (!(error instanceof ExpectedEmailAuthError)) {
          console.error('Email token verification failed:', error);
        }
        setState((prev) => ({
          ...prev,
          isLoading: false,
          authError: error instanceof Error ? error.message : 'Invalid or expired link',
        }));
        throw error;
      }
    },
    [storeAuthData]
  );

  /**
   * Request an email sign-in link.
   *
   * Calls POST /auth/email/request. In dev mode the backend returns
   * the token directly (no email sent). In production the user clicks
   * the link in the email which deep-links back to the app calling
   * verifyEmailToken.
   */
  const requestEmailLink = useCallback(async (email: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/email/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (response.status === 429) {
      const data = (await response.json()) as { error: string; message: string };
      throw new Error(data.message || 'Too many requests. Please try again later.');
    }

    if (!response.ok) {
      throw new Error('Failed to send sign-in link. Please try again.');
    }

    // In dev mode the backend returns the token — we can auto-verify
    if (__DEV__) {
      const data = (await response.json()) as { message: string; token?: string };
      if (data.token) {
        await verifyEmailToken(data.token);
      }
    }
  }, [verifyEmailToken]);

  const handleIncomingAuthUrl = useCallback(
    async (url: string | null) => {
      const emailToken = extractEmailTokenFromUrl(url);
      if (!emailToken) {
        return;
      }

      try {
        await verifyEmailToken(emailToken);
      } catch {}
    },
    [verifyEmailToken]
  );

  /**
   * Sign out
   */
  const signOut = useCallback(async () => {
    try {
      const refreshToken = await getSecureItem(REFRESH_TOKEN_KEY);
      const accessToken = await getSecureItem(ACCESS_TOKEN_KEY);

      // Call logout endpoint (best effort)
      if (accessToken) {
        try {
          await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ refreshToken }),
          });
        } catch {
          // Ignore errors from logout endpoint
        }
      }

      await clearAuthData();
    } catch (error) {
      console.error('Sign out failed:', error);
      // Still clear local data even if server call fails
      await clearAuthData();
    }
  }, [clearAuthData]);

  /**
   * Load stored auth data on mount
   */
  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const [accessToken, refreshToken, userStr, expiresAt] =
          await Promise.all([
            getSecureItem(ACCESS_TOKEN_KEY),
            getSecureItem(REFRESH_TOKEN_KEY),
            getSecureItem(USER_KEY),
            getSecureItem(TOKEN_EXPIRY_KEY),
          ]);

        if (!accessToken || !refreshToken || !userStr) {
          setState((prev) => ({ ...prev, isLoading: false }));
          return;
        }

        let user = JSON.parse(userStr) as AuthUser;

        // Check if token is expired
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
          // Try to refresh
          const refreshed = await refreshAuth();
          if (!refreshed) {
            setState((prev) => ({ ...prev, isLoading: false }));
            return;
          }
          const refreshedAccessToken = await getSecureItem(ACCESS_TOKEN_KEY);
          user = await backfillStoredUserEmail(user, refreshedAccessToken);
          // refreshAuth already updated accessToken in state and storage;
          // only set user/isAuthenticated/isLoading here to avoid
          // overwriting the fresh token with the stale one we read above.
          setState((prev) => ({
            ...prev,
            user,
            isAuthenticated: true,
            isLoading: false,
            authError: null,
          }));
        } else {
          user = await backfillStoredUserEmail(user, accessToken);
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            accessToken,
            authError: null,
          });
          // Only schedule here for the non-expired path.
          // The expired path already scheduled via refreshAuth().
          if (expiresAt) {
            scheduleTokenRefresh(expiresAt);
          }
        }
      } catch (error) {
        console.error('Failed to load stored auth:', error);
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    }

    loadStoredAuth();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [refreshAuth, scheduleTokenRefresh]);

  useEffect(() => {
    let active = true;

    Linking.getInitialURL()
      .then((url) => {
        if (active) {
          void handleIncomingAuthUrl(url);
        }
      })
      .catch((error) => {
        console.error('Failed to read initial auth URL:', error);
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingAuthUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleIncomingAuthUrl]);

  const value: AuthContextValue = {
    ...state,
    signInWithGoogle,
    signInWithMockToken,
    requestEmailLink,
    verifyEmailToken,
    signOut,
    refreshAuth,
    getAccessToken,
    updateAuthUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access auth context.
 *
 * Throws if called outside the AuthProvider tree. The AuthProvider wraps
 * the entire app in _layout.tsx, so this should never happen during
 * normal operation. If you see this error during HMR / Fast Refresh,
 * it is a transient dev-server artifact and can be safely ignored.
 */
export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

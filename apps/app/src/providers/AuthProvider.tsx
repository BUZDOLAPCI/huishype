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
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { User } from '@huishype/shared';
import { API_URL } from '../utils/api';

// Complete auth session for web
WebBrowser.maybeCompleteAuthSession();

// Storage keys
const ACCESS_TOKEN_KEY = 'huishype_access_token';
const REFRESH_TOKEN_KEY = 'huishype_refresh_token';
const USER_KEY = 'huishype_user';
const TOKEN_EXPIRY_KEY = 'huishype_token_expiry';

const API_BASE_URL = API_URL;

// Google OAuth config
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

// Types
export interface AuthUser extends User {
  email?: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
}

export interface AuthContextValue extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
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

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    accessToken: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      });

      // Schedule token refresh
      scheduleTokenRefresh(expiresAt);
    },
    []
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
    });
  }, []);

  /**
   * Schedule token refresh before expiry
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
        refreshAuth();
      }, refreshTime);
    }
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

  /**
   * Sign in with Google
   */
  const signInWithGoogle = useCallback(async () => {
    try {
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
        clientId: GOOGLE_CLIENT_ID,
        scopes: ['openid', 'email', 'profile'],
        redirectUri,
        responseType: AuthSession.ResponseType.IdToken,
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
   * Sign in with Apple
   */
  const signInWithApple = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      if (Platform.OS === 'web') {
        throw new Error('Apple Sign In is not available on web');
      }

      // Check if Apple authentication is available
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        throw new Error('Apple Sign In is not available on this device');
      }

      // Request Apple authentication
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('No identity token received from Apple');
      }

      // Send to our backend
      const response = await fetch(`${API_BASE_URL}/auth/apple`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken: credential.identityToken }),
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
      console.error('Apple sign in failed:', error);
      setState((prev) => ({ ...prev, isLoading: false }));

      // Don't throw if user cancelled
      if (
        error instanceof Error &&
        error.message.includes('ERR_CANCELED')
      ) {
        return;
      }
      throw error;
    }
  }, [storeAuthData]);

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

        const user = JSON.parse(userStr) as AuthUser;

        // Check if token is expired
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
          // Try to refresh
          const refreshed = await refreshAuth();
          if (!refreshed) {
            setState((prev) => ({ ...prev, isLoading: false }));
            return;
          }
        }

        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          accessToken,
        });

        if (expiresAt) {
          scheduleTokenRefresh(expiresAt);
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

  const value: AuthContextValue = {
    ...state,
    signInWithGoogle,
    signInWithApple,
    signOut,
    refreshAuth,
    getAccessToken,
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

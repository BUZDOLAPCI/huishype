/**
 * Authentication Provider
 * Manages browser cookie-backed authentication state.
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
import { propertyKeys } from '../hooks/useProperties';
import { ApiError, api } from '../utils/api';

interface AuthSessionUser {
  id: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  profilePhotoUrl?: string | null;
  karma?: number;
}

interface AuthSession {
  user: AuthSessionUser;
  expiresAt: string;
}

interface AuthLoginResponse {
  session: AuthSession;
  isNewUser: boolean;
}

interface AuthSessionStateResponse {
  user: AuthSessionUser | null;
}

interface AuthRefreshResponse {
  session: AuthSession;
}

type BrowserSession = AuthLoginResponse['session'];
type BrowserSessionUser = BrowserSession['user'];

export interface AuthUser extends BrowserSessionUser {
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || '';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  prompt(momentListener?: () => void): void;
}

interface GoogleIdentityServices {
  accounts?: {
    id?: GoogleAccountsId;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let googleIdentityServicesLoader: Promise<void> | null = null;

async function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Google sign-in is only available in the browser');
  }

  if (window.google?.accounts?.id) {
    return;
  }

  if (!googleIdentityServicesLoader) {
    googleIdentityServicesLoader = new Promise<void>((resolve, reject) => {
      const scriptId = 'huishype-google-identity-services';
      const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (existingScript) {
        if (window.google?.accounts?.id) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          'load',
          () => {
            resolve();
          },
          { once: true },
        );
        existingScript.addEventListener(
          'error',
          () => {
            reject(new Error('Failed to load Google sign-in script'));
          },
          { once: true },
        );
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google sign-in script'));
      document.head.appendChild(script);
    }).catch((error) => {
      googleIdentityServicesLoader = null;
      throw error;
    });
  }

  await googleIdentityServicesLoader;
}

function toAuthUser(user: AuthSessionStateResponse['user'] | BrowserSessionUser): AuthUser {
  return user as AuthUser;
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

  const refreshTimerRef = useRef<number | null>(null);
  const refreshAuthRef = useRef<() => Promise<boolean>>(null!);
  const authSignatureRef = useRef<string | null>(null);

  const scheduleTokenRefresh = useCallback((expiresAt: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const refreshTime = expiryTime - now - 60_000;

    if (refreshTime > 0) {
      refreshTimerRef.current = window.setTimeout(() => {
        refreshAuthRef.current();
      }, refreshTime);
    }
  }, []);

  const setAuthenticatedState = useCallback(
    (session: BrowserSession) => {
      setState({
        user: toAuthUser(session.user),
        isAuthenticated: true,
        isLoading: false,
        accessToken: null,
        authError: null,
      });
      scheduleTokenRefresh(session.expiresAt);
    },
    [scheduleTokenRefresh],
  );

  const clearAuthData = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      accessToken: null,
      authError: null,
    });
  }, []);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await api.post<AuthRefreshResponse>('/auth/refresh', {}, {
        credentials: 'include',
      });

      setAuthenticatedState(response.session);
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await clearAuthData();
      return false;
    }
  }, [clearAuthData, setAuthenticatedState]);

  refreshAuthRef.current = refreshAuth;

  const loadCurrentSession = useCallback(async () => {
    try {
      const response = await api.get<AuthSessionStateResponse>('/auth/session', {
        credentials: 'include',
      });

      if (!response.user) {
        await clearAuthData();
        return;
      }

      setState({
        user: toAuthUser(response.user),
        isAuthenticated: true,
        isLoading: false,
        accessToken: null,
        authError: null,
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        console.error('Failed to load current auth session:', error);
      }
      await clearAuthData();
    }
  }, [clearAuthData]);

  useEffect(() => {
    void loadCurrentSession();
  }, [loadCurrentSession]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

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
    }
  }, [queryClient, state.isAuthenticated, state.isLoading, state.user]);

  const authenticateWithGoogleIdToken = useCallback(
    async (idToken: string) => {
      const response = await api.post<AuthLoginResponse>(
        '/auth/google',
        { idToken },
        { credentials: 'include' },
      );

      setAuthenticatedState(response.session);
    },
    [setAuthenticatedState],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, authError: null }));

      if (!GOOGLE_CLIENT_ID) {
        throw new Error('Google sign-in is not configured');
      }

      await loadGoogleIdentityServices();
      const google = window.google?.accounts?.id;
      if (!google) {
        throw new Error('Google sign-in is unavailable');
      }

      const idToken = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error('Google sign-in timed out'));
        }, 60_000);

        let settled = false;
        const finish = (token: string | undefined) => {
          if (settled) {
            return;
          }

          settled = true;
          window.clearTimeout(timeout);
          if (token) {
            resolve(token);
          } else {
            reject(new Error('Google sign-in did not return a credential'));
          }
        };

        google.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            finish(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        google.prompt();
      });

      await authenticateWithGoogleIdToken(idToken);
    } catch (error) {
      console.error('Google sign in failed:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        authError: error instanceof Error ? error.message : 'Authentication failed',
      }));
      throw error;
    }
  }, [authenticateWithGoogleIdToken]);

  const signInWithMockToken = useCallback(
    async (token: string) => {
      if (!__DEV__) {
        throw new Error('signInWithMockToken is only available in development');
      }

      try {
        setState((prev) => ({ ...prev, isLoading: true, authError: null }));
        await authenticateWithGoogleIdToken(token);
      } catch (error) {
        console.error('Mock token sign in failed:', error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          authError: error instanceof Error ? error.message : 'Mock authentication failed',
        }));
        throw error;
      }
    },
    [authenticateWithGoogleIdToken],
  );

  const verifyEmailToken = useCallback(
    async (token: string) => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, authError: null }));

        const response = await api.post<AuthLoginResponse>(
          '/auth/email/verify',
          { token },
          { credentials: 'include' },
        );

        setAuthenticatedState(response.session);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
          const message = error.message || 'Invalid or expired link';
          setState((prev) => ({
            ...prev,
            isLoading: false,
            authError: message,
          }));
          throw new ExpectedEmailAuthError(message);
        }

        if (!(error instanceof ExpectedEmailAuthError)) {
          console.error('Email token verification failed:', error);
        }

        const message =
          error instanceof Error ? error.message : 'Invalid or expired link';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          authError: message,
        }));
        throw error;
      }
    },
    [setAuthenticatedState],
  );

  const requestEmailLink = useCallback(
    async (email: string) => {
      try {
        const response = await api.post<{ message: string; token?: string }>(
          '/auth/email/request',
          { email },
          { credentials: 'include' },
        );

        if (__DEV__ && response.token) {
          await verifyEmailToken(response.token);
        }
      } catch (error) {
        throw error;
      }
    },
    [verifyEmailToken],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { credentials: 'include' });
      await clearAuthData();
    } catch (error) {
      console.error('Sign out failed:', error);
      await clearAuthData();
    }
  }, [clearAuthData]);

  const getAccessToken = useCallback(async (): Promise<string | null> => null, []);

  const value: AuthContextValue = {
    ...state,
    signInWithGoogle,
    signInWithMockToken,
    requestEmailLink,
    verifyEmailToken,
    signOut,
    refreshAuth,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

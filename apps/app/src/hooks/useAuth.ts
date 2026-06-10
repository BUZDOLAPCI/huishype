/**
 * useAuth Hook
 * Provides easy access to authentication state and methods
 * Integrates with AuthProvider for state management and TanStack Query for caching
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext, type AuthUser } from '../providers/AuthProvider';

export interface UseAuthReturn {
  /** Current authenticated user or null */
  user: AuthUser | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth state is loading */
  isLoading: boolean;
  /** Whether a sign-in operation is in progress */
  isSigningIn: boolean;
  /** Sign in with Google */
  signInWithGoogle: () => Promise<void>;
  /** Sign in with a mock token (dev only) */
  signInWithMockToken: (token: string) => Promise<void>;
  /** Request an email sign-in link */
  requestEmailLink: (email: string) => Promise<void>;
  /** Verify an email sign-in link token */
  verifyEmailToken: (token: string) => Promise<void>;
  /** Sign out */
  signOut: () => Promise<void>;
  /** Get current access token (refreshes if needed) */
  getAccessToken: () => Promise<string | null>;
  /** Error from last operation */
  error: Error | null;
  /** Clear any error */
  clearError: () => void;
}

// Query keys for auth-related queries
export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
};

/**
 * Hook for accessing authentication functionality
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, signInWithGoogle } = useAuth();
 *
 *   if (isAuthenticated) {
 *     return <Text>Welcome, {user?.displayName}</Text>;
 *   }
 *
 *   return <Button onPress={signInWithGoogle} title="Sign In" />;
 * }
 * ```
 */
export function useAuth(): UseAuthReturn {
  const auth = useAuthContext();
  const queryClient = useQueryClient();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      await auth.signInWithGoogle();
      // Invalidate user-related queries after successful sign in
      await queryClient.invalidateQueries({ queryKey: authKeys.user() });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign in failed');
      setError(error);
      throw error;
    } finally {
      setIsSigningIn(false);
    }
  }, [auth, queryClient]);

  const signInWithMockToken = useCallback(async (token: string) => {
    setError(null);
    setIsSigningIn(true);
    try {
      await auth.signInWithMockToken(token);
      // Invalidate user-related queries after successful sign in
      await queryClient.invalidateQueries({ queryKey: authKeys.user() });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Mock sign in failed');
      setError(error);
      throw error;
    } finally {
      setIsSigningIn(false);
    }
  }, [auth, queryClient]);

  const requestEmailLink = useCallback(async (email: string) => {
    setError(null);
    try {
      await auth.requestEmailLink(email);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to send sign-in link');
      setError(error);
      throw error;
    }
  }, [auth]);

  const verifyEmailToken = useCallback(async (token: string) => {
    setError(null);
    setIsSigningIn(true);
    try {
      await auth.verifyEmailToken(token);
      await queryClient.invalidateQueries({ queryKey: authKeys.user() });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Invalid or expired link');
      setError(error);
      throw error;
    } finally {
      setIsSigningIn(false);
    }
  }, [auth, queryClient]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await auth.signOut();
      // Clear all cached queries on sign out
      await queryClient.invalidateQueries();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Sign out failed');
      setError(error);
      throw error;
    }
  }, [auth, queryClient]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
    isSigningIn,
    signInWithGoogle,
    signInWithMockToken,
    requestEmailLink,
    verifyEmailToken,
    signOut,
    getAccessToken: auth.getAccessToken,
    error,
    clearError,
  };
}

export default useAuth;

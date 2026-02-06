/**
 * useApiClient Hook
 * Provides a configured API client that automatically includes auth tokens
 */

import { useMemo, useCallback } from 'react';
import { createApiClient, type HuisHypeApiClient } from '@huishype/api-client';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';

const API_BASE_URL = API_URL;

/**
 * Hook that returns a configured API client with auth token support
 *
 * The client automatically:
 * - Includes the Authorization header when a token is available
 * - Calls onAuthError when receiving 401 responses
 * - Updates tokens when refreshed
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const apiClient = useApiClient();
 *
 *   const fetchProperty = async () => {
 *     const response = await apiClient.getProperty('property-id');
 *     console.log(response.property);
 *   };
 *
 *   return <Button onPress={fetchProperty} title="Fetch" />;
 * }
 * ```
 */
export function useApiClient(): HuisHypeApiClient {
  const { accessToken, signOut, refreshAuth } = useAuthContext();

  const handleAuthError = useCallback(async () => {
    // Try to refresh the token first
    const refreshed = await refreshAuth();
    if (!refreshed) {
      // If refresh fails, sign out
      await signOut();
    }
  }, [refreshAuth, signOut]);

  const handleTokenRefresh = useCallback((_newToken: string) => {
    // Token is stored by AuthProvider, no action needed here
  }, []);

  const client = useMemo(() => {
    const apiClient = createApiClient({
      baseUrl: API_BASE_URL,
      accessToken: accessToken || undefined,
      onAuthError: handleAuthError,
      onTokenRefresh: handleTokenRefresh,
    });

    return apiClient;
  }, [accessToken, handleAuthError, handleTokenRefresh]);

  return client;
}

export default useApiClient;

/**
 * useApiClient Hook
 * Provides a configured API client for browser cookie-backed sessions.
 */

import { useMemo, useCallback } from 'react';
import { createApiClient, type HuisHypeApiClient } from '@huishype/api-client';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';

const API_BASE_URL = API_URL;

/**
 * Hook that returns a configured API client with browser-session support.
 *
 * The client automatically:
 * - Sends cookies with every request
 * - Calls onAuthError when receiving 401 responses
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
  const { signOut, refreshAuth } = useAuthContext();

  const handleAuthError = useCallback(async () => {
    const refreshed = await refreshAuth();
    if (!refreshed) {
      await signOut();
    }
  }, [refreshAuth, signOut]);

  const client = useMemo(() => {
    const apiClient = createApiClient({
      baseUrl: API_BASE_URL,
      onAuthError: handleAuthError,
    });

    return apiClient;
  }, [handleAuthError]);

  return client;
}

export default useApiClient;

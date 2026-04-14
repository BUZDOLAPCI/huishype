/**
 * Hook for address search
 *
 * Provides React Query integration for the address search service.
 */

import { useQuery } from '@tanstack/react-query';
import { searchAddresses } from '@/src/services/address-resolver';

/**
 * Query key factory for address queries
 */
export const addressKeys = {
  all: ['addresses'] as const,
  search: (query: string) => [...addressKeys.all, 'search', query] as const,
};

/**
 * Hook to search for addresses by free text
 *
 * @param query Search query string
 * @param limit Maximum results (default 5)
 * @param options Additional options
 * @returns Query result with matching addresses
 */
export function useAddressSearch(
  query: string,
  limit: number = 5,
  options?: {
    enabled?: boolean;
    debounceMs?: number;
  }
) {
  return useQuery({
    queryKey: addressKeys.search(query),
    queryFn: () => searchAddresses(query, limit),
    enabled: options?.enabled !== false && query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
}

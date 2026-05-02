/**
 * Hook for address search
 *
 * Provides React Query integration for the address search service.
 */

import { useQuery } from '@tanstack/react-query';
import {
  searchAddresses,
  type AddressSearchBias,
} from '@/src/services/address-resolver';

type UseAddressSearchOptions = {
  enabled?: boolean;
  debounceMs?: number;
  searchBias?: AddressSearchBias;
};

/**
 * Query key factory for address queries
 */
export const addressKeys = {
  all: ['addresses'] as const,
  search: (query: string, limit: number, searchBias?: AddressSearchBias) => [
    ...addressKeys.all,
    'search',
    query,
    limit,
    searchBias?.lon ?? null,
    searchBias?.lat ?? null,
    searchBias?.countryCode ?? null,
  ] as const,
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
  options?: UseAddressSearchOptions
) {
  return useQuery({
    queryKey: addressKeys.search(query, limit, options?.searchBias),
    queryFn: () => searchAddresses(query, limit, options?.searchBias),
    enabled: options?.enabled !== false && query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
}

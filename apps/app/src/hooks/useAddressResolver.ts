/**
 * Hook for PDOK address resolution
 *
 * Provides React Query integration for the address resolver service.
 */

import { useQuery } from '@tanstack/react-query';
import {
  resolveUrlParams,
  searchAddresses,
  type AddressUrlParams,
  type ResolvedAddress,
} from '@/src/services/address-resolver';

/**
 * Query key factory for address queries
 */
export const addressKeys = {
  all: ['addresses'] as const,
  resolve: (params: AddressUrlParams) => [...addressKeys.all, 'resolve', params] as const,
  search: (query: string) => [...addressKeys.all, 'search', query] as const,
};

/**
 * Hook to resolve URL parameters to a full address
 *
 * @param params URL parameters (city, zipcode, street, housenumber)
 * @param options Additional options
 * @returns Query result with resolved address
 */
export function useResolveAddress(
  params: AddressUrlParams | null,
  options?: {
    enabled?: boolean;
    staleTime?: number;
  }
) {
  const hasRequiredParams = params && (
    // Full address
    (params.city && params.zipcode && params.street && params.housenumber) ||
    // Or at least zipcode + housenumber
    (params.zipcode && params.housenumber)
  );

  return useQuery({
    queryKey: params ? addressKeys.resolve(params) : addressKeys.all,
    queryFn: () => (params ? resolveUrlParams(params) : null),
    enabled: options?.enabled !== false && !!hasRequiredParams,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes default
    retry: 1,
  });
}

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

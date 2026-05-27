import { useQuery } from '@tanstack/react-query';
import { searchLocations } from '@/src/services/location-search';
import type { AddressSearchBias } from '@/src/services/address-resolver';

type UseLocationSearchOptions = {
  enabled?: boolean;
  searchBias?: AddressSearchBias;
};

export const locationSearchKeys = {
  all: ['location-search'] as const,
  search: (query: string, limit: number, searchBias?: AddressSearchBias) => [
    ...locationSearchKeys.all,
    query,
    limit,
    searchBias?.lon ?? null,
    searchBias?.lat ?? null,
    searchBias?.countryCode ?? null,
  ] as const,
};

export function useLocationSearch(
  query: string,
  limit = 8,
  options?: UseLocationSearchOptions,
) {
  return useQuery({
    queryKey: locationSearchKeys.search(query, limit, options?.searchBias),
    queryFn: () => searchLocations(query, limit, options?.searchBias),
    enabled: options?.enabled !== false && query.length >= 2,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

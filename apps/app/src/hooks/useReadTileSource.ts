import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getAnonymousSessionId } from '@/src/lib/anonymousSession';
import type { MapFilters } from '@/src/lib/sharedMapFilters';
import {
  fetchReadTileSource,
  type ResolvedReadTileSource,
  type ReadTileCredential,
} from '@/src/lib/mapPropertySource';
import { readTileSourceKeys } from '@/src/hooks/readTileSourceInvalidation';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { API_URL } from '@/src/utils/api';

const READ_TILE_SOURCE_STALE_MS = 15 * 1000;

function getReadTileFilterKey(filters: MapFilters) {
  return {
    salePriceFrom: filters.salePriceFrom,
    salePriceTo: filters.salePriceTo,
    rentPriceFrom: filters.rentPriceFrom,
    rentPriceTo: filters.rentPriceTo,
    marketState: filters.marketState,
    activity: filters.activity,
  };
}

function useReadTileSourceVersion(): number {
  const { data } = useQuery<number>({
    queryKey: readTileSourceKeys.version,
    queryFn: () => 0,
    initialData: 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return data;
}

export function useReadTileSource(filters: MapFilters, enabled = true) {
  const { accessToken, getAccessToken, isAuthenticated, user } = useAuthContext();
  const version = useReadTileSourceVersion();
  const filterKey = getReadTileFilterKey(filters);
  const viewerKey = isAuthenticated && user?.id ? `auth:${user.id}` : 'anon-session';

  return useQuery<ResolvedReadTileSource>({
    queryKey: [...readTileSourceKeys.sourceRoot, viewerKey, filterKey, version],
    queryFn: async () => {
      let credential: ReadTileCredential;

      if (isAuthenticated) {
        const token = await getAccessToken();
        if (!token) {
          throw new Error('Not authenticated');
        }
        credential = {
          headerName: 'Authorization',
          headerValue: `Bearer ${token}`,
        };
      } else {
        const sessionId = await getAnonymousSessionId();
        if (!sessionId) {
          throw new Error('Anonymous session unavailable');
        }
        credential = {
          headerName: 'x-session-id',
          headerValue: sessionId,
        };
      }

      return fetchReadTileSource(API_URL, filters, credential, version);
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: READ_TILE_SOURCE_STALE_MS,
    retry: false,
    meta: {
      accessToken,
    },
  });
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
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

function useAnonymousViewerKey(enabled: boolean): string | null | undefined {
  const { data } = useQuery<string | null>({
    queryKey: ['auth', 'anonymous-session-id'],
    queryFn: getAnonymousSessionId,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (data === undefined) {
    return undefined;
  }

  return data ? `anon:${data}` : null;
}

export function useReadTileSource(filters: MapFilters, enabled = true) {
  const queryClient = useQueryClient();
  const { accessToken, getAccessToken, isAuthenticated, user } = useAuthContext();
  useReadTileSourceVersion();
  const filterKey = getReadTileFilterKey(filters);
  const anonymousViewerKey = useAnonymousViewerKey(enabled && !isAuthenticated);
  const viewerKey = isAuthenticated && user?.id ? `auth:${user.id}` : anonymousViewerKey;

  return useQuery<ResolvedReadTileSource>({
    queryKey: [...readTileSourceKeys.sourceRoot, viewerKey ?? 'anon:pending', filterKey],
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
        const sessionId = anonymousViewerKey?.replace(/^anon:/, '') ?? await getAnonymousSessionId();
        if (!sessionId) {
          throw new Error('Anonymous session unavailable');
        }
        credential = {
          headerName: 'x-session-id',
          headerValue: sessionId,
        };
      }

      const latestVersion = queryClient.getQueryData<number>(readTileSourceKeys.version) ?? 0;
      return fetchReadTileSource(API_URL, filters, credential, latestVersion);
    },
    enabled: enabled && (isAuthenticated ? !!user?.id : anonymousViewerKey !== undefined),
    staleTime: READ_TILE_SOURCE_STALE_MS,
    retry: false,
    meta: {
      accessToken,
    },
  });
}

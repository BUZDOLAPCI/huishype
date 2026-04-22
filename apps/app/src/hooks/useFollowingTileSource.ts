import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { API_URL } from '@/src/utils/api';
import type { MapActivityFilter, MapFilters } from '@/src/lib/sharedMapFilters';
import {
  fetchFollowingTileSource,
  type ResolvedFollowingTileSource,
} from '@/src/lib/mapPropertySource';
import { getViewerCacheKey, propertyKeys } from '@/src/hooks/useProperties';

function getFollowingTileFilterKey(filters: MapFilters, followingActivity: MapActivityFilter) {
  return {
    salePriceFrom: filters.salePriceFrom,
    salePriceTo: filters.salePriceTo,
    rentPriceFrom: filters.rentPriceFrom,
    rentPriceTo: filters.rentPriceTo,
    marketState: filters.marketState,
    activity: followingActivity,
  };
}

export function useFollowingTileSource(
  filters: MapFilters,
  followingActivity: MapActivityFilter = 'all-time',
  enabled = true
) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);
  const filterKey = getFollowingTileFilterKey(filters, followingActivity);

  return useQuery<ResolvedFollowingTileSource>({
    queryKey: [...propertyKeys.followingViewportRoot(viewerKey), 'tile-source', filterKey],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchFollowingTileSource(API_URL, filters, followingActivity, accessToken);
    },
    enabled: enabled && isAuthenticated,
    staleTime: 15 * 1000,
    retry: false,
  });
}

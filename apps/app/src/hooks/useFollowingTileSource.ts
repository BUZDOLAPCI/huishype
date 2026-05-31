import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { API_URL } from '@/src/utils/api';
import type { MapActivityFilter, MapFilters } from '@/src/lib/sharedMapFilters';
import {
  fetchFollowingTileSource,
  type ResolvedFollowingTileSource,
} from '@/src/lib/mapPropertySource';
import { getViewerCacheKey, propertyKeys } from '@/src/hooks/useProperties';
import { getFollowingTileFilterSignature } from '@/src/hooks/tileFilterSignature';

export function useFollowingTileSource(
  filters: MapFilters,
  followingActivity: MapActivityFilter = 'all-time',
  enabled = true
) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);
  const filterSignature = getFollowingTileFilterSignature(filters, followingActivity);

  return useQuery<ResolvedFollowingTileSource>({
    queryKey: [...propertyKeys.followingViewportRoot(viewerKey), 'tile-source', filterSignature],
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

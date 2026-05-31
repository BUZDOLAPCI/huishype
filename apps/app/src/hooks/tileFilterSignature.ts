import {
  getCanonicalMapFilterSignature,
  type MapActivityFilter,
  type MapFilters,
} from '@/src/lib/sharedMapFilters';

export function getReadTileFilterSignature(filters: MapFilters): string {
  return getCanonicalMapFilterSignature(filters);
}

export function getFollowingTileFilterSignature(
  filters: MapFilters,
  followingActivity: MapActivityFilter
): string {
  return getCanonicalMapFilterSignature({
    ...filters,
    activity: followingActivity,
  });
}

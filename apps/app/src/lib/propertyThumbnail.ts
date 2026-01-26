import { getDutchAerialSnapshotUrl } from './pdok/imagery';

/**
 * Generates a thumbnail URL for a property using PDOK aerial imagery.
 *
 * @param latitude Property latitude (WGS84)
 * @param longitude Property longitude (WGS84)
 * @param width Thumbnail width in pixels (default 128)
 * @param height Thumbnail height in pixels (default 128)
 * @param boxSizeMeters Size of the bounding box in meters (default 30 for tight property view)
 * @returns URL string for the aerial thumbnail image
 *
 * @example
 * // Get thumbnail for property at coordinates
 * const url = getPropertyThumbnailUrl(51.4416, 5.4697);
 */
export const getPropertyThumbnailUrl = (
  latitude: number,
  longitude: number,
  width: number = 128,
  height: number = 128,
  boxSizeMeters: number = 30
): string => {
  return getDutchAerialSnapshotUrl(latitude, longitude, width, height, boxSizeMeters);
};

/**
 * Generates a thumbnail URL from a GeoJSON Point geometry
 *
 * @param geometry GeoJSON Point geometry with [longitude, latitude] coordinates
 * @returns URL string for the aerial thumbnail image, or null if geometry is invalid
 */
export const getPropertyThumbnailFromGeometry = (
  geometry: { type: 'Point'; coordinates: [number, number] } | null | undefined
): string | null => {
  if (!geometry || geometry.type !== 'Point' || !geometry.coordinates) {
    return null;
  }

  const [longitude, latitude] = geometry.coordinates;

  // Validate coordinates are within reasonable bounds for Netherlands
  if (
    latitude < 50.5 ||
    latitude > 53.7 ||
    longitude < 3.3 ||
    longitude > 7.3
  ) {
    return null;
  }

  return getPropertyThumbnailUrl(latitude, longitude);
};

export default {
  getPropertyThumbnailUrl,
  getPropertyThumbnailFromGeometry,
};

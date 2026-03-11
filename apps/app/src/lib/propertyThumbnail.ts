import { getDutchAerialSnapshotUrl } from './pdok/imagery';
import type { CountryCode } from '@huishype/shared';

/**
 * Generates a thumbnail URL for a property using aerial imagery.
 *
 * Currently only NL is supported (PDOK aerial imagery).
 * Returns null for non-NL countries until equivalent services are configured.
 *
 * @param latitude Property latitude (WGS84)
 * @param longitude Property longitude (WGS84)
 * @param countryCode ISO 3166-1 alpha-2 country code (defaults to 'NL')
 * @param width Thumbnail width in pixels (default 128)
 * @param height Thumbnail height in pixels (default 128)
 * @param boxSizeMeters Size of the bounding box in meters (default 30 for tight property view)
 * @returns URL string for the aerial thumbnail image, or null if country not supported
 */
export const getPropertyThumbnailUrl = (
  latitude: number,
  longitude: number,
  countryCode: CountryCode = 'NL',
  width: number = 128,
  height: number = 128,
  boxSizeMeters: number = 30
): string | null => {
  if (countryCode !== 'NL') return null;
  return getDutchAerialSnapshotUrl(latitude, longitude, width, height, boxSizeMeters);
};

/**
 * Generates a thumbnail URL from a GeoJSON Point geometry.
 *
 * Currently only supports NL properties (PDOK aerial imagery).
 * Returns null for non-NL countries or invalid geometries.
 *
 * @param geometry GeoJSON Point geometry with [longitude, latitude] coordinates
 * @param countryCode ISO 3166-1 alpha-2 country code (defaults to 'NL')
 * @returns URL string for the aerial thumbnail image, or null if geometry is invalid or country not supported
 */
export const getPropertyThumbnailFromGeometry = (
  geometry: { type: 'Point'; coordinates: [number, number] } | null | undefined,
  countryCode: CountryCode = 'NL',
): string | null => {
  if (countryCode !== 'NL') return null;

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

  return getPropertyThumbnailUrl(latitude, longitude, countryCode);
};

export default {
  getPropertyThumbnailUrl,
  getPropertyThumbnailFromGeometry,
};

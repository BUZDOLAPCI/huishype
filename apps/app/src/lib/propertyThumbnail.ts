import { getDutchAerialSnapshotUrl } from './pdok/imagery';
import type { CountryCode } from '@huishype/shared';

export const PROPERTY_AERIAL_IMAGE_WIDTH = 800;
export const PROPERTY_AERIAL_IMAGE_HEIGHT = 600;
export const PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS = 80;

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
 * @param boxSizeMeters Size of the bounding box in meters (default 80 for a wider property view)
 * @returns URL string for the aerial thumbnail image, or null if country not supported
 */
export const getPropertyThumbnailUrl = (
  latitude: number,
  longitude: number,
  countryCode: CountryCode = 'NL',
  width: number = 128,
  height: number = 128,
  boxSizeMeters: number = 80
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

/**
 * Generates the canonical PDOK image URL used for property-detail and preview
 * surfaces that should share the same fetch/cache entry.
 */
export const getPropertyAerialImageUrl = (
  latitude: number,
  longitude: number,
  countryCode: CountryCode = 'NL',
): string | null =>
  getPropertyThumbnailUrl(
    latitude,
    longitude,
    countryCode,
    PROPERTY_AERIAL_IMAGE_WIDTH,
    PROPERTY_AERIAL_IMAGE_HEIGHT,
    PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS,
  );

/**
 * Generates the canonical property aerial image URL from a GeoJSON point.
 */
export const getPropertyAerialImageFromGeometry = (
  geometry: { type: 'Point'; coordinates: [number, number] } | null | undefined,
  countryCode: CountryCode = 'NL',
): string | null => {
  if (countryCode !== 'NL') return null;

  if (!geometry || geometry.type !== 'Point' || !geometry.coordinates) {
    return null;
  }

  const [longitude, latitude] = geometry.coordinates;

  if (
    latitude < 50.5 ||
    latitude > 53.7 ||
    longitude < 3.3 ||
    longitude > 7.3
  ) {
    return null;
  }

  return getPropertyAerialImageUrl(latitude, longitude, countryCode);
};

export default {
  getPropertyAerialImageUrl,
  getPropertyAerialImageFromGeometry,
  getPropertyThumbnailUrl,
  getPropertyThumbnailFromGeometry,
};

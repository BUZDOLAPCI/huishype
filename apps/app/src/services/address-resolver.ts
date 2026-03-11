/**
 * Address Resolver Service
 *
 * Resolves addresses using the backend geocode proxy (Photon-backed).
 * Provides search and URL-based resolution for the app.
 *
 * URL Structure: /{city}/{zipcode}/{street}/{house_number}
 * Example: /eindhoven/5651hp/deflectiespoelstraat/16
 */

import { apiGeocoder } from './api-geocoder';
import type { GeocodeSuggestion } from './geocoder';

/**
 * Resolved address with all necessary data for the app
 */
export interface ResolvedAddress {
  bagId: string; // Geocoder result ID (osm_type + osm_id)
  formattedAddress: string; // Display name
  lat: number;
  lon: number;
  details: {
    city: string;
    zip: string;
    street: string;
    number: string;
  };
}

/**
 * URL parameters from Expo Router
 */
export interface AddressUrlParams {
  city?: string;
  zipcode?: string;
  street?: string;
  housenumber?: string;
}

/**
 * Normalize strings for URL comparison
 * - Lowercase
 * - Remove diacritics
 * - Replace spaces with dashes
 */
export function normalizeForUrl(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Create URL-friendly path from address components
 */
export function createAddressUrl(address: ResolvedAddress): string {
  const { city, zip, street, number } = address.details;
  return `/${normalizeForUrl(city)}/${normalizeForUrl(zip)}/${normalizeForUrl(street)}/${number}`;
}

/**
 * Map a GeocodeSuggestion to our ResolvedAddress format
 */
function toResolvedAddress(suggestion: GeocodeSuggestion): ResolvedAddress {
  return {
    bagId: suggestion.id,
    formattedAddress: suggestion.displayName,
    lat: suggestion.coordinates[1],
    lon: suggestion.coordinates[0],
    details: {
      city: suggestion.city || '',
      zip: suggestion.postalCode || '',
      street: suggestion.street || '',
      number: suggestion.houseNumber || '',
    },
  };
}

/**
 * Build a free text query from URL parameters
 */
function buildSearchQuery(params: AddressUrlParams): string {
  const parts: string[] = [];

  if (params.zipcode && params.housenumber) {
    parts.push(params.zipcode.toUpperCase());
    parts.push(params.housenumber);
  } else if (params.city && params.street && params.housenumber) {
    parts.push(params.street.replace(/-/g, ' '));
    parts.push(params.housenumber);
    parts.push(params.city);
  } else if (params.city && params.zipcode) {
    parts.push(params.city);
    parts.push(params.zipcode.toUpperCase());
  } else if (params.city) {
    parts.push(params.city);
  }

  return parts.join(' ');
}

/**
 * Resolve URL parameters to a full address using the geocoder.
 *
 * @param params URL parameters from Expo Router
 * @returns ResolvedAddress or null if not found
 */
export async function resolveUrlParams(params: AddressUrlParams): Promise<ResolvedAddress | null> {
  const query = buildSearchQuery(params);

  if (!query) {
    return null;
  }

  try {
    const results = await apiGeocoder.search(query, { limit: 1 });

    if (results.length === 0) {
      return null;
    }

    return toResolvedAddress(results[0]);
  } catch {
    return null;
  }
}

/**
 * Search for addresses by free text query.
 * Used for search/autocomplete functionality.
 *
 * @param query Free text search query
 * @param limit Maximum number of results
 * @param options Additional search options
 * @returns Array of resolved addresses
 */
export async function searchAddresses(
  query: string,
  limit: number = 5,
  options?: { countryCode?: string },
): Promise<ResolvedAddress[]> {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const results = await apiGeocoder.search(query, {
      limit,
      countryCode: options?.countryCode,
    });

    return results.map(toResolvedAddress);
  } catch {
    return [];
  }
}

/**
 * Determine the view type based on URL parameters
 */
export type AddressViewType = 'city' | 'postcode' | 'street' | 'property' | 'invalid';

export function determineViewType(params: AddressUrlParams): AddressViewType {
  if (!params.city) return 'invalid';
  if (!params.zipcode) return 'city';
  if (!params.street || !params.housenumber) return 'postcode';
  return 'property';
}

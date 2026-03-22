/**
 * Address Resolver Service
 *
 * Provides geocoding-based address search for the search bar autocomplete.
 * Uses the backend geocode proxy (Photon-backed).
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

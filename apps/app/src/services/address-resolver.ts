/**
 * Address Resolver Service
 *
 * Provides geocoding-based address search for the search bar autocomplete.
 * Uses the backend geocode proxy (Photon-backed).
 */

import { apiGeocoder } from './api-geocoder';
import type { GeocodeSuggestion } from './geocoder';

export interface HouseNumberParts {
  houseNumber: string | null;
  houseNumberAddition: string | null;
}

/**
 * Split a geocoder housenumber like "13A" or "13 bis" into numeric and
 * addition parts. Returns nulls when the value can't be parsed safely.
 */
export function splitHouseNumber(raw: string | null | undefined): HouseNumberParts {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return {
      houseNumber: null,
      houseNumberAddition: null,
    };
  }

  const match = trimmed.match(/^(\d+)(?:\s*[-/ ]?\s*(.+))?$/u);
  if (!match) {
    return {
      houseNumber: null,
      houseNumberAddition: null,
    };
  }

  const addition = match[2]?.trim() || null;
  return {
    houseNumber: match[1],
    houseNumberAddition: addition,
  };
}

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
    houseNumber: string | null;
    houseNumberAddition: string | null;
    countryCode: string | null;
  };
}

/**
 * Map a GeocodeSuggestion to our ResolvedAddress format
 */
function toResolvedAddress(suggestion: GeocodeSuggestion): ResolvedAddress {
  const houseNumberParts = splitHouseNumber(suggestion.houseNumber);

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
      houseNumber: houseNumberParts.houseNumber,
      houseNumberAddition: houseNumberParts.houseNumberAddition,
      countryCode: suggestion.countryCode?.toUpperCase() || null,
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

    const deduped = new Map<string, GeocodeSuggestion>();
    for (const result of results) {
      if (!deduped.has(result.id)) {
        deduped.set(result.id, result);
      }
    }

    return Array.from(deduped.values()).map(toResolvedAddress);
  } catch {
    return [];
  }
}

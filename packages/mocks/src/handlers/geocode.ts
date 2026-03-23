/**
 * Geocode API mock handlers
 *
 * Mocks the backend /geocode/search proxy endpoint.
 * Returns Photon-format data for test addresses.
 */

import { http, HttpResponse } from 'msw';
import type { GeocodeSuggestion } from '@huishype/shared';

/** Mock alias — structurally identical to the shared GeocodeSuggestion type. */
export type MockGeocodeSuggestion = GeocodeSuggestion;

/**
 * Mock geocode data for test addresses
 */
export const mockGeocodeSuggestions: MockGeocodeSuggestion[] = [
  {
    id: 'W_123456',
    displayName: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
    street: 'Deflectiespoelstraat',
    houseNumber: '16',
    postalCode: '5651HP',
    city: 'Eindhoven',
    region: 'Noord-Brabant',
    countryCode: 'nl',
    coordinates: [5.4557789, 51.4300456],
  },
  {
    id: 'W_123457',
    displayName: 'Deflectiespoelstraat 33, 5651HP Eindhoven',
    street: 'Deflectiespoelstraat',
    houseNumber: '33',
    postalCode: '5651HP',
    city: 'Eindhoven',
    region: 'Noord-Brabant',
    countryCode: 'nl',
    coordinates: [5.4560123, 51.4302789],
  },
  {
    id: 'W_123458',
    displayName: 'Stationsplein 1, 5611AB Eindhoven',
    street: 'Stationsplein',
    houseNumber: '1',
    postalCode: '5611AB',
    city: 'Eindhoven',
    region: 'Noord-Brabant',
    countryCode: 'nl',
    coordinates: [5.4817, 51.4433],
  },
  // German test addresses
  {
    id: 'W_200001',
    displayName: 'Unter den Linden 77, 10117 Berlin',
    street: 'Unter den Linden',
    houseNumber: '77',
    postalCode: '10117',
    city: 'Berlin',
    region: 'Berlin',
    countryCode: 'de',
    coordinates: [13.405, 52.52],
  },
  // British test addresses
  {
    id: 'W_300001',
    displayName: '70 Whitehall, SW1A 2AS London',
    street: 'Whitehall',
    houseNumber: '70',
    postalCode: 'SW1A 2AS',
    city: 'London',
    region: 'Greater London',
    countryCode: 'gb',
    coordinates: [-0.1276, 51.5074],
  },
];

/**
 * Find mock suggestions matching a query
 */
function findMockSuggestions(query: string, limit: number): MockGeocodeSuggestion[] {
  const normalizedQuery = query.toLowerCase();

  return mockGeocodeSuggestions
    .filter((s) => {
      const searchText = `${s.displayName} ${s.street || ''} ${s.postalCode || ''} ${s.city || ''}`.toLowerCase();
      return searchText.includes(normalizedQuery) || normalizedQuery.includes((s.street || '').toLowerCase().slice(0, 10));
    })
    .slice(0, limit);
}

/**
 * Mock reverse geocode lookup data.
 * Maps approximate coordinate regions to city info.
 */
interface ReverseGeocodeResult {
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
}

const mockReverseGeocodeRegions: Array<{
  latMin: number; latMax: number; lonMin: number; lonMax: number;
  result: ReverseGeocodeResult;
}> = [
  {
    latMin: 51.35, latMax: 51.55, lonMin: 5.35, lonMax: 5.55,
    result: { city: 'Eindhoven', state: 'Noord-Brabant', country: 'Netherlands', countryCode: 'NL' },
  },
  {
    latMin: 52.30, latMax: 52.45, lonMin: 4.75, lonMax: 5.05,
    result: { city: 'Amsterdam', state: 'Noord-Holland', country: 'Netherlands', countryCode: 'NL' },
  },
  {
    latMin: 51.85, latMax: 51.98, lonMin: 4.35, lonMax: 4.60,
    result: { city: 'Rotterdam', state: 'Zuid-Holland', country: 'Netherlands', countryCode: 'NL' },
  },
  {
    latMin: 52.03, latMax: 52.13, lonMin: 4.20, lonMax: 4.40,
    result: { city: 'Den Haag', state: 'Zuid-Holland', country: 'Netherlands', countryCode: 'NL' },
  },
  {
    latMin: 52.05, latMax: 52.13, lonMin: 5.05, lonMax: 5.20,
    result: { city: 'Utrecht', state: 'Utrecht', country: 'Netherlands', countryCode: 'NL' },
  },
  {
    latMin: 52.45, latMax: 52.60, lonMin: 13.25, lonMax: 13.55,
    result: { city: 'Berlin', state: 'Berlin', country: 'Germany', countryCode: 'DE' },
  },
  {
    latMin: 51.45, latMax: 51.55, lonMin: -0.20, lonMax: 0.00,
    result: { city: 'London', state: 'Greater London', country: 'United Kingdom', countryCode: 'GB' },
  },
];

function findReverseGeocodeResult(lat: number, lon: number): ReverseGeocodeResult | null {
  for (const region of mockReverseGeocodeRegions) {
    if (lat >= region.latMin && lat <= region.latMax && lon >= region.lonMin && lon <= region.lonMax) {
      return region.result;
    }
  }
  return null;
}

/**
 * Geocode API mock handlers
 */
export const geocodeHandlers = [
  /**
   * GET /geocode/search — proxied geocoder search
   * Matches requests to any host with /geocode/search path
   */
  http.get('*/geocode/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const limitValue = url.searchParams.get('limit');
    const limit = limitValue == null ? 5 : Number.parseInt(limitValue, 10);

    if (!query || query.length < 1 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
        { status: 400 }
      );
    }

    const results = findMockSuggestions(query, limit);
    return HttpResponse.json(results);
  }),

  /**
   * GET /geocode/reverse — reverse geocode a coordinate to city/region info
   * Matches requests to any host with /geocode/reverse path
   */
  http.get('*/geocode/reverse', ({ request }) => {
    const url = new URL(request.url);
    const lonStr = url.searchParams.get('lon');
    const latStr = url.searchParams.get('lat');

    if (!lonStr || !latStr) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
        { status: 400 }
      );
    }

    const lon = parseFloat(lonStr);
    const lat = parseFloat(latStr);

    if (
      isNaN(lon) ||
      isNaN(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
        { status: 400 }
      );
    }

    const result = findReverseGeocodeResult(lat, lon);
    return HttpResponse.json(result);
  }),
];

/**
 * Helper to add a mock geocode suggestion for testing
 */
export function addMockGeocodeSuggestion(suggestion: MockGeocodeSuggestion): void {
  mockGeocodeSuggestions.push(suggestion);
}

/**
 * Helper to clear all mock suggestions
 */
export function clearMockGeocodeSuggestions(): void {
  mockGeocodeSuggestions.length = 0;
}

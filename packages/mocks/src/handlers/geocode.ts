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
 * Geocode API mock handlers
 */
export const geocodeHandlers = [
  /**
   * GET /geocode/search — proxied geocoder search
   * Matches requests to any host with /geocode/search path
   */
  http.get('*/geocode/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    if (!query) {
      return HttpResponse.json([]);
    }

    const results = findMockSuggestions(query, limit);
    return HttpResponse.json(results);
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

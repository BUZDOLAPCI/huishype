/**
 * Unit tests for address-resolver service
 */

import {
  searchAddresses,
  type ResolvedAddress,
} from '../address-resolver';
import { apiGeocoder } from '../api-geocoder';
import type { GeocodeSuggestion } from '../geocoder';

// Mock the ApiGeocoder
jest.mock('../api-geocoder', () => ({
  apiGeocoder: {
    search: jest.fn(),
  },
}));

const mockSearch = apiGeocoder.search as jest.Mock;

/** Helper to create a mock GeocodeSuggestion */
function createMockSuggestion(overrides?: Partial<GeocodeSuggestion>): GeocodeSuggestion {
  return {
    id: 'W_12345',
    displayName: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
    street: 'Deflectiespoelstraat',
    houseNumber: '16',
    postalCode: '5651HP',
    city: 'Eindhoven',
    region: 'Noord-Brabant',
    countryCode: 'nl',
    coordinates: [5.4557789, 51.4300456],
    ...overrides,
  };
}

describe('address-resolver', () => {
  beforeEach(() => {
    mockSearch.mockClear();
  });

  describe('searchAddresses', () => {
    it('returns empty array for short queries', async () => {
      const result = await searchAddresses('a');
      expect(result).toEqual([]);
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('returns matching addresses for valid query', async () => {
      mockSearch.mockResolvedValueOnce([
        createMockSuggestion({ id: 'W_1' }),
        createMockSuggestion({
          id: 'W_2',
          displayName: 'Deflectiespoelstraat 33, 5651HP Eindhoven',
          houseNumber: '33',
        }),
      ]);

      const result = await searchAddresses('deflectiespoelstraat eindhoven');
      expect(result).toHaveLength(2);
      expect(result[0].bagId).toBe('W_1');
      expect(result[1].bagId).toBe('W_2');
    });

    it('passes countryCode option to geocoder', async () => {
      mockSearch.mockResolvedValueOnce([]);

      await searchAddresses('test', 5, { countryCode: 'NL' });
      expect(mockSearch).toHaveBeenCalledWith('test', { limit: 5, countryCode: 'NL' });
    });

    it('handles geocoder errors gracefully', async () => {
      mockSearch.mockRejectedValueOnce(new Error('Network error'));

      const result = await searchAddresses('test query');
      expect(result).toEqual([]);
    });

    it('maps GeocodeSuggestion coordinates correctly', async () => {
      mockSearch.mockResolvedValueOnce([
        createMockSuggestion({
          coordinates: [5.456, 51.43],
        }),
      ]);

      const result = await searchAddresses('test');
      expect(result[0].lon).toBe(5.456);
      expect(result[0].lat).toBe(51.43);
    });

    it('returns empty array for empty query', async () => {
      const result = await searchAddresses('');
      expect(result).toEqual([]);
      expect(mockSearch).not.toHaveBeenCalled();
    });
  });
});

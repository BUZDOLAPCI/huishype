/**
 * Unit tests for address-resolver service
 */

import {
  resolveUrlParams,
  searchAddresses,
  normalizeForUrl,
  createAddressUrl,
  determineViewType,
  type AddressUrlParams,
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

  describe('normalizeForUrl', () => {
    it('converts to lowercase', () => {
      expect(normalizeForUrl('Eindhoven')).toBe('eindhoven');
    });

    it('removes diacritics', () => {
      expect(normalizeForUrl('Groningen')).toBe('groningen');
    });

    it('replaces spaces with dashes', () => {
      expect(normalizeForUrl('Den Haag')).toBe('den-haag');
    });

    it('removes special characters', () => {
      expect(normalizeForUrl("'s-Hertogenbosch")).toBe('s-hertogenbosch');
    });

    it('handles postal codes', () => {
      expect(normalizeForUrl('5651 HP')).toBe('5651-hp');
      expect(normalizeForUrl('5651HP')).toBe('5651hp');
    });
  });

  describe('createAddressUrl', () => {
    it('creates correct URL from resolved address', () => {
      const address: ResolvedAddress = {
        bagId: 'test-id',
        formattedAddress: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
        lat: 51.43,
        lon: 5.456,
        details: {
          city: 'Eindhoven',
          zip: '5651HP',
          street: 'Deflectiespoelstraat',
          number: '16',
        },
      };

      expect(createAddressUrl(address)).toBe('/eindhoven/5651hp/deflectiespoelstraat/16');
    });

    it('handles multi-word street names', () => {
      const address: ResolvedAddress = {
        bagId: 'test-id',
        formattedAddress: 'Van Gogh Straat 42, 1000AB Amsterdam',
        lat: 52.37,
        lon: 4.89,
        details: {
          city: 'Amsterdam',
          zip: '1000AB',
          street: 'Van Gogh Straat',
          number: '42',
        },
      };

      expect(createAddressUrl(address)).toBe('/amsterdam/1000ab/van-gogh-straat/42');
    });
  });

  describe('determineViewType', () => {
    it('returns "invalid" for empty params', () => {
      expect(determineViewType({})).toBe('invalid');
    });

    it('returns "city" for city-only params', () => {
      expect(determineViewType({ city: 'eindhoven' })).toBe('city');
    });

    it('returns "postcode" for city + zipcode params', () => {
      expect(determineViewType({ city: 'eindhoven', zipcode: '5651hp' })).toBe('postcode');
    });

    it('returns "postcode" when missing housenumber', () => {
      expect(
        determineViewType({ city: 'eindhoven', zipcode: '5651hp', street: 'deflectiespoelstraat' })
      ).toBe('postcode');
    });

    it('returns "property" for full address params', () => {
      expect(
        determineViewType({
          city: 'eindhoven',
          zipcode: '5651hp',
          street: 'deflectiespoelstraat',
          housenumber: '16',
        })
      ).toBe('property');
    });
  });

  describe('resolveUrlParams', () => {
    it('returns null for empty params', async () => {
      const result = await resolveUrlParams({});
      expect(result).toBeNull();
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('calls geocoder with correct query for zipcode + housenumber', async () => {
      mockSearch.mockResolvedValueOnce([createMockSuggestion()]);

      const params: AddressUrlParams = {
        city: 'eindhoven',
        zipcode: '5651hp',
        street: 'deflectiespoelstraat',
        housenumber: '16',
      };

      const result = await resolveUrlParams(params);

      expect(mockSearch).toHaveBeenCalledWith('5651HP 16', { limit: 1 });
      expect(result).toEqual({
        bagId: 'W_12345',
        formattedAddress: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
        lat: 51.4300456,
        lon: 5.4557789,
        details: {
          city: 'Eindhoven',
          zip: '5651HP',
          street: 'Deflectiespoelstraat',
          number: '16',
        },
      });
    });

    it('returns null when geocoder returns no results', async () => {
      mockSearch.mockResolvedValueOnce([]);

      const params: AddressUrlParams = {
        city: 'eindhoven',
        zipcode: '9999xx',
        street: 'fakestraat',
        housenumber: '999',
      };

      const result = await resolveUrlParams(params);
      expect(result).toBeNull();
    });

    it('returns null on geocoder error', async () => {
      mockSearch.mockRejectedValueOnce(new Error('Network error'));

      const params: AddressUrlParams = {
        zipcode: '5651hp',
        housenumber: '16',
      };

      const result = await resolveUrlParams(params);
      expect(result).toBeNull();
    });
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
  });
});

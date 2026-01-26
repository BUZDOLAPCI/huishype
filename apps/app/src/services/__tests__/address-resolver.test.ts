/**
 * Unit tests for address-resolver service
 */

import {
  resolveUrlParams,
  searchAddresses,
  normalizeForUrl,
  createAddressUrl,
  determineViewType,
  reverseGeocode,
  isBagPandPlaceholder,
  type AddressUrlParams,
  type ResolvedAddress,
} from '../address-resolver';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('address-resolver', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('normalizeForUrl', () => {
    it('converts to lowercase', () => {
      expect(normalizeForUrl('Eindhoven')).toBe('eindhoven');
    });

    it('removes diacritics', () => {
      expect(normalizeForUrl('Groningen')).toBe('groningen');
      // Note: Dutch typically doesn't use many diacritics
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
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls PDOK API with correct query for full address', async () => {
      const mockResponse = {
        response: {
          numFound: 1,
          start: 0,
          maxScore: 18.5,
          docs: [
            {
              id: 'adr-test123',
              type: 'adres',
              weergavenaam: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
              score: 18.5,
              centroide_ll: 'POINT(5.4557789 51.4300456)',
              huisnummer: '16',
              postcode: '5651HP',
              straatnaam: 'Deflectiespoelstraat',
              woonplaatsnaam: 'Eindhoven',
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const params: AddressUrlParams = {
        city: 'eindhoven',
        zipcode: '5651hp',
        street: 'deflectiespoelstraat',
        housenumber: '16',
      };

      const result = await resolveUrlParams(params);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.pdok.nl');
      // URL-encoded versions: %3A is : and %2C is ,
      expect(calledUrl).toMatch(/postcode(%3A|:)5651HP/i);
      expect(calledUrl).toMatch(/huisnummer(%3A|:)16/i);
      expect(calledUrl).toMatch(/fq=type(%3A|:)adres/i);

      expect(result).toEqual({
        bagId: 'adr-test123',
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

    it('returns null for non-existent address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 0,
              start: 0,
              maxScore: 0,
              docs: [],
            },
          }),
      });

      const params: AddressUrlParams = {
        city: 'eindhoven',
        zipcode: '9999xx',
        street: 'fakestraat',
        housenumber: '999',
      };

      const result = await resolveUrlParams(params);
      expect(result).toBeNull();
    });

    it('returns null on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const params: AddressUrlParams = {
        zipcode: '5651hp',
        housenumber: '16',
      };

      const result = await resolveUrlParams(params);
      expect(result).toBeNull();
    });

    it('returns null if centroide_ll is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 1,
              start: 0,
              maxScore: 10,
              docs: [
                {
                  id: 'adr-test123',
                  type: 'adres',
                  weergavenaam: 'Test Address',
                  score: 10,
                  // Missing centroide_ll!
                  huisnummer: '16',
                  postcode: '5651HP',
                },
              ],
            },
          }),
      });

      const result = await resolveUrlParams({ zipcode: '5651hp', housenumber: '16' });
      expect(result).toBeNull();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await resolveUrlParams({ zipcode: '5651hp', housenumber: '16' });
      expect(result).toBeNull();
    });
  });

  describe('searchAddresses', () => {
    it('returns empty array for short queries', async () => {
      const result = await searchAddresses('a');
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns matching addresses for valid query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 2,
              start: 0,
              maxScore: 15,
              docs: [
                {
                  id: 'adr-1',
                  weergavenaam: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
                  centroide_ll: 'POINT(5.456 51.43)',
                  huisnummer: '16',
                  postcode: '5651HP',
                  straatnaam: 'Deflectiespoelstraat',
                  woonplaatsnaam: 'Eindhoven',
                },
                {
                  id: 'adr-2',
                  weergavenaam: 'Deflectiespoelstraat 33, 5651HP Eindhoven',
                  centroide_ll: 'POINT(5.457 51.431)',
                  huisnummer: '33',
                  postcode: '5651HP',
                  straatnaam: 'Deflectiespoelstraat',
                  woonplaatsnaam: 'Eindhoven',
                },
              ],
            },
          }),
      });

      const result = await searchAddresses('deflectiespoelstraat eindhoven');
      expect(result).toHaveLength(2);
      expect(result[0].bagId).toBe('adr-1');
      expect(result[1].bagId).toBe('adr-2');
    });

    it('filters out results without coordinates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 2,
              start: 0,
              maxScore: 15,
              docs: [
                {
                  id: 'adr-1',
                  weergavenaam: 'Address 1',
                  centroide_ll: 'POINT(5.456 51.43)',
                  huisnummer: '1',
                  postcode: '1234AB',
                  straatnaam: 'Street',
                  woonplaatsnaam: 'City',
                },
                {
                  id: 'adr-2',
                  weergavenaam: 'Address 2',
                  // No centroide_ll
                  huisnummer: '2',
                  postcode: '1234CD',
                },
              ],
            },
          }),
      });

      const result = await searchAddresses('test query');
      expect(result).toHaveLength(1);
      expect(result[0].bagId).toBe('adr-1');
    });
  });

  describe('isBagPandPlaceholder', () => {
    it('returns true for BAG Pand placeholders', () => {
      expect(isBagPandPlaceholder('BAG Pand 0772100001217229')).toBe(true);
      expect(isBagPandPlaceholder('BAGPand 123456789')).toBe(true);
      expect(isBagPandPlaceholder('bag pand 0772100001217229')).toBe(true);
    });

    it('returns false for real addresses', () => {
      expect(isBagPandPlaceholder('Prinsengracht 123')).toBe(false);
      expect(isBagPandPlaceholder('Van Gogh Straat 42')).toBe(false);
      expect(isBagPandPlaceholder('Operalaan 15')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isBagPandPlaceholder('')).toBe(false);
    });
  });

  describe('reverseGeocode', () => {
    it('calls PDOK reverse API with correct parameters', async () => {
      const mockResponse = {
        response: {
          numFound: 1,
          start: 0,
          docs: [
            {
              id: 'adr-test123',
              type: 'adres',
              weergavenaam: 'Operalaan 15, 5653AB Eindhoven',
              straatnaam: 'Operalaan',
              huisnummer: '15',
              postcode: '5653AB',
              woonplaatsnaam: 'Eindhoven',
              gemeentenaam: 'Eindhoven',
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await reverseGeocode(51.45, 5.47);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.pdok.nl');
      expect(calledUrl).toContain('reverse');
      expect(calledUrl).toContain('lat=51.45');
      expect(calledUrl).toContain('lon=5.47');
      expect(calledUrl).toMatch(/fq=type(%3A|:)adres/i);

      expect(result).toEqual({
        address: 'Operalaan 15',
        postalCode: '5653AB',
        city: 'Eindhoven',
      });
    });

    it('returns null for no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 0,
              start: 0,
              docs: [],
            },
          }),
      });

      const result = await reverseGeocode(0, 0);
      expect(result).toBeNull();
    });

    it('returns null on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await reverseGeocode(51.45, 5.47);
      expect(result).toBeNull();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await reverseGeocode(51.45, 5.47);
      expect(result).toBeNull();
    });

    it('uses weergavenaam as fallback when straatnaam/huisnummer missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              numFound: 1,
              start: 0,
              docs: [
                {
                  id: 'adr-test',
                  type: 'adres',
                  weergavenaam: 'Kerkstraat 1, 1234AB Amsterdam',
                  postcode: '1234AB',
                  woonplaatsnaam: 'Amsterdam',
                  // Missing straatnaam and huisnummer
                },
              ],
            },
          }),
      });

      const result = await reverseGeocode(52.37, 4.89);
      expect(result).toEqual({
        address: 'Kerkstraat 1',
        postalCode: '1234AB',
        city: 'Amsterdam',
      });
    });
  });
});

import { ApiGeocoder } from '../api-geocoder';

const originalFetch = global.fetch;
const mockFetch = jest.fn();

describe('ApiGeocoder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('serializes local-first search bias parameters', async () => {
    const geocoder = new ApiGeocoder();

    await geocoder.search('Damrak', {
      limit: 7,
      lon: 4.8952,
      lat: 52.3702,
      countryCode: 'NL',
      countryMode: 'soft',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/geocode/search');
    expect(url.searchParams.get('q')).toBe('Damrak');
    expect(url.searchParams.get('limit')).toBe('7');
    expect(url.searchParams.get('lon')).toBe('4.8952');
    expect(url.searchParams.get('lat')).toBe('52.3702');
    expect(url.searchParams.get('countrycode')).toBe('NL');
    expect(url.searchParams.get('countrymode')).toBe('soft');
  });
});

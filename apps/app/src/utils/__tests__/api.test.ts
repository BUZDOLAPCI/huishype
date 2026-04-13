import { api, resolveProperty, setApiAccessTokenResolver } from '../api';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'http://localhost:3100',
      },
    },
  },
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
  },
}));

describe('resolveProperty', () => {
  const mockFetch = jest.fn();
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    setApiAccessTokenResolver(null);
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  it('returns null when the backend resolves a different country than requested', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        countryCode: 'NL',
        address: 'Teststraat 42, 1234AB Amsterdam',
        postalCode: '1234AB',
        city: 'Amsterdam',
        coordinates: {
          lon: 4.9,
          lat: 52.37,
        },
        hasListing: false,
        officialValuation: null,
      }),
    });

    const result = await resolveProperty({
      postalCode: '1234AB',
      houseNumber: '42',
      countryCode: 'DE',
      street: 'Teststraat',
      city: 'Amsterdam',
    });

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/resolve?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('countryCode=DE');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('postalCode=1234AB');
  });

  it('keeps canonical transliterations from the backend result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '11111111-1111-4111-8111-111111111111',
        countryCode: 'DE',
        address: 'Bürgerstraße 15, 80331 München',
        postalCode: '80331',
        city: 'München',
        coordinates: {
          lon: 11.576124,
          lat: 48.137154,
        },
        hasListing: true,
        officialValuation: null,
      }),
    });

    const result = await resolveProperty({
      postalCode: '80331',
      houseNumber: '15',
      countryCode: 'DE',
      street: 'burgerstrasse',
      city: 'munchen',
    });

    expect(result?.address).toContain('Bürgerstraße');
    expect(result?.city).toBe('München');
  });
});

describe('api auth attachment', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    setApiAccessTokenResolver(null);
  });

  afterEach(() => {
    setApiAccessTokenResolver(null);
  });

  it('attaches the current access token when no Authorization header is provided', async () => {
    setApiAccessTokenResolver(async () => 'resolver-token');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await api.get('/properties/test-property');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/properties/test-property',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    );

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer resolver-token');
  });

  it('preserves an explicit Authorization header', async () => {
    setApiAccessTokenResolver(async () => 'resolver-token');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await api.get('/properties/test-property', {
      headers: {
        Authorization: 'Bearer explicit-token',
      },
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });
});

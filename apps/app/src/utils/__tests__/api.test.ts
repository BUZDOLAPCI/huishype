import { resolveProperty } from '../api';

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
});

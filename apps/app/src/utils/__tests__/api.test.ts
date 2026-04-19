import {
  api,
  fetchBatchProperties,
  fetchFollowingViewport,
  fetchNearbyGroup,
  normalizeNearbyPropertyGroup,
  normalizeRenderedPropertyGroup,
  resolveProperty,
  setApiAccessTokenResolver,
} from '../api';

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

describe('fetchNearbyGroup', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('threads committed map filters into the nearby request URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    await fetchNearbyGroup(5.4697, 51.4416, 15, {
      salePriceFrom: 500000,
      salePriceTo: 800000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale'],
      activity: 'recent',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/nearby?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceFrom=500000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceTo=800000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('marketState=for-sale');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('activity=recent');
  });
});

describe('fetchFollowingViewport', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('uses only bbox, price bounds, and market state in the authenticated viewport URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await fetchFollowingViewport({
      west: 5.4,
      south: 51.4,
      east: 5.5,
      north: 51.5,
    }, {
      salePriceFrom: 500000,
      salePriceTo: 800000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale'],
      activity: 'recent',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/following-viewport?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('bbox=5.4%2C51.4%2C5.5%2C51.5');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceFrom=500000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceTo=800000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('marketState=for-sale');
    expect(mockFetch.mock.calls[0]?.[0]).not.toContain('activity=');
    expect(mockFetch.mock.calls[0]?.[0]).not.toContain('socialScope');
  });
});

describe('fetchBatchProperties', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('returns the array response unchanged when the batch contract is respected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          id: '11111111-1111-4111-8111-111111111111',
          nationalId: null,
          countryCode: 'NL',
          address: 'Teststraat 1',
          city: 'Eindhoven',
          postalCode: '5611AA',
          geometry: { type: 'Point', coordinates: [5.4697, 51.4416] },
          yearBuilt: 1990,
          floorAreaM2: 100,
          status: 'active',
          officialValuation: 400000,
          hasListing: true,
          askingPrice: 425000,
          guessCount: 2,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ]),
    });

    const result = await fetchBatchProperties([
      '11111111-1111-4111-8111-111111111111',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('grouped property normalization', () => {
  it('preserves the shared nearby grouped contract fields', () => {
    expect(
      normalizeNearbyPropertyGroup({
        nodeClass: 'active',
        groupKind: 'single',
        primaryPropertyId: '11111111-1111-4111-8111-111111111111',
        pointCount: 1,
        propertyIds: ['11111111-1111-4111-8111-111111111111'],
        previewPropertyIds: ['11111111-1111-4111-8111-111111111111'],
        coordinate: [5.4697, 51.4416],
        distanceMeters: 12,
        bbox: null,
        activeListingCount: 1,
        socialCount: 2,
        recentSocialCount: 1,
        socialScoreTotal: 14,
        socialScoreMax: 14,
        recentSocialScoreTotal: 6,
        commentCount: 3,
        streetName: 'Teststraat',
        houseNumber: 12,
        houseNumberAddition: null,
        address: 'Teststraat 12',
        city: 'Eindhoven',
        postalCode: '5611AA',
        countryCode: 'NL',
        officialValuation: 425000,
        askingPrice: 450000,
        thumbnailUrl: null,
        yearBuilt: 1991,
        floorAreaM2: 123,
        hasActiveListing: true,
        marketState: 'for-sale',
      }),
    ).toMatchObject({
      activeListingCount: 1,
      socialCount: 2,
      recentSocialCount: 1,
      socialScoreTotal: 14,
      socialScoreMax: 14,
      recentSocialScoreTotal: 6,
      hasActiveListing: true,
      marketState: 'for-sale',
    });
  });

  it('accepts the cutover tile fields and preserves separate listing and social axes', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [5.4697, 51.4416],
      },
      properties: {
        node_class: 'active',
        group_kind: 'single',
        primary_property_id: '11111111-1111-4111-8111-111111111111',
        point_count: 1,
        property_ids: '11111111-1111-4111-8111-111111111111',
        preview_property_ids: '11111111-1111-4111-8111-111111111111',
        activeListingCount: 1,
        socialCount: 4,
        recentSocialCount: 2,
        socialScoreTotal: 18,
        socialScoreMax: 18,
        recentSocialScoreTotal: 8,
        commentCount: 3,
        hasActiveListing: true,
        marketState: 'for-sale',
      },
    } as const satisfies GeoJSON.Feature;

    expect(normalizeRenderedPropertyGroup(feature)).toMatchObject({
      activeListingCount: 1,
      socialCount: 4,
      recentSocialCount: 2,
      socialScoreTotal: 18,
      socialScoreMax: 18,
      recentSocialScoreTotal: 8,
      hasActiveListing: true,
      marketState: 'for-sale',
    });
  });
});

describe('API_URL runtime config', () => {
  const runtimeWindow = globalThis.window as typeof window & {
    __HUISHYPE_RUNTIME_CONFIG__?: {
      apiUrl?: string;
    };
  };
  const originalRuntimeConfig = runtimeWindow.__HUISHYPE_RUNTIME_CONFIG__;

  afterEach(() => {
    jest.resetModules();
    if (typeof originalRuntimeConfig === 'undefined') {
      Reflect.deleteProperty(runtimeWindow, '__HUISHYPE_RUNTIME_CONFIG__');
    } else {
      runtimeWindow.__HUISHYPE_RUNTIME_CONFIG__ = originalRuntimeConfig;
    }
  });

  it('prefers injected web runtime config over the bundled fallback', () => {
    runtimeWindow.__HUISHYPE_RUNTIME_CONFIG__ = {
      apiUrl: 'http://127.0.0.1:34001',
    };

    jest.isolateModules(() => {
      const apiModule = require('../api') as typeof import('../api');
      expect(apiModule.API_URL).toBe('http://127.0.0.1:34001');
    });
  });
});

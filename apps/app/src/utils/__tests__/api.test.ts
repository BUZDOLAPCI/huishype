import {
  api,
  fetchBatchProperties,
  fetchFollowingNearbyGroup,
  fetchNearbyGroup,
  fetchOfficialValuationFromSource,
  normalizeNearbyPropertyGroup,
  normalizeRenderedPropertyGroup,
  resolveProperty,
  setApiAccessTokenResolver,
  setOfficialValuationSourceFetcher,
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
      houseNumber: 42,
      countryCode: 'DE',
      street: 'Teststraat',
      city: 'Amsterdam',
    });

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/resolve?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('countryCode=DE');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('postalCode=1234AB');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('houseNumber=42');
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
      })
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

describe('official valuation source fetch', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    setOfficialValuationSourceFetcher(null);
  });

  it('does not call the injectable source fetcher for non-NL properties', async () => {
    const fetcher = jest.fn();
    setOfficialValuationSourceFetcher(fetcher);

    const result = await fetchOfficialValuationFromSource({
      propertyId: 'property-de',
      countryCode: 'DE',
      nationalId: null,
      address: 'Teststrasse 1',
      city: 'Berlin',
      postalCode: '10115',
    });

    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the injectable source fetcher for NL properties', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      source: 'woz',
      valuation: 450000,
      valuationYear: 2024,
      referenceDate: '2024-01-01',
    });
    setOfficialValuationSourceFetcher(fetcher);

    await expect(fetchOfficialValuationFromSource({
      propertyId: 'property-nl',
      countryCode: 'NL',
      nationalId: '0363010012345678',
      address: 'Teststraat 1',
      city: 'Amsterdam',
      postalCode: '1016 GV',
    })).resolves.toMatchObject({
      source: 'woz',
      valuation: 450000,
      valuationYear: 2024,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('validates a preferred BAG nummeraanduiding id with suggest before fetching WOZ', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          suggesties: [{ nummeraanduidingid: '123' }],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          wozObject: {
            wozobjectnummer: '987654321',
            postcode: '1234 AB',
            huisnummer: 41,
            straatnaam: 'Fixture Ring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [
            { peildatum: '2024-01-01', vastgesteldeWaarde: 410000 },
            { peildatum: '2025-01-01', vastgesteldeWaarde: 430000 },
          ],
        }),
      });

    await expect(fetchOfficialValuationFromSource({
      propertyId: 'property-nl',
      countryCode: 'NL',
      nationalId: '123',
      street: 'Fixture Ring',
      houseNumber: 41,
      houseNumberAddition: null,
      address: 'Fixture Ring 41, 1234 AB Eindhoven',
      city: 'Eindhoven',
      postalCode: '1234AB',
    })).resolves.toMatchObject({
      source: 'woz',
      valuation: 430000,
      valuationYear: 2025,
      sourceRecordId: '987654321',
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/suggest?aotids=0000000000000123',
    );
    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000123',
    );
  });

  it('uses Kadaster suggest when no usable BAG nummeraanduiding id is available', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          suggesties: [{ nummeraanduidingid: '456' }],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          wozObject: {
            wozobjectnummer: '123456789',
            postcode: '5612 AM',
            huisnummer: 41,
            straatnaam: 'Beeldbuisring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 455000 }],
        }),
      });

    await expect(fetchOfficialValuationFromSource({
      propertyId: 'property-nl',
      countryCode: 'NL',
      nationalId: null,
      street: 'Beeldbuisring',
      houseNumber: 41,
      houseNumberAddition: null,
      address: 'Beeldbuisring 41, 5612 AM Eindhoven',
      city: 'Eindhoven',
      postalCode: '5612 AM',
    })).resolves.toMatchObject({
      valuation: 455000,
      valuationYear: 2024,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/suggest?q=5612%20AM%2041',
    );
    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000456',
    );
  });

  it('falls back to address suggest when preferred BAG suggest validation misses', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          suggesties: [],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          suggesties: [{ wozobjectnummer: '987654321' }],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          wozObject: {
            wozobjectnummer: '987654321',
            postcode: '5612 AM',
            huisnummer: 41,
            straatnaam: 'Beeldbuisring',
            woonplaatsnaam: 'Eindhoven',
          },
          wozWaarden: [{ peildatum: '2024-01-01', vastgesteldeWaarde: 455000 }],
        }),
      });

    const result = await fetchOfficialValuationFromSource({
      propertyId: 'property-nl',
      countryCode: 'NL',
      nationalId: '123',
      street: 'Beeldbuisring',
      houseNumber: 41,
      houseNumberAddition: null,
      address: 'Beeldbuisring 41, 5612 AM Eindhoven',
      city: 'Eindhoven',
      postalCode: '5612 AM',
    });

    expect(result?.sourceUrl).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/wozobjectnummer/987654321',
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/suggest?aotids=0000000000000123',
    );
    expect(mockFetch.mock.calls.map((call) => call[0])).not.toContain(
      'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0000000000000123',
    );
  });

  it('stops repeat WOZ source fetches for the session after a 429', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 429,
      ok: false,
      headers: {
        get: (name: string) => name.toLowerCase() === 'retry-after' ? '60' : null,
      },
      json: async () => ({}),
    });

    const input = {
      propertyId: 'property-nl',
      countryCode: 'NL',
      nationalId: '123',
      street: 'Beeldbuisring',
      houseNumber: 41,
      houseNumberAddition: null,
      address: 'Beeldbuisring 41, 5612 AM Eindhoven',
      city: 'Eindhoven',
      postalCode: '5612 AM',
    };

    await expect(fetchOfficialValuationFromSource(input)).resolves.toBeNull();
    await expect(fetchOfficialValuationFromSource(input)).resolves.toBeNull();

    expect(mockFetch).toHaveBeenCalledTimes(1);
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
      activity: 'today',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/nearby?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceFrom=500000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceTo=800000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('marketState=for-sale');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('activity=today');
  });

  it('threads pyramid node identity into the nearby request URL as a pair', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    await fetchNearbyGroup(5.4697, 51.4416, 15, undefined, {
      pyramidVersionId: '9007199254740993123',
      pyramidNodeId: '9007199254740993999',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('pyramidVersionId=9007199254740993123');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('pyramidNodeId=9007199254740993999');
  });
});

describe('fetchFollowingNearbyGroup', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('threads committed map filters into the authenticated Following nearby request URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    await fetchFollowingNearbyGroup(
      5.4697,
      51.4416,
      15,
      {
        salePriceFrom: null,
        salePriceTo: 800000,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale'],
        activity: '30d',
      },
      '10d'
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/following-nearby?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('salePriceTo=800000');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('marketState=for-sale');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('activity=10d');
    expect(mockFetch.mock.calls[0]?.[0]).not.toContain('activity=30d');
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
      json: async () => [
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
      ],
    });

    const result = await fetchBatchProperties(['11111111-1111-4111-8111-111111111111']);

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
        pyramidVersionId: null,
        pyramidNodeId: null,
        membershipComplete: true,
        readStateCoverage: 'complete',
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
        isRead: true,
      })
    ).toMatchObject({
      activeListingCount: 1,
      socialCount: 2,
      recentSocialCount: 1,
      socialScoreTotal: 14,
      socialScoreMax: 14,
      recentSocialScoreTotal: 6,
      hasActiveListing: true,
      marketState: 'for-sale',
      isRead: true,
      membershipComplete: true,
      readStateCoverage: 'complete',
    });
  });

  it('accepts missing property_ids when a primary property id is present', () => {
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
        activeListingCount: 1,
        socialCount: 0,
        recentSocialCount: 0,
        socialScoreTotal: 0,
        socialScoreMax: 0,
        recentSocialScoreTotal: 0,
        commentCount: 0,
      },
    } as const satisfies GeoJSON.Feature;

    expect(normalizeRenderedPropertyGroup(feature)).toMatchObject({
      primaryPropertyId: '11111111-1111-4111-8111-111111111111',
      propertyIds: ['11111111-1111-4111-8111-111111111111'],
      previewPropertyIds: ['11111111-1111-4111-8111-111111111111'],
      membershipComplete: true,
      readStateCoverage: 'complete',
    });
  });

  it('does not fall back to full property_ids for incomplete pyramid clusters', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [5.4697, 51.4416],
      },
      properties: {
        node_class: 'active',
        group_kind: 'cluster',
        primary_property_id: '11111111-1111-4111-8111-111111111111',
        point_count: 12,
        property_ids: '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
        preview_property_ids: '',
        pyramid_version_id: '9007199254740993123',
        pyramid_node_id: '9007199254740993999',
        membership_complete: 'false',
        read_state_coverage: 'partial',
        activeListingCount: 2,
        socialCount: 0,
        recentSocialCount: 0,
        socialScoreTotal: 0,
        socialScoreMax: 0,
        recentSocialScoreTotal: 0,
        commentCount: 0,
      },
    } as const satisfies GeoJSON.Feature;

    expect(normalizeRenderedPropertyGroup(feature)).toMatchObject({
      pyramidVersionId: '9007199254740993123',
      pyramidNodeId: '9007199254740993999',
      membershipComplete: false,
      readStateCoverage: 'partial',
      propertyIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      previewPropertyIds: [],
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
        is_read: 'true',
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
      isRead: true,
    });
  });

  it('does not collapse nearby normalization back to legacy activity fields when composition is present', () => {
    expect(
      normalizeNearbyPropertyGroup({
        nodeClass: 'active',
        groupKind: 'single',
        primaryPropertyId: '11111111-1111-4111-8111-111111111111',
        pointCount: 1,
        propertyIds: ['11111111-1111-4111-8111-111111111111'],
        previewPropertyIds: ['11111111-1111-4111-8111-111111111111'],
        pyramidVersionId: null,
        pyramidNodeId: null,
        membershipComplete: true,
        readStateCoverage: 'complete',
        coordinate: [5.4697, 51.4416],
        distanceMeters: 12,
        bbox: null,
        activeListingCount: 0,
        socialCount: 0,
        recentSocialCount: 0,
        socialScoreTotal: 0,
        socialScoreMax: 0,
        recentSocialScoreTotal: 0,
        commentCount: 0,
        streetName: 'Teststraat',
        houseNumber: 12,
        houseNumberAddition: 'A',
        address: 'Teststraat 12A',
        city: 'Eindhoven',
        postalCode: '5611AA',
        countryCode: 'NL',
        officialValuation: 425000,
        askingPrice: null,
        thumbnailUrl: null,
        yearBuilt: 1991,
        floorAreaM2: 123,
        hasActiveListing: false,
        marketState: 'not-listed',
        activityScore: 99,
        activityScoreTotal: 99,
        hasListing: true,
      })
    ).toMatchObject({
      activeListingCount: 0,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      hasActiveListing: false,
      hasListing: false,
      activityScore: 0,
      activityScoreTotal: 0,
      houseNumberAddition: 'A',
    });
  });

  it('ignores legacy tile fallback fields when additive composition fields are authoritative', () => {
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
        activeListingCount: 0,
        socialCount: 0,
        recentSocialCount: 0,
        socialScoreTotal: 0,
        socialScoreMax: 0,
        recentSocialScoreTotal: 0,
        commentCount: 0,
        hasActiveListing: false,
        marketState: 'not-listed',
        hasListing: true,
        activityScore: 88,
        activityScoreTotal: 144,
      },
    } as const satisfies GeoJSON.Feature;

    expect(normalizeRenderedPropertyGroup(feature)).toMatchObject({
      activeListingCount: 0,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      hasActiveListing: false,
      hasListing: false,
      activityScore: 0,
      activityScoreTotal: 0,
      marketState: 'not-listed',
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

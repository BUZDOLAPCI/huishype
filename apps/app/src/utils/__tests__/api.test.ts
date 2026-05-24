import {
  api,
  fetchBatchProperties,
  fetchFollowingNearbyGroup,
  fetchHouseNumberTapResolve,
  fetchNearbyGroup,
  fetchPhysicalTapResolve,
  fetchCurrentOfficialValuationStatus,
  normalizeNearbyPropertyGroup,
  normalizeRenderedPropertyGroup,
  resolveProperty,
  setApiAccessTokenResolver,
  submitOfficialValuationHydration,
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

describe('fetchPhysicalTapResolve', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    setApiAccessTokenResolver(null);
  });

  it('normalizes the single physical tap resolver contract', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        kind: 'single',
        source: 'physical-tap',
        match: 'containing-building',
        coordinate: { longitude: 4.9, latitude: 52.37 },
        property: {
          id: 'property-1',
          address: 'Main Street 1',
          city: 'Eindhoven',
          postalCode: '5611AA',
          countryCode: 'NL',
          street: 'Main Street',
          coordinate: { longitude: 4.9, latitude: 52.37 },
          imageryCoordinate: { longitude: 4.901, latitude: 52.371 },
          hasActiveListing: true,
          askingPrice: 425000,
          officialValuationYear: 2024,
          isRead: false,
        },
      }),
    });

    const result = await fetchPhysicalTapResolve(4.9, 52.37, 17);

    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/resolve-tap?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('lon=4.9');
    expect(result).toEqual(
      expect.objectContaining({
        source: 'physical-tap',
        match: 'containing-building',
        groupKind: 'single',
        primaryPropertyId: 'property-1',
        coordinate: [4.9, 52.37],
        askingPrice: 425000,
        hasActiveListing: true,
        isRead: false,
      }),
    );
    expect(result?.streetName).toBe('Main Street');
    expect(result?.previewProperties?.[0]).toEqual(
      expect.objectContaining({
        streetName: 'Main Street',
        imageryGeometry: { type: 'Point', coordinates: [4.901, 52.371] },
        officialValuationYear: 2024,
      }),
    );
  });

  it('normalizes grouped physical tap preview properties using the top-level tap coordinate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        kind: 'group',
        source: 'physical-tap',
        match: 'nearby-building',
        coordinate: { longitude: 4.91, latitude: 52.38 },
        group: {
          primaryPropertyId: 'property-2',
          pointCount: 2,
          coordinate: { longitude: 4.92, latitude: 52.39 },
          bbox: [4.90, 52.37, 4.93, 52.40],
          previewPropertyIds: ['property-2', 'property-3'],
          previewProperties: [
            {
              id: 'property-2',
              address: 'Main Street 2',
              city: 'Eindhoven',
              postalCode: '5611AB',
              countryCode: 'NL',
            },
            {
              id: 'property-3',
              address: 'Main Street 3',
              city: 'Eindhoven',
              postalCode: '5611AC',
              countryCode: 'NL',
            },
          ],
        },
      }),
    });

    const result = await fetchPhysicalTapResolve(4.91, 52.38, 17);

    expect(result).toEqual(
      expect.objectContaining({
        source: 'physical-tap',
        match: 'nearby-building',
        groupKind: 'cluster',
        primaryPropertyId: 'property-2',
        previewPropertyIds: ['property-2', 'property-3'],
        coordinate: [4.91, 52.38],
        bbox: {
          west: 4.90,
          south: 52.37,
          east: 4.93,
          north: 52.40,
        },
      }),
    );
    expect(result?.previewProperties?.map((property) => property.id)).toEqual([
      'property-2',
      'property-3',
    ]);
    expect(result?.previewProperties?.[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [4.92, 52.39],
    });
  });

  it('returns null for no physical tap match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => null,
    });

    await expect(fetchPhysicalTapResolve(4.9, 52.37, 16)).resolves.toBeNull();
  });
});

describe('fetchHouseNumberTapResolve', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    setApiAccessTokenResolver(null);
  });

  it('calls the house-number tap route and normalizes the preview contract', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        kind: 'single',
        source: 'house-number-tap',
        match: 'house-number',
        coordinate: { longitude: 4.9, latitude: 52.37 },
        property: {
          id: 'property-house-number',
          address: 'Main Street 12A',
          city: 'Eindhoven',
          postalCode: '5611AA',
          countryCode: 'NL',
          street: 'Main Street',
          houseNumber: 12,
          houseNumberAddition: 'A',
          coordinate: { longitude: 4.9, latitude: 52.37 },
          isRead: false,
        },
      }),
    });

    const result = await fetchHouseNumberTapResolve(4.9, 52.37, 17, '12A');

    expect(mockFetch.mock.calls[0]?.[0]).toContain('/properties/resolve-house-number-tap?');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('houseNumber=12A');
    expect(result).toEqual(
      expect.objectContaining({
        source: 'house-number-tap',
        match: 'house-number',
        groupKind: 'single',
        primaryPropertyId: 'property-house-number',
        houseNumber: 12,
        houseNumberAddition: 'A',
      }),
    );
  });
});

describe('official valuation API hydration', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('requests server-side WOZ hydration without submitting a client-observed valuation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        propertyId: 'property-nl',
        source: 'woz',
        status: 'queued',
        valuationYear: 2025,
        officialValuation: null,
        officialValuationYear: null,
        officialValuationVerified: false,
        job: { id: 'job-1', state: 'queued', nextAttemptAt: null },
      }),
    });

    await submitOfficialValuationHydration('property-nl', 'token-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/properties/property-nl/official-valuations/hydrate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ source: 'woz' }),
        headers: expect.any(Headers),
      }),
    );
    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('reads current WOZ status only from the HuisHype API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        propertyId: 'property-nl',
        source: 'woz',
        expectedValuationYear: 2025,
        officialValuation: 455000,
        officialValuationYear: 2025,
        officialValuationVerified: true,
        job: null,
        sourceState: null,
      }),
    });

    await expect(fetchCurrentOfficialValuationStatus('property-nl')).resolves.toMatchObject({
      officialValuation: 455000,
      officialValuationVerified: true,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'http://localhost:3100/properties/property-nl/official-valuations/current?source=woz',
    );
    expect(String(mockFetch.mock.calls[0]?.[0])).not.toContain('kadaster.nl');
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
      pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      pyramidNodeId: 'pyramid-node-9007199254740993999',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain(
      'pyramidVersionId=9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
    );
    expect(mockFetch.mock.calls[0]?.[0]).toContain(
      'pyramidNodeId=pyramid-node-9007199254740993999',
    );
  });

  it('retries stale pyramid node nearby lookups without node identity', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'x-huishype-nearby-status': 'pyramid-stale' }),
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'x-huishype-nearby-status': 'pyramid-promoted' }),
        json: async () => ({
          nodeClass: 'active',
          groupKind: 'cluster',
          primaryPropertyId: '11111111-1111-4111-8111-111111111111',
          pointCount: 2,
          propertyIds: [],
          previewPropertyIds: ['11111111-1111-4111-8111-111111111111'],
          pyramidVersionId: '22222222-2222-4222-8222-222222222222',
          pyramidNodeId: 'pyramid-node-current',
          membershipComplete: false,
          readStateCoverage: 'partial',
          coordinate: [5.4697, 51.4416],
          distanceMeters: 8,
          bbox: [5.46, 51.43, 5.48, 51.45],
          activeListingCount: 1,
          socialCount: 0,
          recentSocialCount: 0,
          socialScoreTotal: 0,
          socialScoreMax: 0,
          recentSocialScoreTotal: 0,
          commentCount: 0,
          streetName: null,
          houseNumber: null,
          houseNumberAddition: null,
          address: null,
          city: null,
          postalCode: null,
          countryCode: null,
          officialValuation: null,
          askingPrice: null,
          thumbnailUrl: null,
          isRead: false,
        }),
      });

    const result = await fetchNearbyGroup(5.4697, 51.4416, 10.75, undefined, {
      pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      pyramidNodeId: 'pyramid-node-stale',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]?.[0]).toContain('pyramidVersionId=');
    expect(mockFetch.mock.calls[0]?.[0]).toContain('pyramidNodeId=');
    expect(mockFetch.mock.calls[1]?.[0]).not.toContain('pyramidVersionId=');
    expect(mockFetch.mock.calls[1]?.[0]).not.toContain('pyramidNodeId=');
    expect(result).toMatchObject({
      pyramidVersionId: '22222222-2222-4222-8222-222222222222',
      pyramidNodeId: 'pyramid-node-current',
      previewPropertyIds: ['11111111-1111-4111-8111-111111111111'],
      membershipComplete: false,
      readStateCoverage: 'partial',
    });
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

  it('honors incomplete nearby cluster metadata from snake_case transport fields', () => {
    const result = normalizeNearbyPropertyGroup({
      nodeClass: 'active',
      groupKind: 'cluster',
      primaryPropertyId: '11111111-1111-4111-8111-111111111111',
      pointCount: 12,
      property_ids:
        '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
      preview_property_ids: '',
      pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      pyramidNodeId: 'pyramid-node-9007199254740993999',
      membership_complete: 'false',
      read_state_coverage: 'partial',
      propertyIds: [],
      previewPropertyIds: [],
      coordinate: [5.4697, 51.4416],
      distanceMeters: 12,
      bbox: [5.46, 51.43, 5.48, 51.45],
      activeListingCount: 2,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      commentCount: 0,
      streetName: null,
      houseNumber: null,
      houseNumberAddition: null,
      address: null,
      city: null,
      postalCode: null,
      countryCode: null,
      officialValuation: null,
      askingPrice: null,
      thumbnailUrl: null,
      isRead: false,
    } as unknown as Parameters<typeof normalizeNearbyPropertyGroup>[0]);

    expect(result).toMatchObject({
      membershipComplete: false,
      readStateCoverage: 'partial',
      propertyIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      previewPropertyIds: [],
    });
  });

  it('does not expand partial nearby clusters to full property ids', () => {
    const result = normalizeNearbyPropertyGroup({
      nodeClass: 'active',
      groupKind: 'cluster',
      primaryPropertyId: '11111111-1111-4111-8111-111111111111',
      pointCount: 12,
      propertyIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      previewPropertyIds: [],
      pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      pyramidNodeId: 'pyramid-node-9007199254740993999',
      membershipComplete: true,
      readStateCoverage: 'partial',
      coordinate: [5.4697, 51.4416],
      distanceMeters: 12,
      bbox: [5.46, 51.43, 5.48, 51.45],
      activeListingCount: 2,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      commentCount: 0,
      streetName: null,
      houseNumber: null,
      houseNumberAddition: null,
      address: null,
      city: null,
      postalCode: null,
      countryCode: null,
      officialValuation: null,
      askingPrice: null,
      thumbnailUrl: null,
      isRead: false,
    });

    expect(result.previewPropertyIds).toEqual([]);
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
        pyramid_version_id: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
        pyramid_node_id: 'pyramid-node-9007199254740993999',
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
      pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      pyramidNodeId: 'pyramid-node-9007199254740993999',
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
        isRead: false,
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

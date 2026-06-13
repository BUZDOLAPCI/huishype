import {
  getPersistedMapSocialScope,
  parseMapRoutePath,
  parseMapSocialScopeFromSearchParams,
  persistMapSocialScope,
  registerLocalPreviewRoute,
  clearLocalPreviewRouteCache,
  resolveMapRoute,
} from '../mapRoute';

const mockResolveProperty = jest.fn();

jest.mock('@/src/utils/api', () => ({
  resolveProperty: (...args: unknown[]) => mockResolveProperty(...args),
}));

describe('resolveMapRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLocalPreviewRouteCache();
  });

  it('parses map-scoped social routes separately from static social routes', () => {
    expect(
      parseMapRoutePath('/map/eindhoven/1234ab/teststraat/42-a/comments'),
    ).toMatchObject({
      kind: 'map-comments',
      pathname: '/map/eindhoven/1234ab/teststraat/42-a/comments',
    });
    expect(
      parseMapRoutePath('/map/eindhoven/1234ab/teststraat/42-a/guesses'),
    ).toMatchObject({
      kind: 'map-guesses',
      pathname: '/map/eindhoven/1234ab/teststraat/42-a/guesses',
    });
    expect(
      parseMapRoutePath('/eindhoven/1234ab/teststraat/42-a/comments'),
    ).toMatchObject({
      kind: 'comments',
      pathname: '/eindhoven/1234ab/teststraat/42-a/comments',
    });
  });

  it('resolves map-scoped comments to a map overlay canonical path', async () => {
    mockResolveProperty.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      countryCode: 'NL',
      address: 'Teststraat 42 A, 1234AB Eindhoven',
      postalCode: '1234AB',
      city: 'Eindhoven',
      coordinates: {
        lon: 5.4697,
        lat: 51.4416,
      },
      hasActiveListing: false,
      marketState: 'not-listed',
      officialValuation: null,
    });

    await expect(
      resolveMapRoute('/map/eindhoven/1234ab/teststraat/42-a/comments'),
    ).resolves.toMatchObject({
      kind: 'map-comments',
      canonicalPath: '/map/eindhoven/1234ab/teststraat/42-a/comments',
      property: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
      }),
    });
  });

  it('resolves locally registered map-scoped comments without calling /properties/resolve', async () => {
    registerLocalPreviewRoute(
      '/map/eindhoven/1234ab/teststraat/42-a',
      {
        id: '11111111-1111-4111-8111-111111111111',
        countryCode: 'NL',
        address: 'Teststraat 42 A, 1234AB Eindhoven',
        postalCode: '1234AB',
        city: 'Eindhoven',
        coordinates: {
          lon: 5.4697,
          lat: 51.4416,
        },
        hasActiveListing: false,
        marketState: 'not-listed',
        officialValuation: null,
        officialValuationYear: null,
        officialValuationSourceFetch: null,
      },
      {
        city: 'Eindhoven',
        postalCode: '1234AB',
        streetName: 'Teststraat',
        houseNumber: '42',
        houseNumberAddition: 'A',
        countryCode: 'NL',
      },
    );

    await expect(
      resolveMapRoute('/map/eindhoven/1234ab/teststraat/42-a/comments'),
    ).resolves.toMatchObject({
      kind: 'map-comments',
      canonicalPath: '/map/eindhoven/1234ab/teststraat/42-a/comments',
      property: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
      }),
    });

    expect(mockResolveProperty).not.toHaveBeenCalled();
  });

  it('resolves locally registered map-scoped guesses without calling /properties/resolve', async () => {
    registerLocalPreviewRoute(
      '/map/eindhoven/1234ab/teststraat/42-a',
      {
        id: '11111111-1111-4111-8111-111111111111',
        countryCode: 'NL',
        address: 'Teststraat 42 A, 1234AB Eindhoven',
        postalCode: '1234AB',
        city: 'Eindhoven',
        coordinates: {
          lon: 5.4697,
          lat: 51.4416,
        },
        hasActiveListing: false,
        marketState: 'not-listed',
        officialValuation: null,
        officialValuationYear: null,
        officialValuationSourceFetch: null,
      },
      {
        city: 'Eindhoven',
        postalCode: '1234AB',
        streetName: 'Teststraat',
        houseNumber: '42',
        houseNumberAddition: 'A',
        countryCode: 'NL',
      },
    );

    await expect(
      resolveMapRoute('/map/eindhoven/1234ab/teststraat/42-a/guesses'),
    ).resolves.toMatchObject({
      kind: 'map-guesses',
      canonicalPath: '/map/eindhoven/1234ab/teststraat/42-a/guesses',
      property: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
      }),
    });

    expect(mockResolveProperty).not.toHaveBeenCalled();
  });

  it('resolves canonical address routes directly through /properties/resolve', async () => {
    mockResolveProperty.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      countryCode: 'NL',
      address: 'Teststraat 42 A, 1234AB Eindhoven',
      postalCode: '1234AB',
      city: 'Eindhoven',
      coordinates: {
        lon: 5.4697,
        lat: 51.4416,
      },
      hasActiveListing: false,
      marketState: 'not-listed',
      officialValuation: null,
    });

    await expect(
      resolveMapRoute('/eindhoven/1234ab/teststraat/42-a'),
    ).resolves.toMatchObject({
      kind: 'property',
      canonicalPath: '/eindhoven/1234ab/teststraat/42-a',
      property: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
      }),
      routeInput: expect.objectContaining({
        city: 'Eindhoven',
        postalCode: '1234AB',
        streetName: 'teststraat',
        houseNumber: '42',
        houseNumberAddition: 'a',
        countryCode: 'NL',
      }),
    });

    expect(mockResolveProperty).toHaveBeenCalledWith({
      postalCode: '1234 AB',
      houseNumber: 42,
      houseNumberAddition: 'a',
      countryCode: 'NL',
      street: 'teststraat',
      city: 'eindhoven',
    });
  });

  it('collapses non-existent address routes when /properties/resolve returns null', async () => {
    mockResolveProperty.mockResolvedValueOnce(null);

    await expect(
      resolveMapRoute('/eindhoven/9999xx/fakestraat/999'),
    ).resolves.toEqual({
      kind: 'invalid',
      canonicalPath: '/',
      reason: 'property-not-found',
    });

    expect(mockResolveProperty).toHaveBeenCalledWith({
      postalCode: '9999 XX',
      houseNumber: 999,
      houseNumberAddition: null,
      countryCode: 'NL',
      street: 'fakestraat',
      city: 'eindhoven',
    });
  });

  it('collapses address routes when the resolved property has no coordinates', async () => {
    mockResolveProperty.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      countryCode: 'NL',
      address: 'Teststraat 42 A, 1234AB Eindhoven',
      postalCode: '1234AB',
      city: 'Eindhoven',
      coordinates: null,
      hasActiveListing: false,
      marketState: 'not-listed',
      officialValuation: null,
    });

    await expect(
      resolveMapRoute('/eindhoven/1234ab/teststraat/42-a'),
    ).resolves.toEqual({
      kind: 'invalid',
      canonicalPath: '/',
      reason: 'property-missing-coordinates',
    });
  });
});

describe('map social scope search params', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });

  it('parses following from shared scope query params', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('scope=following'),
      ),
    ).toBe('following');
  });

  it('defaults unknown values back to all', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('scope=something-else'),
      ),
    ).toBe('all');
  });

  it('does not persist following in private browser app state', () => {
    window.history.replaceState({ keep: 'value' }, '', '/?returnTo=%2Ffeed');

    persistMapSocialScope('following');

    expect(window.location.search).toBe('?returnTo=%2Ffeed');
    expect(window.history.state).toEqual({ keep: 'value' });
  });

  it('reads shared scope query params instead of private app state', () => {
    window.history.replaceState({}, '', '/?scope=following');

    expect(getPersistedMapSocialScope(new URLSearchParams(window.location.search))).toBe(
      'following',
    );
  });

  it('does not fall back to deprecated socialScope query params', () => {
    expect(getPersistedMapSocialScope(new URLSearchParams('socialScope=following'))).toBe('all');
  });

  it('leaves browser state untouched when returning to all', () => {
    window.history.replaceState({ keep: 'value' }, '', '/?returnTo=%2Ffeed');
    window.sessionStorage.setItem('huishype.map.socialScope', 'following');

    persistMapSocialScope('all');

    expect(window.location.search).toBe('?returnTo=%2Ffeed');
    expect(window.history.state).toEqual({ keep: 'value' });
    expect(window.sessionStorage.getItem('huishype.map.socialScope')).toBe('following');
  });
});

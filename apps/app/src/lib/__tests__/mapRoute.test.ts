import {
  getPersistedMapSocialScope,
  parseMapSocialScopeFromSearchParams,
  persistMapSocialScope,
  resolveMapRoute,
} from '../mapRoute';

const mockResolveProperty = jest.fn();

jest.mock('@/src/utils/api', () => ({
  resolveProperty: (...args: unknown[]) => mockResolveProperty(...args),
}));

describe('resolveMapRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('ignores deprecated socialScope query params', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('socialScope=following'),
      ),
    ).toBe('all');
  });

  it('defaults unknown values back to all', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('socialScope=something-else'),
      ),
    ).toBe('all');
  });

  it('persists following in private browser app state without touching the URL', () => {
    window.history.replaceState({ keep: 'value' }, '', '/?returnTo=%2Ffeed');

    persistMapSocialScope('following');

    expect(window.location.search).toBe('?returnTo=%2Ffeed');
    expect(window.history.state).toEqual({
      keep: 'value',
      huishypeMapView: {
        socialScope: 'following',
      },
    });
    expect(window.sessionStorage.getItem('huishype.map.socialScope')).toBe('following');
  });

  it('reads persisted state before falling back to legacy query params', () => {
    window.history.replaceState(
      {
        huishypeMapView: {
          socialScope: 'following',
        },
      },
      '',
      '/?socialScope=all',
    );

    expect(
      getPersistedMapSocialScope(new URLSearchParams(window.location.search)),
    ).toBe('following');
  });

  it('does not fall back to deprecated socialScope query params without private app state', () => {
    expect(getPersistedMapSocialScope(new URLSearchParams('socialScope=following'))).toBe('all');
  });

  it('clears persisted app state when returning to all', () => {
    window.history.replaceState(
      {
        huishypeMapView: {
          socialScope: 'following',
        },
      },
      '',
      '/?returnTo=%2Ffeed',
    );
    window.sessionStorage.setItem('huishype.map.socialScope', 'following');

    persistMapSocialScope('all');

    expect(window.location.search).toBe('?returnTo=%2Ffeed');
    expect(window.history.state).toEqual({});
    expect(window.sessionStorage.getItem('huishype.map.socialScope')).toBeNull();
  });
});

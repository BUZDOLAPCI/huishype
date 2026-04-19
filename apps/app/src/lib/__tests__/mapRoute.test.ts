import {
  parseMapSocialScopeFromSearchParams,
  resolveMapRoute,
  updateMapSocialScopeSearchParams,
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
      houseNumber: '42',
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
      houseNumber: '999',
      houseNumberAddition: null,
      countryCode: 'NL',
      street: 'fakestraat',
      city: 'eindhoven',
    });
  });
});

describe('map social scope search params', () => {
  it('parses following as app-local map state', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('socialScope=following'),
      ),
    ).toBe('following');
  });

  it('defaults unknown values back to all', () => {
    expect(
      parseMapSocialScopeFromSearchParams(
        new URLSearchParams('socialScope=something-else'),
      ),
    ).toBe('all');
  });

  it('serializes following without disturbing unrelated params', () => {
    const params = updateMapSocialScopeSearchParams(
      new URLSearchParams('returnTo=%2Ffeed&salePriceFrom=500000'),
      'following',
    );

    expect(params.get('socialScope')).toBe('following');
    expect(params.get('returnTo')).toBe('/feed');
    expect(params.get('salePriceFrom')).toBe('500000');
  });

  it('clears the app-local param when returning to all', () => {
    const params = updateMapSocialScopeSearchParams(
      new URLSearchParams('socialScope=following&returnTo=%2Ffeed'),
      'all',
    );

    expect(params.has('socialScope')).toBe(false);
    expect(params.get('returnTo')).toBe('/feed');
  });
});

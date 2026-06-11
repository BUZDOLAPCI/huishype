import {
  buildCanonicalRouteHref,
  buildPropertyCommentsRoute,
  buildPropertyGuessesRoute,
  buildPropertyMapCommentsRoute,
  buildPropertyMapGuessesRoute,
  buildPropertyMapRoute,
  buildPropertyRoute,
  isStaticAppRoutePath,
  normalizePropertyReturnTarget,
  toCanonicalPropertyRouteInput,
  toInternalAppHref,
} from '../property-route';

const canonicalProperty = {
  countryCode: 'NL',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  street: 'Nieuwe Emmasingel',
  houseNumber: 12,
  houseNumberAddition: 'B',
};

describe('property-route', () => {
  it('adapts app property data into the shared canonical contract', () => {
    expect(toCanonicalPropertyRouteInput(canonicalProperty)).toEqual({
      countryCode: 'NL',
      city: 'Eindhoven',
      postalCode: '5600 AA',
      streetName: 'Nieuwe Emmasingel',
      houseNumber: '12',
      houseNumberAddition: 'B',
    });
  });

  it('builds canonical property, preview, comments, and guesses routes', () => {
    expect(buildPropertyRoute(canonicalProperty)).toBe(
      '/eindhoven/5600aa/nieuwe-emmasingel/12-b',
    );
    expect(buildPropertyMapRoute(canonicalProperty)).toBe(
      '/map/eindhoven/5600aa/nieuwe-emmasingel/12-b',
    );
    expect(buildPropertyMapCommentsRoute(canonicalProperty)).toBe(
      '/map/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments',
    );
    expect(buildPropertyMapGuessesRoute(canonicalProperty)).toBe(
      '/map/eindhoven/5600aa/nieuwe-emmasingel/12-b/guesses',
    );
    expect(buildPropertyCommentsRoute(canonicalProperty)).toBe(
      '/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments',
    );
    expect(buildPropertyGuessesRoute(canonicalProperty)).toBe(
      '/eindhoven/5600aa/nieuwe-emmasingel/12-b/guesses',
    );
  });

  it('appends a validated internal return target', () => {
    expect(buildPropertyRoute(canonicalProperty, '/saved')).toBe(
      '/eindhoven/5600aa/nieuwe-emmasingel/12-b?returnTo=%2Fsaved',
    );
  });

  it('appends validated returnTo targets to canonical route hrefs', () => {
    expect(
      buildCanonicalRouteHref('/eindhoven/5600aa/nieuwe-emmasingel/12-b', '/feed'),
    ).toBe('/eindhoven/5600aa/nieuwe-emmasingel/12-b?returnTo=%2Ffeed');
    expect(
      buildCanonicalRouteHref('/eindhoven/5600aa/nieuwe-emmasingel/12-b', ['/feed']),
    ).toBe('/eindhoven/5600aa/nieuwe-emmasingel/12-b');
    expect(
      buildCanonicalRouteHref(
        '/eindhoven/5600aa/nieuwe-emmasingel/12-b',
        'https://evil.example/x',
      ),
    ).toBe('/eindhoven/5600aa/nieuwe-emmasingel/12-b');
  });

  it('normalizes only safe internal return targets', () => {
    expect(normalizePropertyReturnTarget('/feed')).toBe('/feed');
    expect(
      normalizePropertyReturnTarget(
        '/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments?returnTo=%2Ffeed',
      ),
    ).toBe('/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments?returnTo=%2Ffeed');
    expect(normalizePropertyReturnTarget('/comments?returnTo=%2Ffeed')).toBeNull();
    expect(normalizePropertyReturnTarget('/property/123')).toBeNull();
    expect(normalizePropertyReturnTarget('/guesses/123')).toBeNull();
    expect(normalizePropertyReturnTarget('/comments/123')).toBeNull();
    expect(
      normalizePropertyReturnTarget('/map/eindhoven/5600aa/nieuwe-emmasingel/12-b'),
    ).toBe('/map/eindhoven/5600aa/nieuwe-emmasingel/12-b');
    expect(normalizePropertyReturnTarget('https://example.com')).toBeNull();
  });

  it('keeps canonical address and map routes as raw strings', () => {
    expect(toInternalAppHref('/map/eindhoven/5600aa/nieuwe-emmasingel/12-b')).toBe(
      '/map/eindhoven/5600aa/nieuwe-emmasingel/12-b',
    );
    expect(
      toInternalAppHref('/map/de/berlin/10115/friedrichstrasse/12?returnTo=%2Ffeed'),
    ).toBe('/map/de/berlin/10115/friedrichstrasse/12?returnTo=%2Ffeed');
    expect(
      toInternalAppHref('/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments?returnTo=%2Ffeed'),
    ).toBe('/eindhoven/5600aa/nieuwe-emmasingel/12-b/comments?returnTo=%2Ffeed');
  });

  it('treats static app routes as non-map paths', () => {
    expect(isStaticAppRoutePath('/showcase/consensus-alignment')).toBe(true);
    expect(isStaticAppRoutePath('/notifications')).toBe(true);
    expect(isStaticAppRoutePath('/leaderboard')).toBe(true);
    expect(isStaticAppRoutePath('/settings/privacy')).toBe(true);
    expect(isStaticAppRoutePath('/privacy')).toBe(true);
    expect(isStaticAppRoutePath('/help/article/price-guesses')).toBe(true);
    expect(isStaticAppRoutePath('/contact')).toBe(true);
    expect(isStaticAppRoutePath('/glossary/woz-value')).toBe(true);
    expect(isStaticAppRoutePath('/eindhoven/5600aa/nieuwe-emmasingel/12-b')).toBe(false);
    expect(isStaticAppRoutePath('/map/eindhoven/5600aa/nieuwe-emmasingel/12-b')).toBe(false);
    expect(isStaticAppRoutePath('/@51.4416,5.4697,14z')).toBe(false);
  });

  it('throws when required address fields are missing', () => {
    expect(() =>
      buildPropertyRoute({
        city: 'Eindhoven',
        postalCode: '5600 AA',
        street: 'Nieuwe Emmasingel',
      }),
    ).toThrow('Missing house number');
  });
});

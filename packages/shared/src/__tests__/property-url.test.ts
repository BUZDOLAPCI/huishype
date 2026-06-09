import { describe, expect, it } from 'vitest';
import {
  appendInternalReturnTo,
  buildCanonicalCityMapPath,
  buildCanonicalCitySlug,
  buildCanonicalCommentsPath,
  buildCanonicalMapCommentsPath,
  buildCanonicalMapGuessesPath,
  buildCanonicalMapUrl,
  buildCanonicalGuessesPath,
  buildCanonicalHouseSegment,
  buildCanonicalMapPreviewPath,
  buildCanonicalPostcodeMapPath,
  buildCanonicalPostcodeSlug,
  buildCanonicalPropertyPath,
  buildCanonicalStreetSlug,
  getCanonicalCountryPrefix,
  getCanonicalCountryPrefixSegment,
  isCanonicalMapRoutePath,
  normalizeCanonicalMapUrl,
  normalizeComparableText,
  normalizeInternalReturnTo,
  parseCanonicalCameraPath,
  resolveCanonicalCountryPrefix,
  serializeCanonicalCameraPath,
} from '../utils/property-url.js';

describe('canonical slug builders', () => {
  it('normalizes diacritics and collapses punctuation for city slugs', () => {
    expect(buildCanonicalCitySlug("  's-Hertogenbósch / Centrum!! ")).toBe(
      's-hertogenbosch-centrum',
    );
  });

  it('normalizes transliterated street slugs and comparable text', () => {
    expect(buildCanonicalStreetSlug('Bürgerstraße & Co.')).toBe(
      'burgerstrasse-co',
    );
    expect(normalizeComparableText('Bürgerstraße & Co.')).toBe(
      'burgerstrasse co',
    );
  });

  it('normalizes postcode path form by country', () => {
    expect(buildCanonicalPostcodeSlug('1234 AB', 'NL')).toBe('1234ab');
    expect(buildCanonicalPostcodeSlug('SW1A 1AA', 'GB')).toBe('sw1a1aa');
  });

  it('builds the house segment with normalized additions', () => {
    expect(buildCanonicalHouseSegment('12', 'A bis/3')).toBe('12-a-bis-3');
    expect(buildCanonicalHouseSegment('12B')).toBe('12b');
  });
});

describe('canonical country prefix helpers', () => {
  it('omits the NL prefix and emits non-NL prefixes', () => {
    expect(getCanonicalCountryPrefixSegment('NL')).toBeNull();
    expect(getCanonicalCountryPrefix('NL')).toBe('');
    expect(getCanonicalCountryPrefixSegment('de')).toBe('de');
    expect(getCanonicalCountryPrefix('de')).toBe('/de');
  });

  it('resolves explicit non-NL prefixes as canonical', () => {
    expect(resolveCanonicalCountryPrefix(['de', 'berlin'])).toEqual({
      countryCode: 'DE',
      remainingSegments: ['berlin'],
      hasExplicitPrefix: true,
      isCanonical: true,
    });
  });

  it('marks explicit NL prefixes as non-canonical', () => {
    expect(resolveCanonicalCountryPrefix(['nl', 'amsterdam'])).toEqual({
      countryCode: 'NL',
      remainingSegments: ['amsterdam'],
      hasExplicitPrefix: true,
      isCanonical: false,
    });
  });

  it('defaults prefixless routes to NL', () => {
    expect(resolveCanonicalCountryPrefix(['amsterdam', '1012nx'])).toEqual({
      countryCode: 'NL',
      remainingSegments: ['amsterdam', '1012nx'],
      hasExplicitPrefix: false,
      isCanonical: true,
    });
  });
});

describe('canonical camera paths', () => {
  it('serializes camera state with trimmed precision', () => {
    expect(
      serializeCanonicalCameraPath({
        lat: 52.0907,
        lng: 5.12142,
        zoom: 13,
      }),
    ).toBe('/@52.0907,5.12142,13z');
  });

  it('parses serialized camera paths', () => {
    expect(parseCanonicalCameraPath('/@52.0907,5.12142,13z')).toEqual({
      lat: 52.0907,
      lng: 5.12142,
      zoom: 13,
    });
    expect(parseCanonicalCameraPath('@-12.5,130.25,10.5z')).toEqual({
      lat: -12.5,
      lng: 130.25,
      zoom: 10.5,
    });
  });

  it('rejects invalid camera paths', () => {
    expect(parseCanonicalCameraPath('/@91,5,13z')).toBeNull();
    expect(parseCanonicalCameraPath('/map/amsterdam')).toBeNull();
  });
});

describe('canonical route builders', () => {
  const nlProperty = {
    city: 'Amsterdam',
    postalCode: '1012 NX',
    streetName: 'Nieuwezijds Voorburgwal',
    houseNumber: '147',
    houseNumberAddition: 'A',
    countryCode: 'NL',
  } as const;

  const deProperty = {
    city: 'München',
    postalCode: '80331',
    streetName: 'Bürgerstraße',
    houseNumber: '15',
    countryCode: 'DE',
  } as const;

  it('builds canonical NL paths without a country prefix', () => {
    expect(buildCanonicalCityMapPath(nlProperty)).toBe('/amsterdam');
    expect(buildCanonicalPostcodeMapPath(nlProperty)).toBe('/amsterdam/1012nx');
    expect(buildCanonicalPropertyPath(nlProperty)).toBe(
      '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
    );
    expect(buildCanonicalMapPreviewPath(nlProperty)).toBe(
      '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
    );
    expect(buildCanonicalMapCommentsPath(nlProperty)).toBe(
      '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments',
    );
    expect(buildCanonicalMapGuessesPath(nlProperty)).toBe(
      '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/guesses',
    );
    expect(buildCanonicalCommentsPath(nlProperty)).toBe(
      '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments',
    );
    expect(buildCanonicalGuessesPath(nlProperty)).toBe(
      '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/guesses',
    );
  });

  it('builds canonical non-NL paths with a lowercase country prefix', () => {
    expect(buildCanonicalCityMapPath(deProperty)).toBe('/de/munchen');
    expect(buildCanonicalPostcodeMapPath(deProperty)).toBe('/de/munchen/80331');
    expect(buildCanonicalPropertyPath(deProperty)).toBe(
      '/de/munchen/80331/burgerstrasse/15',
    );
    expect(buildCanonicalMapPreviewPath(deProperty)).toBe(
      '/map/de/munchen/80331/burgerstrasse/15',
    );
  });
});

describe('canonical map route URL helpers', () => {
  it('detects canonical map route paths', () => {
    expect(isCanonicalMapRoutePath('/')).toBe(true);
    expect(isCanonicalMapRoutePath('/@52.0907,5.12142,13z')).toBe(true);
    expect(isCanonicalMapRoutePath('/amsterdam')).toBe(true);
    expect(isCanonicalMapRoutePath('/amsterdam/1012nx')).toBe(true);
    expect(
      isCanonicalMapRoutePath(
        '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
      ),
    ).toBe(true);
    expect(
      isCanonicalMapRoutePath(
        '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments',
      ),
    ).toBe(true);
    expect(
      isCanonicalMapRoutePath(
        '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/guesses',
      ),
    ).toBe(true);
    expect(
      isCanonicalMapRoutePath('/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a'),
    ).toBe(false);
  });

  it('builds and normalizes canonical map URLs with approved filter params', () => {
    expect(
      buildCanonicalMapUrl('/amsterdam', {
        salePriceFrom: 700000,
        salePriceTo: 250000,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['not-listed', 'for-sale'],
      }),
    ).toBe(
      '/amsterdam?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );

    expect(
      normalizeCanonicalMapUrl(
        '/amsterdam?marketState=not-listed,for-sale&salePriceFrom=700000&salePriceTo=250000',
      ),
    ).toBe(
      '/amsterdam?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );
  });
});

describe('internal returnTo normalization', () => {
  it('accepts safe internal paths', () => {
    expect(normalizeInternalReturnTo('/feed')).toBe('/feed');
    expect(
      normalizeInternalReturnTo(
        '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a?returnTo=%2Fsaved',
      ),
    ).toBe('/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a?returnTo=%2Fsaved');
    expect(
      normalizeInternalReturnTo(
        '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
      ),
    ).toBe('/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a');
    expect(
      normalizeInternalReturnTo(
        '/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments',
      ),
    ).toBe('/map/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments');
    expect(
      normalizeInternalReturnTo(
        '/amsterdam?marketState=not-listed,for-sale&salePriceFrom=700000&salePriceTo=250000',
      ),
    ).toBe(
      '/amsterdam?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );
    expect(
      normalizeInternalReturnTo(
        '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments',
      ),
    ).toBe('/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a/comments');
  });

  it('rejects external or ambiguous targets', () => {
    expect(normalizeInternalReturnTo('https://evil.example/x')).toBeNull();
    expect(normalizeInternalReturnTo('//evil.example/x')).toBeNull();
    expect(normalizeInternalReturnTo('feed')).toBeNull();
    expect(normalizeInternalReturnTo('/feed#modal')).toBeNull();
    expect(normalizeInternalReturnTo('/feed?tab=saved')).toBeNull();
    expect(normalizeInternalReturnTo('/../../feed')).toBeNull();
    expect(normalizeInternalReturnTo('/map')).toBeNull();
    expect(normalizeInternalReturnTo('/property/123')).toBeNull();
    expect(normalizeInternalReturnTo('/comments/123')).toBeNull();
    expect(normalizeInternalReturnTo('/guesses/123')).toBeNull();
    expect(normalizeInternalReturnTo('/comments?returnTo=%2Ffeed')).toBeNull();
    expect(normalizeInternalReturnTo('/feed?salePriceTo=700000')).toBeNull();
    expect(normalizeInternalReturnTo('/amsterdam?foo=bar')).toBeNull();
  });

  it('appends a normalized internal returnTo query only when valid', () => {
    expect(
      appendInternalReturnTo(
        '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
        '/saved',
      ),
    ).toBe(
      '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a?returnTo=%2Fsaved',
    );

    expect(
      appendInternalReturnTo(
        '/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a',
        'https://evil.example/x',
      ),
    ).toBe('/amsterdam/1012nx/nieuwezijds-voorburgwal/147-a');
  });
});

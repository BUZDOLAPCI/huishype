import {
  buildMapPreviewPathname,
  clearLocalPreviewRouteCache,
  extractCanonicalRouteInput,
  parseMapRoutePath,
  registerLocalPreviewRoute,
  resolveMapRoute,
} from '../mapRoute';
import { resolveProperty, resolvePropertyArea } from '@/src/utils/api';

jest.mock('@/src/utils/api', () => ({
  ...jest.requireActual('@/src/utils/api'),
  resolveProperty: jest.fn(),
  resolvePropertyArea: jest.fn(),
}));

const mockResolveProperty = resolveProperty as jest.Mock;
const mockResolvePropertyArea = resolvePropertyArea as jest.Mock;

describe('mapRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLocalPreviewRouteCache();
  });

  it('parses camera, city, postcode, preview, property, comments, and guesses routes', () => {
    expect(parseMapRoutePath('/@51.4416,5.4697,14z')).toMatchObject({
      kind: 'camera',
    });
    expect(parseMapRoutePath('/eindhoven')).toMatchObject({
      kind: 'city',
      citySlug: 'eindhoven',
      countryCode: 'NL',
    });
    expect(parseMapRoutePath('/eindhoven/5651hp')).toMatchObject({
      kind: 'postcode',
      postcodeSlug: '5651hp',
    });
    expect(parseMapRoutePath('/map/eindhoven/5651hp/deflectiespoelstraat/16-a')).toMatchObject({
      kind: 'preview',
      houseSegment: '16-a',
    });
    expect(parseMapRoutePath('/eindhoven/5651hp/deflectiespoelstraat/16-a')).toMatchObject({
      kind: 'property',
    });
    expect(
      parseMapRoutePath('/eindhoven/5651hp/deflectiespoelstraat/16-a/comments'),
    ).toMatchObject({
      kind: 'comments',
    });
    expect(
      parseMapRoutePath('/de/berlin/10115/invalidenstrasse/12/guesses'),
    ).toMatchObject({
      kind: 'guesses',
      countryCode: 'DE',
    });
  });

  it('treats /map and explicit /nl prefixes as invalid', () => {
    expect(parseMapRoutePath('/map')).toMatchObject({ kind: 'invalid' });
    expect(parseMapRoutePath('/nl/eindhoven')).toMatchObject({ kind: 'invalid' });
    expect(parseMapRoutePath('/map/nl/eindhoven/5651hp/deflectiespoelstraat/16-a')).toMatchObject({
      kind: 'invalid',
    });
  });

  it('prefers structured route fields and only falls back to parsing address when needed', () => {
    expect(
      extractCanonicalRouteInput({
        city: 'Eindhoven',
        postalCode: '5651 HP',
        countryCode: 'NL',
        streetName: 'Deflectiespoelstraat',
        houseNumber: '16',
        houseNumberAddition: 'A',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5651 HP',
      countryCode: 'NL',
      streetName: 'Deflectiespoelstraat',
      houseNumber: '16',
      houseNumberAddition: 'A',
    });

    expect(
      extractCanonicalRouteInput({
        address: 'Pisanostraat 230',
        city: 'Eindhoven',
        postalCode: '5623 CH',
        countryCode: 'NL',
        streetName: 'Deflectiespoelstraat',
        houseNumber: '16',
        houseNumberAddition: 'A',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5623 CH',
      countryCode: 'NL',
      streetName: 'Deflectiespoelstraat',
      houseNumber: '16',
      houseNumberAddition: 'A',
    });

    expect(
      extractCanonicalRouteInput({
        address: 'Pisanostraat 230',
        city: 'Eindhoven',
        postalCode: '5623 CH',
        countryCode: 'NL',
        street: 'Deflectiespoelstraat',
        houseNumber: '16',
        houseNumberAddition: 'A',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5623 CH',
      countryCode: 'NL',
      streetName: 'Deflectiespoelstraat',
      houseNumber: '16',
      houseNumberAddition: 'A',
    });

    expect(
      extractCanonicalRouteInput({
        address: 'Deflectiespoelstraat 16 A',
        city: 'Eindhoven',
        postalCode: '5651HP',
        countryCode: 'NL',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5651HP',
      countryCode: 'NL',
      streetName: 'Deflectiespoelstraat',
      houseNumber: '16',
      houseNumberAddition: 'A',
    });

    expect(
      extractCanonicalRouteInput({
        address: 'Beeldbuisring 41, 5651HA Eindhoven',
        city: 'Eindhoven',
        postalCode: '5651HA',
        countryCode: 'NL',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5651HA',
      countryCode: 'NL',
      streetName: 'Beeldbuisring',
      houseNumber: '41',
      houseNumberAddition: null,
    });
  });

  it('falls back to parsing address when structured fields are absent', () => {
    expect(
      extractCanonicalRouteInput({
        address: 'Pisanostraat 230',
        city: 'Eindhoven',
        postalCode: '5623 CH',
        countryCode: 'NL',
      }),
    ).toEqual({
      city: 'Eindhoven',
      postalCode: '5623 CH',
      countryCode: 'NL',
      streetName: 'Pisanostraat',
      houseNumber: '230',
      houseNumberAddition: null,
    });
  });

  it('builds a canonical map preview pathname from catch-all address segments', () => {
    expect(buildMapPreviewPathname(['eindhoven', '5651ha', 'beeldbuisring', '2'])).toBe(
      '/map/eindhoven/5651ha/beeldbuisring/2',
    );
    expect(buildMapPreviewPathname('eindhoven/5651ha/beeldbuisring/2')).toBe(
      '/map/eindhoven/5651ha/beeldbuisring/2',
    );
    expect(buildMapPreviewPathname(null)).toBeNull();
  });

  it('resolves canonical postcode map routes to map coordinates', async () => {
    mockResolvePropertyArea.mockResolvedValueOnce({
      city: 'Eindhoven',
      postalCode: '5651HP',
      countryCode: 'NL',
      center: { lon: 5.4557789, lat: 51.4300456 },
      propertyCount: 32,
    });

    await expect(resolveMapRoute('/eindhoven/5651hp')).resolves.toMatchObject({
      kind: 'postcode',
      canonicalPath: '/eindhoven/5651hp',
      center: [5.4557789, 51.4300456],
      cityName: 'Eindhoven',
    });
  });

  it('resolves canonical preview routes to property-backed preview state', async () => {
    mockResolveProperty.mockResolvedValueOnce({
      id: 'prop-1',
      address: 'Deflectiespoelstraat 16 A',
      city: 'Eindhoven',
      postalCode: '5651HP',
      countryCode: 'NL',
      coordinates: { lon: 5.4557789, lat: 51.4300456 },
      officialValuation: 250000,
    });

    await expect(
      resolveMapRoute('/map/eindhoven/5651hp/deflectiespoelstraat/16-a'),
    ).resolves.toMatchObject({
      kind: 'preview',
      canonicalPath: '/map/eindhoven/5651hp/deflectiespoelstraat/16-a',
      property: { id: 'prop-1' },
      routeInput: {
        city: 'Eindhoven',
        postalCode: '5651HP',
        streetName: 'deflectiespoelstraat',
        houseNumber: '16',
        houseNumberAddition: 'a',
        countryCode: 'NL',
      },
    });
    expect(mockResolvePropertyArea).not.toHaveBeenCalled();
  });

  it('reuses registered local preview routes without re-resolving through the API', async () => {
    registerLocalPreviewRoute(
      '/map/eindhoven/5651hp/tile-group-street/2',
      {
        id: 'prop-local',
        address: 'Tile Group Street 2',
        city: 'Eindhoven',
        postalCode: '5651HP',
        countryCode: 'NL',
        coordinates: { lon: 5.4557789, lat: 51.4300456 },
        hasListing: false,
        officialValuation: 250000,
      },
      {
        city: 'Eindhoven',
        postalCode: '5651HP',
        streetName: 'Tile Group Street',
        houseNumber: '2',
        houseNumberAddition: null,
        countryCode: 'NL',
      },
    );

    await expect(
      resolveMapRoute('/map/eindhoven/5651hp/tile-group-street/2'),
    ).resolves.toMatchObject({
      kind: 'preview',
      canonicalPath: '/map/eindhoven/5651hp/tile-group-street/2',
      property: { id: 'prop-local' },
      routeInput: {
        city: 'Eindhoven',
        postalCode: '5651HP',
        streetName: 'Tile Group Street',
        houseNumber: '2',
        houseNumberAddition: null,
        countryCode: 'NL',
      },
    });

    expect(mockResolveProperty).not.toHaveBeenCalled();
  });

  it('resolves canonical property, comments, and guesses routes without switching to id paths', async () => {
    const property = {
      id: 'prop-1',
      address: 'Deflectiespoelstraat 16 A',
      city: 'Eindhoven',
      postalCode: '5651HP',
      countryCode: 'NL',
      coordinates: { lon: 5.4557789, lat: 51.4300456 },
      officialValuation: 250000,
    };

    mockResolveProperty
      .mockResolvedValueOnce(property)
      .mockResolvedValueOnce(property)
      .mockResolvedValueOnce(property);

    await expect(
      resolveMapRoute('/eindhoven/5651hp/deflectiespoelstraat/16-a'),
    ).resolves.toMatchObject({
      kind: 'property',
      canonicalPath: '/eindhoven/5651hp/deflectiespoelstraat/16-a',
      property: { id: 'prop-1' },
    });

    await expect(
      resolveMapRoute('/eindhoven/5651hp/deflectiespoelstraat/16-a/comments'),
    ).resolves.toMatchObject({
      kind: 'comments',
      canonicalPath: '/eindhoven/5651hp/deflectiespoelstraat/16-a/comments',
      property: { id: 'prop-1' },
    });

    await expect(
      resolveMapRoute('/eindhoven/5651hp/deflectiespoelstraat/16-a/guesses'),
    ).resolves.toMatchObject({
      kind: 'guesses',
      canonicalPath: '/eindhoven/5651hp/deflectiespoelstraat/16-a/guesses',
      property: { id: 'prop-1' },
    });
  });

  it('treats a syntactically valid but unresolved postcode route as invalid without a 404', async () => {
    mockResolvePropertyArea.mockResolvedValueOnce(null);
    await expect(resolveMapRoute('/definitely-not-a-real-place/0000zz')).resolves.toMatchObject({
      kind: 'invalid',
      canonicalPath: '/',
      reason: 'unresolvable-postcode-route',
    });
  });

  it('rejects malformed postcode routes locally without calling the area resolver', async () => {
    await expect(resolveMapRoute('/definitely-not-a-real-place/zzzz')).resolves.toMatchObject({
      kind: 'invalid',
      canonicalPath: '/',
      reason: 'invalid-postcode-format',
    });
    expect(mockResolvePropertyArea).not.toHaveBeenCalled();
  });
});

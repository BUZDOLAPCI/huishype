import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import { resetReverseGeocodeCacheForTests } from '../../routes/geocode.js';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  buildLocationAreaFilterPredicate,
  parseLocationFilterToken,
} from '../../services/map-filters.js';
import {
  getLocationSearchAreaPropertyKeysForIds,
  refreshLocationSearchAreasForPropertyKeys,
} from '../../services/location-search-areas.js';
import { createIntegrationProperty } from './helpers/fixtures.js';

// Mock global fetch to simulate Photon responses
const originalFetch = global.fetch;
let mockFetchFn: jest.Mock<typeof global.fetch>;
const geocodeTestApps: FastifyInstance[] = [];

async function buildGeocodeTestApp() {
  const app = await buildApp({ logger: false });
  geocodeTestApps.push(app);
  return app;
}

beforeAll(() => {
  mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
  global.fetch = mockFetchFn;
});

afterAll(async () => {
  global.fetch = originalFetch;
  for (const app of [...geocodeTestApps].reverse()) {
    await app.close();
  }
});

const MOCK_PHOTON_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.4557789, 51.4300456] },
      properties: {
        osm_type: 'W',
        osm_id: 12345,
        street: 'Deflectiespoelstraat',
        housenumber: '16',
        postcode: '5651HP',
        city: 'Eindhoven',
        state: 'Noord-Brabant',
        country: 'Netherlands',
        countrycode: 'nl',
        type: 'house',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.456, 51.43] },
      properties: {
        osm_type: 'W',
        osm_id: 12346,
        street: 'Deflectiespoelstraat',
        housenumber: '33',
        postcode: '5651HP',
        city: 'Eindhoven',
        state: 'Noord-Brabant',
        country: 'Netherlands',
        countrycode: 'nl',
        type: 'house',
      },
    },
  ],
};

function emptyPhotonResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
  } as unknown as Response;
}

async function cleanupCreatedProperties(createdPropertyIds: string[]) {
  if (createdPropertyIds.length === 0) {
    return;
  }

  const ids = [...new Set(createdPropertyIds)];
  const beforeKeys = await getLocationSearchAreaPropertyKeysForIds(ids);
  await db.execute(
    sql`
      UPDATE properties
      SET
        status = 'inactive',
        street = CONCAT('__geocode_fixture_cleanup_', id::text),
        postal_code = LEFT(REPLACE(id::text, '-', ''), 10)
      WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    `
  );
  await refreshLocationSearchAreasForPropertyKeys(beforeKeys);
  createdPropertyIds.length = 0;
}

async function cleanupOvertureDivisionFixtures(createdDivisionIds: string[]) {
  if (createdDivisionIds.length === 0) {
    return;
  }

  const ids = [...new Set(createdDivisionIds)];
  await db.execute(sql`
    DELETE FROM location_search_areas
    WHERE source = 'overture'
      AND division_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  await db.execute(sql`
    DELETE FROM overture_divisions
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  createdDivisionIds.length = 0;
}

function stringifySqlQuery(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) {
    return String(query);
  }

  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') {
        return chunk;
      }
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) {
        return value.join('');
      }
      return typeof value === 'string' ? value : '';
    })
    .join(' ');
}

function normalizeSearchToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type LocationSearchTestSuggestion = {
  id?: string;
  type: string;
  label?: string;
  countryCode?: string | null;
  coordinates?: [number, number] | null;
  propertyId?: string | null;
  postalCode?: string | null;
  city?: string | null;
  region?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  filterToken?: {
    id?: string | null;
    type?: string;
    countryCode?: string | null;
    value?: string;
    label?: string;
    source?: string | null;
    divisionId?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    street?: string | null;
  } | null;
};

const AREA_SUGGESTION_TYPES = new Set(['street', 'postcode', 'city', 'region', 'country']);

function isAreaSuggestion(suggestion: LocationSearchTestSuggestion) {
  return AREA_SUGGESTION_TYPES.has(suggestion.type);
}

describe('GET /geocode/search', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildGeocodeTestApp();
  });

  afterAll(async () => {
    // Keep the shared DB connection open for later geocode describes that
    // exercise DB-backed location hydration.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
  });

  it('returns 400 when q parameter is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search',
    });
    expect(response.statusCode).toBe(400);
  });

  it('still accepts one-character proxy searches', async () => {
    mockFetchFn.mockResolvedValueOnce(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=a&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns transformed suggestions from Photon', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_PHOTON_RESPONSE),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=deflectiespoelstraat+eindhoven',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);

    expect(body[0]).toEqual({
      id: 'W_12345',
      displayName: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
      street: 'Deflectiespoelstraat',
      houseNumber: '16',
      postalCode: '5651HP',
      city: 'Eindhoven',
      region: 'Noord-Brabant',
      countryCode: 'nl',
      coordinates: [5.4557789, 51.4300456],
    });

    expect(body[1].id).toBe('W_12346');
    expect(body[1].houseNumber).toBe('33');
  });

  it('passes limit parameter to Photon', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&limit=3',
    });

    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('limit=3');
  });

  it('passes lang parameter to Photon', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&lang=nl',
    });

    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('lang=nl');
  });

  it('forwards countrycode to Photon and still filters results locally', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            MOCK_PHOTON_RESPONSE.features[0],
            {
              ...MOCK_PHOTON_RESPONSE.features[1],
              properties: {
                ...MOCK_PHOTON_RESPONSE.features[1].properties,
                countrycode: 'de',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveLength(1);
    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('countrycode=nl');
    expect(calledUrl).toContain('lon=5.4697');
    expect(calledUrl).toContain('lat=51.4416');
  });

  it('forwards lon and lat proximity bias to Photon', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&lon=4.8952&lat=52.3702',
    });

    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = new URL((mockFetchFn.mock.calls[0] as unknown[])[0] as string);
    expect(calledUrl.searchParams.get('lon')).toBe('4.8952');
    expect(calledUrl.searchParams.get('lat')).toBe('52.3702');
    expect(calledUrl.searchParams.get('countrycode')).toBeNull();
  });

  it('uses explicit lon and lat instead of the default country center for strict country searches', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&countrycode=NL&lon=4.8952&lat=52.3702',
    });

    const calledUrl = new URL((mockFetchFn.mock.calls[0] as unknown[])[0] as string);
    expect(calledUrl.searchParams.get('countrycode')).toBe('nl');
    expect(calledUrl.searchParams.get('lon')).toBe('4.8952');
    expect(calledUrl.searchParams.get('lat')).toBe('52.3702');
  });

  it('returns soft country-mode preferred-country results first', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              ...MOCK_PHOTON_RESPONSE.features[0],
              properties: {
                ...MOCK_PHOTON_RESPONSE.features[0].properties,
                osm_id: 9001,
                countrycode: 'nl',
              },
            },
            {
              ...MOCK_PHOTON_RESPONSE.features[1],
              properties: {
                ...MOCK_PHOTON_RESPONSE.features[1].properties,
                osm_id: 9002,
                countrycode: 'de',
              },
            },
            {
              ...MOCK_PHOTON_RESPONSE.features[1],
              properties: {
                ...MOCK_PHOTON_RESPONSE.features[1].properties,
                osm_id: 9003,
                countrycode: 'nl',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&limit=2&countrycode=NL&countrymode=soft&lon=4.8952&lat=52.3702',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).map((item: { id: string }) => item.id)).toEqual([
      'W_9001',
      'W_9003',
    ]);
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = new URL((mockFetchFn.mock.calls[0] as unknown[])[0] as string);
    expect(calledUrl.searchParams.get('countrycode')).toBe('nl');
    expect(calledUrl.searchParams.get('lon')).toBe('4.8952');
    expect(calledUrl.searchParams.get('lat')).toBe('52.3702');
  });

  it('falls back globally and dedupes when soft country-mode results are below limit', async () => {
    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                ...MOCK_PHOTON_RESPONSE.features[0],
                properties: {
                  ...MOCK_PHOTON_RESPONSE.features[0].properties,
                  osm_id: 9101,
                  countrycode: 'nl',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                ...MOCK_PHOTON_RESPONSE.features[0],
                properties: {
                  ...MOCK_PHOTON_RESPONSE.features[0].properties,
                  osm_id: 9101,
                  countrycode: 'nl',
                },
              },
              {
                ...MOCK_PHOTON_RESPONSE.features[1],
                properties: {
                  ...MOCK_PHOTON_RESPONSE.features[1].properties,
                  osm_id: 9102,
                  countrycode: 'be',
                },
              },
            ],
          }),
      } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&limit=3&countrycode=NL&countrymode=soft&lon=4.8952&lat=52.3702',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).map((item: { id: string }) => item.id)).toEqual([
      'W_9101',
      'W_9102',
    ]);
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
    const preferredUrl = new URL((mockFetchFn.mock.calls[0] as unknown[])[0] as string);
    const fallbackUrl = new URL((mockFetchFn.mock.calls[1] as unknown[])[0] as string);
    expect(preferredUrl.searchParams.get('countrycode')).toBe('nl');
    expect(fallbackUrl.searchParams.get('countrycode')).toBeNull();
    expect(fallbackUrl.searchParams.get('lon')).toBe('4.8952');
    expect(fallbackUrl.searchParams.get('lat')).toBe('52.3702');
  });

  it('expands the Photon fetch limit when country filtering is requested', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&limit=3&countrycode=NL',
    });

    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('limit=15');
  });

  it('limits max results to 20', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&limit=50',
    });

    expect(response.statusCode).toBe(400);
  });

  it('defaults limit to 5', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test',
    });

    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('limit=5');
  });

  it('returns empty array when Photon returns non-ok response', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('returns empty array when Photon is unreachable', async () => {
    mockFetchFn.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('formats display name correctly for address with street and city', async () => {
    const photonResponse = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [4.89, 52.37] },
          properties: {
            osm_type: 'N',
            osm_id: 99999,
            street: 'Prinsengracht',
            housenumber: '123',
            postcode: '1015DV',
            city: 'Amsterdam',
            state: 'Noord-Holland',
            countrycode: 'nl',
          },
        },
      ],
    };

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(photonResponse),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=prinsengracht+123',
    });

    const body = JSON.parse(response.body);
    expect(body[0].displayName).toBe('Prinsengracht 123, 1015DV Amsterdam');
  });

  it('uses name field when street is missing', async () => {
    const photonResponse = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [5.47, 51.44] },
          properties: {
            osm_type: 'R',
            osm_id: 88888,
            name: 'Eindhoven Centraal',
            city: 'Eindhoven',
            state: 'Noord-Brabant',
            countrycode: 'nl',
            type: 'railway',
          },
        },
      ],
    };

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(photonResponse),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/search?q=eindhoven+centraal',
    });

    const body = JSON.parse(response.body);
    expect(body[0].displayName).toBe('Eindhoven Centraal, Eindhoven');
    expect(body[0].id).toBe('R_88888');
  });
});

describe('GET /search/locations', () => {
  let app: FastifyInstance;
  const createdPropertyIds: string[] = [];
  const createdDivisionIds: string[] = [];

  beforeAll(async () => {
    app = await buildGeocodeTestApp();
  });

  afterAll(async () => {
    await cleanupCreatedProperties(createdPropertyIds);
    await cleanupOvertureDivisionFixtures(createdDivisionIds);
    // Keep the shared DB connection open for the following hydration tests.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
  });

  afterEach(async () => {
    await cleanupCreatedProperties(createdPropertyIds);
    await cleanupOvertureDivisionFixtures(createdDivisionIds);
  });

  it('rejects one-character typed location searches', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=a&countrycode=NL',
    });

    expect(response.statusCode).toBe(400);
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it(
    'returns DB-backed street and property suggestions before weak Photon results',
    async () => {
      const firstProperty = await createIntegrationProperty({
        street: 'Beeldbuisring',
        houseNumber: 41,
        city: 'Eindhoven',
        region: 'Noord-Brabant',
        postalCode: '5651HA',
        lon: 5.455,
        lat: 51.43,
      });
      const secondProperty = await createIntegrationProperty({
        street: 'Beeldbuisring',
        houseNumber: 43,
        city: 'Eindhoven',
        region: 'Noord-Brabant',
        postalCode: '5651HA',
        lon: 5.456,
        lat: 51.431,
      });
      createdPropertyIds.push(firstProperty.id, secondProperty.id);

      mockFetchFn.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.45, 51.43] },
                properties: {
                  osm_type: 'N',
                  osm_id: 9901,
                  name: '5651',
                  postcode: '5651',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'postcode',
                },
              },
            ],
          }),
      } as unknown as Response);

      const response = await app.inject({
        method: 'GET',
        url: '/search/locations?q=beeldbuisring&limit=8&countrycode=NL',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body[0]).toEqual(
        expect.objectContaining({
          type: 'street',
          label: 'Beeldbuisring',
          city: 'Eindhoven',
          filterToken: expect.objectContaining({
            type: 'street',
            street: 'Beeldbuisring',
            city: 'Eindhoven',
          }),
        })
      );
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'property',
            street: 'Beeldbuisring',
            postalCode: '5651HA',
          }),
        ])
      );

    }
  );

  it('expands a strong backed street prefix into exact DB addresses and suppresses weak Photon fallbacks', async () => {
    const suffix = Date.now().toString(36);
    const street = `Deflectiespoelstraat Prefix ${suffix}`;
    const weakStreet = `De Lei ${suffix}`;
    const otherWeakStreet = `De Klem ${suffix}`;
    const properties = await Promise.all(
      [10, 12, 14].map((houseNumber, index) =>
        createIntegrationProperty({
          street,
          houseNumber,
          city: 'Eindhoven',
          region: 'Noord-Brabant',
          postalCode: '5651PF',
          lon: 5.4461 + index * 0.0001,
          lat: 51.4521 + index * 0.0001,
        })
      )
    );
    createdPropertyIds.push(...properties.map((property) => property.id));

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.4461, 51.4521] },
              properties: {
                osm_type: 'W',
                osm_id: 98001,
                name: street,
                postcode: '5651PF',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'street',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.4465, 51.4525] },
              properties: {
                osm_type: 'N',
                osm_id: 98002,
                street,
                housenumber: '999',
                postcode: '5651PF',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.45, 51.45] },
              properties: {
                osm_type: 'W',
                osm_id: 98003,
                name: weakStreet,
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'street',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.46, 51.46] },
              properties: {
                osm_type: 'W',
                osm_id: 98004,
                name: otherWeakStreet,
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'street',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=deflec&limit=8&countrycode=NL&lon=5.446&lat=51.452',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'street',
        label: street,
        city: 'Eindhoven',
        filterToken: expect.objectContaining({
          type: 'street',
          street,
          city: 'Eindhoven',
        }),
      })
    );

    const propertyIds = body
      .filter((suggestion) => suggestion.type === 'property')
      .map((suggestion) => suggestion.propertyId);
    expect(propertyIds).toEqual(expect.arrayContaining(properties.map((property) => property.id)));
    expect(body.slice(1, 4).every((suggestion) => suggestion.type === 'property')).toBe(true);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'address',
          street,
          houseNumber: '999',
          propertyId: null,
          filterToken: null,
        }),
      ])
    );
    expect(body.map((suggestion) => suggestion.label)).not.toContain(weakStreet);
    expect(body.map((suggestion) => suggestion.label)).not.toContain(otherWeakStreet);
  });

  it('keeps backed DB suggestions ahead of closer Photon-only coordinate fallbacks', async () => {
    const street = `Proximity Backed Lane ${Date.now().toString(36)}`;
    const property = await createIntegrationProperty({
      street,
      houseNumber: 1,
      city: 'Backed Ranking City',
      region: 'Backed Ranking Region',
      postalCode: '5666PR',
      lon: 5.1,
      lat: 51.1,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [6.1, 52.1] },
              properties: {
                osm_type: 'N',
                osm_id: 97001,
                street,
                housenumber: '99',
                postcode: '9999ZZ',
                city: 'Photon Only City',
                state: 'Photon Only Region',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(street)}&limit=8&countrycode=NL&lon=6.1&lat=52.1`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const backedIndex = body.findIndex(
      (suggestion) =>
        suggestion.type === 'street' &&
        suggestion.label === street &&
        suggestion.filterToken?.type === 'street'
    );
    const photonOnlyIndex = body.findIndex(
      (suggestion) =>
        suggestion.type === 'address' &&
        suggestion.street === street &&
        suggestion.houseNumber === '99' &&
        suggestion.propertyId == null &&
        suggestion.filterToken == null
    );

    expect(backedIndex).toBeGreaterThanOrEqual(0);
    expect(photonOnlyIndex).toBeGreaterThanOrEqual(0);
    expect(backedIndex).toBeLessThan(photonOnlyIndex);
  });

  it('dedupes DB and Photon street area suggestions when only the region differs', async () => {
    const property = await createIntegrationProperty({
      street: 'Deflectiespoelstraat',
      houseNumber: 432100,
      city: 'Eindhoven',
      region: 'Eindhoven',
      postalCode: '5651HP',
      lon: 5.4463575,
      lat: 51.4522789,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4463575, 51.4522789] },
                properties: {
                  osm_type: 'W',
                  osm_id: 95101,
                  name: 'Deflectiespoelstraat',
                  postcode: '5651HP',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4467, 51.4525] },
                properties: {
                  osm_type: 'N',
                  osm_id: 95102,
                  street: 'Deflectiespoelstraat',
                  housenumber: '9876',
                  postcode: '5651HP',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'house',
                },
              },
            ],
          }),
      } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Deflectiespoelstraat&countrycode=NL&lon=5.4463575&lat=51.4522789',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const streetSuggestions = body.filter(
      (suggestion) =>
        suggestion.type === 'street' &&
        (suggestion.street === 'Deflectiespoelstraat' ||
          suggestion.label === 'Deflectiespoelstraat')
    );

    expect(streetSuggestions).toHaveLength(1);
    const streetSuggestion = streetSuggestions[0]!;
    expect(streetSuggestion).toEqual(
      expect.objectContaining({
        id: 'street:NL:deflectiespoelstraat:city=eindhoven',
        type: 'street',
        label: 'Deflectiespoelstraat',
        city: 'Eindhoven',
        region: 'Eindhoven',
        postalCode: null,
        street: 'Deflectiespoelstraat',
        filterToken: expect.objectContaining({
          id: 'street:NL:deflectiespoelstraat:city=eindhoven',
          type: 'street',
          countryCode: 'NL',
          value: 'deflectiespoelstraat',
          label: 'Deflectiespoelstraat',
          city: 'Eindhoven',
          region: 'Eindhoven',
          postalCode: null,
          street: 'Deflectiespoelstraat',
        }),
      })
    );
    expect(streetSuggestion.id).not.toContain('W_95101');
    expect(streetSuggestion.filterToken?.id).not.toContain('W_95101');
    expect(body.filter(isAreaSuggestion).every((suggestion) => suggestion.filterToken)).toBe(
      true
    );
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'property',
          street: 'Deflectiespoelstraat',
          postalCode: '5651HP',
        }),
        expect.objectContaining({
          type: 'address',
          street: 'Deflectiespoelstraat',
          postalCode: '5651HP',
        }),
      ])
    );
    const streetIndex = body.findIndex((suggestion) => suggestion === streetSuggestion);
    const addressIndex = body.findIndex(
      (suggestion) =>
        suggestion.type === 'address' &&
        suggestion.street === 'Deflectiespoelstraat' &&
        suggestion.postalCode === '5651HP' &&
        suggestion.propertyId == null &&
        suggestion.filterToken == null
    );
    expect(addressIndex).toBeGreaterThanOrEqual(0);
    expect(streetIndex).toBeLessThan(addressIndex);
  });

  it('dedupes same-city street suggestions across postcodes and converts street-labelled postcode rows', async () => {
    const firstProperty = await createIntegrationProperty({
      street: 'Zwaanstraat',
      houseNumber: 1,
      city: 'Eindhoven',
      region: 'Eindhoven',
      postalCode: '5651ZA',
      lon: 5.4621,
      lat: 51.4481,
    });
    const secondProperty = await createIntegrationProperty({
      street: 'Zwaanstraat',
      houseNumber: 2,
      city: 'Eindhoven',
      region: 'Eindhoven',
      postalCode: '5652ZB',
      lon: 5.4622,
      lat: 51.4482,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.462, 51.448] },
                properties: {
                  osm_type: 'N',
                  osm_id: 96100,
                  name: 'Zwaanstraat',
                  postcode: '5651',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'district',
                },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4621, 51.4481] },
                properties: {
                  osm_type: 'W',
                  osm_id: 96101,
                  name: 'Zwaanstraat',
                  postcode: '5651ZA',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4622, 51.4482] },
                properties: {
                  osm_type: 'W',
                  osm_id: 96102,
                  name: 'Zwaanstraat',
                  postcode: '5652ZB',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=zwaanstraat&limit=8&countrycode=NL&lon=5.462&lat=51.448',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const streetSuggestions = body.filter(
      (suggestion: { type: string; label: string; city?: string | null }) =>
        suggestion.type === 'street' &&
        suggestion.label === 'Zwaanstraat' &&
        suggestion.city === 'Eindhoven'
    );
    const streetLabelledPostcodeSuggestions = body.filter(
      (suggestion: { type: string; label: string }) =>
        suggestion.type === 'postcode' && suggestion.label === 'Zwaanstraat'
    );

    expect(streetSuggestions).toHaveLength(1);
    expect(streetSuggestions[0]).toEqual(
      expect.objectContaining({
        id: 'street:NL:zwaanstraat:city=eindhoven',
        type: 'street',
        label: 'Zwaanstraat',
        city: 'Eindhoven',
        region: 'Eindhoven',
        postalCode: null,
        filterToken: expect.objectContaining({
          id: 'street:NL:zwaanstraat:city=eindhoven',
          type: 'street',
          countryCode: 'NL',
          value: 'zwaanstraat',
          label: 'Zwaanstraat',
          city: 'Eindhoven',
          region: 'Eindhoven',
          postalCode: null,
          street: 'Zwaanstraat',
        }),
      })
    );
    expect(streetLabelledPostcodeSuggestions).toHaveLength(0);
    expect(streetSuggestions[0].id).not.toContain('postcode=');
    expect(streetSuggestions[0].filterToken.id).not.toContain('postcode=');
  });

  it('strips unsafe Photon state metadata from unbacked street fallback tokens', async () => {
    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.462, 51.448] },
                properties: {
                  osm_type: 'W',
                  osm_id: 96201,
                  name: 'No Backed Filterstraat',
                  postcode: '5651ZA',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=No%20Backed%20Filterstraat&limit=8&countrycode=NL&lon=5.462&lat=51.448',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const unsafeAreaSuggestion = body.find(
      (suggestion) =>
        suggestion.type === 'street' &&
        suggestion.label === 'No Backed Filterstraat' &&
        suggestion.filterToken
    );
    const coordinateFallback = body.find(
      (suggestion) => suggestion.label === 'No Backed Filterstraat'
    );

    expect(unsafeAreaSuggestion).toBeUndefined();
    if (coordinateFallback) {
      expect(coordinateFallback).toEqual(
        expect.objectContaining({
          type: 'address',
          label: 'No Backed Filterstraat',
          filterToken: null,
          coordinates: [5.462, 51.448],
        })
      );
    }
  });

  it('does not classify Photon house features with street fields as duplicate street areas', async () => {
    const property = await createIntegrationProperty({
      street: 'Tegenbosch',
      houseNumber: 42,
      city: 'Eindhoven',
      region: 'Noord-Brabant',
      postalCode: '5651TB',
      lon: 5.401,
      lat: 51.451,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.061, 51.563] },
              properties: {
                osm_type: 'W',
                osm_id: 693356158,
                name: 'Tegenbosch',
                street: 'Tilburgseweg',
                postcode: '5651TB',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Tegenbosch&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const streetSuggestions = body.filter(
      (suggestion) =>
        suggestion.type === 'street' &&
        (suggestion.street === 'Tegenbosch' || suggestion.label === 'Tegenbosch')
    );

    expect(streetSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'street',
          label: 'Tegenbosch',
          city: 'Eindhoven',
          region: 'Noord-Brabant',
          street: 'Tegenbosch',
          filterToken: expect.objectContaining({
            id: expect.stringMatching(/^street:NL:tegenbosch:/u),
            type: 'street',
            countryCode: 'NL',
            value: 'tegenbosch',
            label: 'Tegenbosch',
            city: 'Eindhoven',
            region: 'Noord-Brabant',
            street: 'Tegenbosch',
          }),
        }),
      ])
    );
    expect(streetSuggestions.every((suggestion) => suggestion.id === suggestion.filterToken?.id)).toBe(
      true
    );
    expect(JSON.stringify(body)).not.toContain('Tilburgseweg');
    expect(JSON.stringify(body)).not.toContain('W_693356158');
  });

  it('does not keep an unbacked Photon street token but still expands same-street addresses', async () => {
    const street = 'No Backed Expansionstraat';
    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4468656, 51.4508519] },
                properties: {
                  osm_type: 'W',
                  osm_id: 94001,
                  name: street,
                  postcode: '5651 HJ',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4455092, 51.4524433] },
                properties: {
                  osm_type: 'N',
                  osm_id: 94002,
                  street,
                  housenumber: '1',
                  postcode: '5651HA',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'house',
                },
              },
            ],
          }),
      } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(street)}&limit=8&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const unbackedAreaSuggestion = body.find(
      (suggestion) =>
        isAreaSuggestion(suggestion) &&
        suggestion.filterToken &&
        (suggestion.label === street || suggestion.street === street)
    );
    const expandedAddress = body.find(
      (suggestion) =>
        (suggestion.type === 'address' || suggestion.type === 'property') &&
        suggestion.street === street &&
        suggestion.houseNumber === '1'
    );

    expect(unbackedAreaSuggestion).toBeUndefined();
    expect(expandedAddress).toEqual(
      expect.objectContaining({
        street,
        postalCode: '5651HA',
        coordinates: [5.4455092, 51.4524433],
      })
    );
    expect(expandedAddress?.filterToken).toBeNull();
  });

  it('routes short street and house-number queries through property lookup, not postcode-only lookup', async () => {
    const property = await createIntegrationProperty({
      street: 'Dam',
      houseNumber: 1,
      city: 'Postcode Heuristic City',
      region: 'Noord-Brabant',
      postalCode: '1099ZZ',
      lon: 5.458,
      lat: 51.433,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Dam%201&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'property',
          propertyId: property.id,
          street: 'Dam',
          houseNumber: '1',
          postalCode: '1099ZZ',
        }),
      ])
    );
  });

  it('treats numeric postcode queries as postcode searches for countries with numeric postcodes', async () => {
    const property = await createIntegrationProperty({
      countryCode: 'DE',
      street: 'Numeric Postcodeallee',
      houseNumber: 5,
      city: 'Aaa Numeric Postcode City',
      region: 'Berlin',
      postalCode: '10115',
      lon: 13.405,
      lat: 52.52,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=10115&limit=20&countrycode=DE',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'postcode',
          postalCode: '10115',
          countryCode: 'DE',
        }),
        expect.objectContaining({
          type: 'property',
          propertyId: property.id,
          postalCode: '10115',
          countryCode: 'DE',
        }),
      ])
    );
  });

  it('does not treat a German numeric postcode as a Dutch postcode search', async () => {
    const property = await createIntegrationProperty({
      countryCode: 'DE',
      street: 'Dutch Rejection Postcodeallee',
      houseNumber: 15,
      city: 'Dutch Rejection City',
      region: 'Berlin',
      postalCode: '10115',
      lon: 13.406,
      lat: 52.521,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=10115&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    expect(body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'postcode',
          postalCode: '10115',
          countryCode: 'NL',
        }),
      ])
    );
    expect(body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyId: property.id,
        }),
      ])
    );
  });

  it.each([
    ['compact', '0999ZZ'],
    ['spaced', '0999 ZZ'],
    ['dashed', '0999-ZZ'],
  ])(
    'normalizes %s postcode searches to postcode and property suggestions',
    async (_format, query) => {
      const postalCode = '0999 ZZ';
      const property = await createIntegrationProperty({
        street: 'Compact Postcodehof',
        houseNumber: 12,
        city: 'Eindhoven',
        region: 'Noord-Brabant',
        postalCode,
        lon: 5.457,
        lat: 51.432,
      });
      createdPropertyIds.push(property.id);

      mockFetchFn.mockResolvedValue(emptyPhotonResponse());

      const response = await app.inject({
        method: 'GET',
        url: `/search/locations?q=${encodeURIComponent(query)}&limit=8&countrycode=NL`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'postcode',
            filterToken: expect.objectContaining({
              type: 'postcode',
              value: '0999zz',
            }),
          }),
          expect.objectContaining({
            type: 'property',
            postalCode,
          }),
        ])
      );
    }
  );

  it('falls back from an exact NL postcode to a supported postcode token and address label when exact rows are absent', async () => {
    const properties = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createIntegrationProperty({
          street: 'Prefix Postcodepad',
          houseNumber: index + 1,
          city: 'Eindhoven',
          region: 'Noord-Brabant',
          postalCode: '7777AB',
          lon: 5.46 + index * 0.00001,
          lat: 51.43 + index * 0.00001,
        })
      )
    );
    createdPropertyIds.push(...properties.map((property) => property.id));

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=7777AA&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'postcode',
          label: '7777 AA',
          postalCode: '7777AA',
          filterToken: expect.objectContaining({
            type: 'postcode',
            value: '7777aa',
            postalCode: '7777AA',
          }),
        }),
        expect.objectContaining({
          type: 'address',
          label: '7777 AA Eindhoven',
          postalCode: '7777AA',
          city: 'Eindhoven',
        }),
      ])
    );
  });

  it('returns backed region area suggestions when active properties exist', async () => {
    const suffix = Date.now().toString(36);
    const region = `Coverage Region ${suffix}`;
    const property = await createIntegrationProperty({
      street: `Coverage Country Street ${suffix}`,
      houseNumber: 1,
      city: `Coverage City ${suffix}`,
      region,
      postalCode: '5666CA',
      lon: 5.49,
      lat: 51.45,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const regionResponse = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(region)}&limit=8&countrycode=NL`,
    });
    expect(regionResponse.statusCode).toBe(200);
    const regionBody = JSON.parse(regionResponse.body) as LocationSearchTestSuggestion[];
    expect(regionBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'region',
          label: region,
          countryCode: 'NL',
          filterToken: expect.objectContaining({
            type: 'region',
            countryCode: 'NL',
            value: expect.any(String),
            label: region,
          }),
        }),
      ])
    );
  });

  it('returns backed country area suggestions and skips countries without active properties', async () => {
    const suffix = Date.now().toString(36);
    const property = await createIntegrationProperty({
      street: `Coverage Country Street ${suffix}`,
      houseNumber: 1,
      city: `Coverage Country City ${suffix}`,
      region: `Coverage Country Region ${suffix}`,
      postalCode: '5666CB',
      lon: 5.491,
      lat: 51.451,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const countryResponse = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Netherlands&limit=8',
    });
    expect(countryResponse.statusCode).toBe(200);
    const countryBody = JSON.parse(countryResponse.body) as LocationSearchTestSuggestion[];
    expect(countryBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'country',
          label: 'Netherlands',
          countryCode: 'NL',
          filterToken: expect.objectContaining({
            type: 'country',
            countryCode: 'NL',
          }),
        }),
      ])
    );

    const unbackedCountryResponse = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Portugal&limit=8&countrycode=PT',
    });
    expect(unbackedCountryResponse.statusCode).toBe(200);
    const unbackedCountryBody = JSON.parse(
      unbackedCountryResponse.body
    ) as LocationSearchTestSuggestion[];
    expect(
      unbackedCountryBody.some(
        (suggestion) => suggestion.type === 'country' && suggestion.countryCode === 'PT'
      )
    ).toBe(false);
  });

  it('keeps same-name streets in different cities and regions as distinct backed identities', async () => {
    const suffix = Date.now().toString(36);
    const street = `Shared Identity Lane ${suffix}`;
    const firstProperty = await createIntegrationProperty({
      street,
      houseNumber: 1,
      city: `Identitydam ${suffix}`,
      region: `Identity Region A ${suffix}`,
      postalCode: '5666IA',
      lon: 5.501,
      lat: 51.451,
    });
    const secondProperty = await createIntegrationProperty({
      street,
      houseNumber: 2,
      city: `Identityburg ${suffix}`,
      region: `Identity Region B ${suffix}`,
      postalCode: '5666IB',
      lon: 5.502,
      lat: 51.452,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(street)}&limit=8&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const streetSuggestions = body.filter(
      (suggestion) => suggestion.type === 'street' && suggestion.label === street
    );
    const ids = streetSuggestions.map((suggestion) => suggestion.filterToken?.id);

    expect(streetSuggestions).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(streetSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          city: `Identitydam ${suffix}`,
          region: `Identity Region A ${suffix}`,
          filterToken: expect.objectContaining({
            type: 'street',
            street,
            city: `Identitydam ${suffix}`,
            region: `Identity Region A ${suffix}`,
          }),
        }),
        expect.objectContaining({
          city: `Identityburg ${suffix}`,
          region: `Identity Region B ${suffix}`,
          filterToken: expect.objectContaining({
            type: 'street',
            street,
            city: `Identityburg ${suffix}`,
            region: `Identity Region B ${suffix}`,
          }),
        }),
      ])
    );
  });

  it('merges same-name streets in the same city when only raw region differs', async () => {
    const suffix = `alpha${Date.now().toString(36).replace(/\d/gu, 'a')}`;
    const city = `Regional Identity City ${suffix}`;
    const street = `Regional Identity Street ${suffix}`;
    const firstProperty = await createIntegrationProperty({
      street,
      houseNumber: 1,
      city,
      region: `Regional Identity A ${suffix}`,
      postalCode: '5666RA',
      lon: 5.503,
      lat: 51.453,
    });
    const secondProperty = await createIntegrationProperty({
      street,
      houseNumber: 2,
      city,
      region: `Regional Identity B ${suffix}`,
      postalCode: '5666RB',
      lon: 5.504,
      lat: 51.454,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const streetResponse = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(street)}&limit=8&countrycode=NL`,
    });
    expect(streetResponse.statusCode).toBe(200);
    const streetBody = JSON.parse(streetResponse.body) as LocationSearchTestSuggestion[];
    const streetSuggestions = streetBody.filter(
      (suggestion) => suggestion.type === 'street' && suggestion.label === street
    );

    expect(streetSuggestions).toHaveLength(1);
    expect(streetSuggestions[0]).toEqual(
      expect.objectContaining({
        city,
        street,
        filterToken: expect.objectContaining({
          id: `street:NL:${normalizeSearchToken(street)}:city=${normalizeSearchToken(city)}`,
          city,
          street,
        }),
      })
    );
    expect(streetSuggestions[0]?.filterToken?.id).not.toContain('region=');
  });

  it('prefers Waalre-area Aalst when proximity makes that Photon district relevant', async () => {
    const waalreProperties = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createIntegrationProperty({
          street: 'Waalre Aalstpad',
          houseNumber: index + 1,
          city: 'Waalre',
          region: 'Noord-Brabant',
          postalCode: index % 2 === 0 ? '5582AA' : '5582AB',
          lon: 5.477 + index * 0.00001,
          lat: 51.397 + index * 0.00001,
        })
      )
    );
    const rielStreetProperty = await createIntegrationProperty({
      street: 'Aalst',
      houseNumber: 1,
      city: 'Riel',
      region: 'Noord-Brabant',
      postalCode: '5133AA',
      lon: 5.02,
      lat: 51.52,
    });
    createdPropertyIds.push(
      ...waalreProperties.map((property) => property.id),
      rielStreetProperty.id
    );

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.48, 51.395] },
              properties: {
                osm_type: 'N',
                osm_id: 91001,
                name: 'Aalst',
                postcode: '5582',
                city: 'Waalre',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'district',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Aalst&limit=8&countrycode=NL&lon=5.48&lat=51.395',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'postcode',
        label: 'Aalst',
        city: 'Waalre',
        postalCode: expect.stringMatching(/^558[23]$/u),
      })
    );
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'street',
          label: 'Aalst',
          city: 'Riel',
          filterToken: expect.objectContaining({
            type: 'street',
            street: 'Aalst',
            city: 'Riel',
          }),
        }),
      ])
    );
  });

  it('maps supported neighborhood-like Photon suggestions to a filterable postcode area', async () => {
    const properties = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createIntegrationProperty({
          street: 'Strijp-S Filterstraat',
          houseNumber: index + 1,
          city: 'Eindhoven',
          region: 'Noord-Brabant',
          postalCode: index % 2 === 0 ? '5617AB' : '5617AC',
          lon: 5.455 + index * 0.00001,
          lat: 51.447 + index * 0.00001,
        })
      )
    );
    createdPropertyIds.push(...properties.map((property) => property.id));

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.455, 51.447] },
              properties: {
                osm_type: 'N',
                osm_id: 92001,
                name: 'Strijp-S',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'locality',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Strijp-S&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'postcode',
          label: 'Strijp-S',
          postalCode: '5617',
          city: 'Eindhoven',
          filterToken: expect.objectContaining({
            type: 'postcode',
            value: '5617',
            postalCode: '5617',
            city: 'Eindhoven',
          }),
        }),
      ])
    );
    expect(
      body.filter((suggestion: { label: string }) => suggestion.label === 'Strijp-S')
    ).toHaveLength(1);
  });

  it('never turns Photon-only unresolved area-like results into filterable area tokens', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [3.1, 53.2] },
              properties: {
                osm_type: 'N',
                osm_id: 92501,
                name: 'Ghost Quarter',
                city: 'Farawaystad',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'locality',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Ghost%20Quarter&limit=8&countrycode=NL&lon=3.1&lat=53.2',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const unbackedAreaSuggestion = body.find(
      (suggestion) =>
        isAreaSuggestion(suggestion) &&
        suggestion.filterToken &&
        suggestion.label === 'Ghost Quarter'
    );
    const coordinateFallback = body.find((suggestion) => suggestion.label === 'Ghost Quarter');

    expect(unbackedAreaSuggestion).toBeUndefined();
    if (coordinateFallback) {
      expect(coordinateFallback).toEqual(
        expect.objectContaining({
          type: 'address',
          filterToken: null,
          coordinates: [3.1, 53.2],
        })
      );
    }
  });

  it('returns sparse GB Photon-only house fallbacks as coordinate-only addresses', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-0.1276, 51.5072] },
              properties: {
                osm_type: 'N',
                osm_id: 92502,
                street: 'Sparse Search Road',
                housenumber: '10',
                postcode: 'SW1A 1AA',
                city: 'London',
                country: 'United Kingdom',
                countrycode: 'gb',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Sparse%20Search%20Road%2010&limit=8&countrycode=GB',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'address',
        label: 'Sparse Search Road 10, SW1A 1AA London',
        countryCode: 'GB',
        propertyId: null,
        filterToken: null,
        coordinates: [-0.1276, 51.5072],
      })
    );
  });

  it('does not run aggregate token hydration on the location-search hot path', async () => {
    const executeSpy = jest.spyOn(db, 'execute');
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.7, 51.7] },
              properties: {
                osm_type: 'R',
                osm_id: 93001,
                name: 'NoAggregateHydrationville',
                city: 'NoAggregateHydrationville',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'city',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=NoAggregateHydrationville&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const executedSql = executeSpy.mock.calls.map((call) => stringifySqlQuery(call[0])).join('\n');
    expect(executedSql).not.toContain('MIN(ST_X');
    executeSpy.mockRestore();
  });

  it('returns one city area suggestion when Photon also returns a same-name station', async () => {
    const property = await createIntegrationProperty({
      street: 'Station City Anchor',
      houseNumber: 1,
      city: 'Eindhoven',
      region: 'Noord-Brabant',
      postalCode: '5611AA',
      lon: 5.4697,
      lat: 51.4416,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.4697, 51.4416] },
              properties: {
                osm_type: 'R',
                osm_id: 100,
                name: 'Eindhoven',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'city',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.4792, 51.4436] },
              properties: {
                osm_type: 'N',
                osm_id: 200,
                name: 'Eindhoven',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'railway',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.47, 51.44] },
              properties: {
                osm_type: 'R',
                osm_id: 300,
                name: 'Eindhoven',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'city',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Eindhoven&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const citySuggestions = body.filter(
      (suggestion) => suggestion.type === 'city' && suggestion.label === 'Eindhoven'
    );
    expect(citySuggestions).toHaveLength(1);
    expect(citySuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'city:NL:eindhoven',
          type: 'city',
          label: 'Eindhoven',
          region: null,
          postalCode: null,
          filterToken: expect.objectContaining({
            id: 'city:NL:eindhoven',
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
            region: null,
            postalCode: null,
          }),
        }),
      ])
    );
    expect(citySuggestions.every((suggestion) => suggestion.id === suggestion.filterToken?.id)).toBe(
      true
    );
    expect(JSON.stringify(body)).not.toContain('N_200');
    expect(JSON.stringify(body)).not.toContain('railway');
  });

  it('collapses same-city region variants into one canonical regionless city suggestion', async () => {
    const suffix = Date.now().toString(36);
    const city = `Variantstad ${suffix}`;
    const properties = await Promise.all([
      createIntegrationProperty({
        street: `Variantstraat A ${suffix}`,
        houseNumber: 1,
        city,
        region: city,
        postalCode: '5666VA',
        lon: 5.41,
        lat: 51.41,
      }),
      createIntegrationProperty({
        street: `Variantstraat B ${suffix}`,
        houseNumber: 2,
        city,
        region: `Variant Province ${suffix}`,
        postalCode: '5666VB',
        lon: 5.42,
        lat: 51.42,
      }),
      createIntegrationProperty({
        street: `Variantstraat C ${suffix}`,
        houseNumber: 3,
        city,
        region: null,
        postalCode: '5666VC',
        lon: 5.43,
        lat: 51.43,
      }),
    ]);
    createdPropertyIds.push(...properties.map((property) => property.id));

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(city)}&limit=8&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const citySuggestions = body.filter(
      (suggestion) => suggestion.type === 'city' && suggestion.label === city
    );

    expect(citySuggestions).toHaveLength(1);
    expect(citySuggestions[0]).toEqual(
      expect.objectContaining({
        id: `city:NL:variantstad-${suffix}`,
        type: 'city',
        label: city,
        region: null,
        filterToken: expect.objectContaining({
          id: `city:NL:variantstad-${suffix}`,
          type: 'city',
          countryCode: 'NL',
          value: `variantstad-${suffix}`,
          label: city,
          region: null,
        }),
      })
    );
    expect(citySuggestions[0]).not.toHaveProperty('resultCount');
    expect(citySuggestions[0]?.filterToken).not.toHaveProperty('resultCount');
    expect(JSON.stringify(citySuggestions)).not.toContain(`Variant Province ${suffix}`);
  });

  it.each([
    ['country default ranking for no-bias street searches', '', 'Defaultstad'],
    ['explicit proximity bias over country default ranking', '&lon=4.89&lat=52.37', 'Biasstad'],
  ])('uses %s', async (_caseName, biasParams, expectedCityPrefix) => {
    const suffix = Date.now().toString(36);
    const street = `Zwaanstraat Ranking ${suffix}`;
    const defaultNear = await createIntegrationProperty({
      street,
      houseNumber: 1,
      city: `Defaultstad ${suffix}`,
      region: 'Noord-Brabant',
      postalCode: '5666ZD',
      lon: 5.47,
      lat: 51.44,
    });
    const explicitNear = await createIntegrationProperty({
      street,
      houseNumber: 2,
      city: `Biasstad ${suffix}`,
      region: 'Noord-Holland',
      postalCode: '1066ZD',
      lon: 4.89,
      lat: 52.37,
    });
    createdPropertyIds.push(defaultNear.id, explicitNear.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(street)}&limit=8&countrycode=NL${biasParams}`,
    });

    expect(response.statusCode).toBe(200);

    const firstStreetCity = (responseBody: string) =>
      (JSON.parse(responseBody) as LocationSearchTestSuggestion[]).find(
        (suggestion) => suggestion.type === 'street' && suggestion.label === street
      )?.city;

    expect(firstStreetCity(response.body)).toBe(`${expectedCityPrefix} ${suffix}`);
  });

  it('falls back to local country filtering when Photon countrycode search returns no features', async () => {
    const suffix = Date.now().toString(36);
    const city = `Photon Fallbackstad ${suffix}`;
    const property = await createIntegrationProperty({
      street: `Photon Fallback Street ${suffix}`,
      houseNumber: 1,
      city,
      region: `Photon Fallback Region ${suffix}`,
      postalCode: '0988ZZ',
      lon: 5.4697,
      lat: 51.4416,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: null,
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4697, 51.4416] },
                properties: {
                  osm_type: 'R',
                  osm_id: 100,
                  name: city,
                  city,
                  state: `Photon Fallback Region ${suffix}`,
                  country: 'Nederland',
                  countrycode: 'NL',
                  type: 'city',
                },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [6.0839, 50.7753] },
                properties: {
                  osm_type: 'R',
                  osm_id: 200,
                  name: 'Aachen',
                  state: 'Nordrhein-Westfalen',
                  country: 'Deutschland',
                  countrycode: 'DE',
                  type: 'city',
                },
              },
            ],
          }),
      } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(city)}&limit=8&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
    const firstUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    const secondUrl = (mockFetchFn.mock.calls[1] as unknown[])[0] as string;
    expect(firstUrl).toContain('countrycode=nl');
    expect(secondUrl).not.toContain('countrycode=');

    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const citySuggestions = body.filter(
      (suggestion) => suggestion.type === 'city' && suggestion.label === city
    );
    expect(citySuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'city',
          label: city,
          countryCode: 'NL',
          filterToken: expect.objectContaining({
            type: 'city',
            countryCode: 'NL',
            value: `photon-fallbackstad-${suffix}`,
          }),
        }),
      ])
    );
    expect(body.every((suggestion) => suggestion.countryCode === 'NL')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Aachen');
  });

  it('suppresses same-label street duplicate for exact city searches', async () => {
    const streetProperty = await createIntegrationProperty({
      street: 'Eindhoven',
      houseNumber: 1,
      city: 'Eindhoven',
      region: 'Noord-Brabant',
      postalCode: '5611AA',
      lon: 5.4698,
      lat: 51.4417,
    });
    createdPropertyIds.push(streetProperty.id);

    mockFetchFn
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4697, 51.4416] },
                properties: {
                  osm_type: 'R',
                  osm_id: 100,
                  name: 'Eindhoven',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'city',
                },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [5.4698, 51.4417] },
                properties: {
                  osm_type: 'W',
                  osm_id: 101,
                  street: 'Eindhoven',
                  city: 'Eindhoven',
                  state: 'Noord-Brabant',
                  country: 'Nederland',
                  countrycode: 'nl',
                  type: 'street',
                },
              },
            ],
          }),
      } as unknown as Response)
      .mockResolvedValueOnce(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Eindhoven&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'city',
          label: 'Eindhoven',
          countryCode: 'NL',
        }),
      ])
    );
    expect(
      body.some(
        (suggestion: { type: string; label: string; countryCode: string }) =>
          suggestion.type === 'street' &&
          suggestion.label === 'Eindhoven' &&
          suggestion.countryCode === 'NL'
      )
    ).toBe(false);
  });

  it('returns and filters Overture-backed city suggestions by division membership', async () => {
    const suffix = Date.now().toString(36);
    const divisionId = `test-overture-city-${suffix}`;
    const areaId = `test-overture-city-area-${suffix}`;
    const overtureCity = `Overture Fixture City ${suffix}`;
    createdDivisionIds.push(divisionId);

    await db.execute(sql`
      INSERT INTO overture_divisions (
        id,
        subtype,
        country_code,
        name,
        geometry
      )
      VALUES (
        ${divisionId},
        'locality',
        'NL',
        ${overtureCity},
        ST_SetSRID(ST_MakePoint(5.62, 51.62), 4326)
      )
    `);
    await db.execute(sql`
      INSERT INTO overture_division_areas (
        id,
        division_id,
        subtype,
        country_code,
        name,
        min_lon,
        min_lat,
        max_lon,
        max_lat,
        geometry
      )
      VALUES (
        ${areaId},
        ${divisionId},
        'locality',
        'NL',
        ${overtureCity},
        5.60,
        51.60,
        5.64,
        51.64,
        ST_SetSRID(ST_Multi(ST_MakeEnvelope(5.60, 51.60, 5.64, 51.64, 4326)), 4326)
      )
    `);

    const property = await createIntegrationProperty({
      street: `Overture Member Street ${suffix}`,
      houseNumber: 1,
      city: `Property Text City ${suffix}`,
      region: 'Noord-Brabant',
      postalCode: '5688OC',
      lon: 5.62,
      lat: 51.62,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    const response = await app.inject({
      method: 'GET',
      url: `/search/locations?q=${encodeURIComponent(overtureCity)}&limit=8&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as LocationSearchTestSuggestion[];
    const citySuggestion = body.find(
      (suggestion) =>
        suggestion.type === 'city' && suggestion.filterToken?.divisionId === divisionId
    );
    expect(citySuggestion).toEqual(
      expect.objectContaining({
        type: 'city',
        label: overtureCity,
        filterToken: expect.objectContaining({
          source: 'overture',
          divisionId,
        }),
      })
    );

    const token = parseLocationFilterToken(citySuggestion?.filterToken?.id ?? '');
    const filteredRows = Array.from(
      await db.execute<{ id: string }>(sql`
      SELECT p.id
      FROM properties p
      WHERE p.id = ${property.id}
        AND ${buildLocationAreaFilterPredicate(token ? [token] : [])}
    `)
    );
    expect(filteredRows.map((row) => row.id)).toEqual([property.id]);
  });

  it('resolves property suggestions only for exact unambiguous house-number additions', async () => {
    const baseProperty = await createIntegrationProperty({
      street: 'Addition Teststraat',
      houseNumber: 16,
      houseNumberAddition: null,
      city: 'Eindhoven',
      postalCode: '5651HP',
      lon: 5.45,
      lat: 51.43,
    });
    const additionProperty = await createIntegrationProperty({
      street: 'Addition Teststraat',
      houseNumber: 16,
      houseNumberAddition: 'A',
      city: 'Eindhoven',
      postalCode: '5651HP',
      lon: 5.451,
      lat: 51.431,
    });
    createdPropertyIds.push(baseProperty.id, additionProperty.id);

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.451, 51.431] },
              properties: {
                osm_type: 'W',
                osm_id: 1601,
                street: 'Addition Teststraat',
                housenumber: '16A',
                postcode: '5651HP',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.452, 51.432] },
              properties: {
                osm_type: 'W',
                osm_id: 1602,
                street: 'Addition Teststraat',
                housenumber: '16B',
                postcode: '5651HP',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Addition+Teststraat+16A&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'property',
        propertyId: additionProperty.id,
        houseNumber: '16A',
        houseNumberAddition: 'A',
      })
    );
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'address',
          propertyId: null,
          houseNumber: '16B',
        }),
      ])
    );
  });

  it('falls back to an address suggestion when a property lookup is ambiguous', async () => {
    const firstProperty = await createIntegrationProperty({
      street: 'Ambiguous One',
      houseNumber: 22,
      houseNumberAddition: null,
      city: 'Eindhoven',
      postalCode: '5652HP',
      lon: 5.46,
      lat: 51.43,
    });
    const secondProperty = await createIntegrationProperty({
      street: 'Ambiguous Two',
      houseNumber: 22,
      houseNumberAddition: null,
      city: 'Eindhoven',
      postalCode: '5652HP',
      lon: 5.462,
      lat: 51.432,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [5.461, 51.431] },
              properties: {
                osm_type: 'W',
                osm_id: 2201,
                name: 'Ambiguous 22',
                housenumber: '22',
                postcode: '5652HP',
                city: 'Eindhoven',
                state: 'Noord-Brabant',
                country: 'Nederland',
                countrycode: 'nl',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Ambiguous+22&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)[0]).toEqual(
      expect.objectContaining({
        type: 'address',
        propertyId: null,
      })
    );
  });
});

describe('GET /search/location-tokens', () => {
  let app: FastifyInstance;
  const createdPropertyIds: string[] = [];

  beforeAll(async () => {
    app = await buildGeocodeTestApp();
  });

  afterAll(async () => {
    await cleanupCreatedProperties(createdPropertyIds);
    // The file-level teardown closes all Fastify apps and the shared DB connection.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
  });

  afterEach(async () => {
    await cleanupCreatedProperties(createdPropertyIds);
  });

  it('hydrates repeated readable area tokens with labels, hierarchy, center, and bbox', async () => {
    const firstProperty = await createIntegrationProperty({
      street: 'Hydrationstraat',
      houseNumber: 1,
      city: 'Hydratiedam',
      region: 'Noord-Brabant',
      postalCode: '5612MA',
      lon: 5.47,
      lat: 51.44,
    });
    const secondProperty = await createIntegrationProperty({
      street: 'Hydrationstraat',
      houseNumber: 3,
      city: 'Hydratiedam',
      region: 'Noord-Brabant',
      postalCode: '5612MA',
      lon: 5.49,
      lat: 51.46,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    const streetArea = encodeURIComponent('street:NL:hydrationstraat:city=hydratiedam');
    const postcodeArea = encodeURIComponent('postcode:NL:5612ma:city=hydratiedam');
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${streetArea}&area=${postcodeArea}&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(
      expect.objectContaining({
        id: 'street:NL:hydrationstraat:city=hydratiedam',
        type: 'street',
        label: 'Hydrationstraat',
        value: 'hydrationstraat',
        countryCode: 'NL',
        city: 'Hydratiedam',
        region: 'Noord-Brabant',
        postalCode: null,
        street: 'Hydrationstraat',
        parentLabel: 'Hydratiedam, Noord-Brabant',
        coordinates: expect.any(Array),
        bbox: expect.any(Array),
      })
    );
    expect(body[0].bbox[0]).toBeCloseTo(5.47, 5);
    expect(body[0].bbox[2]).toBeCloseTo(5.49, 5);
    expect(body[1]).toEqual(
      expect.objectContaining({
        type: 'postcode',
        label: '5612MA',
        postalCode: '5612MA',
        coordinates: expect.any(Array),
        bbox: expect.any(Array),
      })
    );
  });

  it('hydrates regionless city tokens as one broad city token matching all region variants', async () => {
    const suffix = Date.now().toString(36);
    const city = `Hydration Variantstad ${suffix}`;
    const properties = await Promise.all([
      createIntegrationProperty({
        street: `Hydration Variant A ${suffix}`,
        houseNumber: 1,
        city,
        region: city,
        postalCode: '5677HA',
        lon: 5.31,
        lat: 51.31,
      }),
      createIntegrationProperty({
        street: `Hydration Variant B ${suffix}`,
        houseNumber: 2,
        city,
        region: `Hydration Province ${suffix}`,
        postalCode: '5677HB',
        lon: 5.34,
        lat: 51.34,
      }),
      createIntegrationProperty({
        street: `Hydration Variant C ${suffix}`,
        houseNumber: 3,
        city,
        region: null,
        postalCode: '5677HC',
        lon: 5.37,
        lat: 51.37,
      }),
    ]);
    createdPropertyIds.push(...properties.map((property) => property.id));

    const cityArea = encodeURIComponent(`city:NL:hydration-variantstad-${suffix}`);
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${cityArea}&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        id: `city:NL:hydration-variantstad-${suffix}`,
        type: 'city',
        label: city,
        value: `hydration-variantstad-${suffix}`,
        countryCode: 'NL',
        region: null,
        parentLabel: 'Netherlands',
        coordinates: expect.any(Array),
        bbox: expect.any(Array),
      })
    );
    expect(body[0]).not.toHaveProperty('resultCount');
    expect(body[0].bbox[0]).toBeCloseTo(5.31, 5);
    expect(body[0].bbox[2]).toBeCloseTo(5.37, 5);

    const hydratedAreaToken = parseLocationFilterToken(body[0].id);
    const filteredRows = Array.from(
      await db.execute<{ id: string }>(sql`
      SELECT p.id
      FROM properties p
      WHERE p.id IN (${sql.join(
        properties.map((property) => sql`${property.id}`),
        sql`, `
      )})
        AND ${buildLocationAreaFilterPredicate(hydratedAreaToken ? [hydratedAreaToken] : [])}
      ORDER BY p.id
    `)
    );
    expect(filteredRows.map((row) => row.id).sort()).toEqual(
      properties.map((property) => property.id).sort()
    );
  });

  it('hydrates region-specific city tokens only when region metadata is explicit', async () => {
    const suffix = Date.now().toString(36);
    const city = `Explicit Regionstad ${suffix}`;
    const firstRegion = `Explicit Region A ${suffix}`;
    const secondRegion = `Explicit Region B ${suffix}`;
    const firstProperty = await createIntegrationProperty({
      street: `Explicit Region A Street ${suffix}`,
      houseNumber: 1,
      city,
      region: firstRegion,
      postalCode: '5678EA',
      lon: 5.21,
      lat: 51.21,
    });
    const secondProperty = await createIntegrationProperty({
      street: `Explicit Region B Street ${suffix}`,
      houseNumber: 2,
      city,
      region: secondRegion,
      postalCode: '5678EB',
      lon: 5.28,
      lat: 51.28,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    const broadArea = encodeURIComponent(`city:NL:explicit-regionstad-${suffix}`);
    const regionalArea = encodeURIComponent(
      `city:NL:explicit-regionstad-${suffix}:region=explicit-region-a-${suffix}`
    );
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${broadArea}&area=${regionalArea}&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(
      expect.objectContaining({
        id: `city:NL:explicit-regionstad-${suffix}`,
        type: 'city',
        label: city,
        region: null,
      })
    );
    expect(body[1]).toEqual(
      expect.objectContaining({
        id: `city:NL:explicit-regionstad-${suffix}:region=explicit-region-a-${suffix}`,
        type: 'city',
        label: city,
        region: firstRegion,
      })
    );

    const regionalToken = parseLocationFilterToken(body[1].id);
    const filteredRows = Array.from(
      await db.execute<{ id: string }>(sql`
      SELECT p.id
      FROM properties p
      WHERE p.id IN (${firstProperty.id}, ${secondProperty.id})
        AND ${buildLocationAreaFilterPredicate(regionalToken ? [regionalToken] : [])}
      ORDER BY p.id
    `)
    );
    expect(filteredRows.map((row) => row.id)).toEqual([firstProperty.id]);
  });

  it('heals stale Zwaanstraat street tokens with Photon state metadata to the DB-backed region', async () => {
    const firstProperty = await createIntegrationProperty({
      street: 'Zwaanstraat',
      houseNumber: 71001,
      city: 'Eindhoven',
      region: 'Eindhoven',
      postalCode: '5651ZA',
      lon: 5.4621,
      lat: 51.4481,
    });
    const secondProperty = await createIntegrationProperty({
      street: 'Zwaanstraat',
      houseNumber: 71003,
      city: 'Eindhoven',
      region: 'Eindhoven',
      postalCode: '5652ZB',
      lon: 5.4623,
      lat: 51.4483,
    });
    createdPropertyIds.push(firstProperty.id, secondProperty.id);

    const staleStreetArea = encodeURIComponent(
      'street:NL:zwaanstraat:city=eindhoven:region=noord-brabant'
    );
    const hydrationResponse = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${staleStreetArea}&countrycode=NL`,
    });

    expect(hydrationResponse.statusCode).toBe(200);
    const hydratedTokens = JSON.parse(hydrationResponse.body);
    expect(hydratedTokens).toHaveLength(1);
    expect(hydratedTokens[0]).toEqual(
      expect.objectContaining({
        id: 'street:NL:zwaanstraat:city=eindhoven',
        type: 'street',
        label: 'Zwaanstraat',
        value: 'zwaanstraat',
        countryCode: 'NL',
        city: 'Eindhoven',
        region: 'Eindhoven',
        postalCode: null,
        street: 'Zwaanstraat',
        parentLabel: 'Eindhoven, Eindhoven',
        coordinates: expect.any(Array),
        bbox: expect.any(Array),
      })
    );

    const hydratedAreaToken = parseLocationFilterToken(hydratedTokens[0].id);
    expect(hydratedAreaToken).not.toBeNull();

    const filteredRows = Array.from(
      await db.execute<{ id: string }>(sql`
      SELECT p.id
      FROM properties p
      WHERE p.id IN (${sql.join(
        [firstProperty.id, secondProperty.id].map((id) => sql`${id}`),
        sql`, `
      )})
        AND ${buildLocationAreaFilterPredicate(hydratedAreaToken ? [hydratedAreaToken] : [])}
      ORDER BY p.id
    `)
    );
    expect(filteredRows.map((row) => row.id)).toEqual(
      expect.arrayContaining([firstProperty.id, secondProperty.id])
    );
  });

  it('accepts a single countrycode string as a fallback for legacy area tokens', async () => {
    const property = await createIntegrationProperty({
      street: 'Fallbackstraat',
      houseNumber: 7,
      city: 'Fallbackstad',
      region: 'Noord-Brabant',
      postalCode: '5613MA',
      lon: 5.5,
      lat: 51.47,
    });
    createdPropertyIds.push(property.id);

    const area = encodeURIComponent('city::fallbackstad');
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${area}&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Fallbackstad',
        value: 'fallbackstad',
        countryCode: 'NL',
        bbox: expect.any(Array),
      })
    );
  });

  it('accepts repeated countrycode params without forcing the wrong country across tokens', async () => {
    const nlProperty = await createIntegrationProperty({
      countryCode: 'NL',
      street: 'Sharedhydrationstraat',
      houseNumber: 11,
      city: 'Sharedhydration',
      region: 'Noord-Brabant',
      postalCode: '5614MA',
      lon: 5.51,
      lat: 51.48,
    });
    const deProperty = await createIntegrationProperty({
      countryCode: 'DE',
      street: 'Sharedhydrationstrasse',
      houseNumber: 11,
      city: 'Sharedhydration',
      region: 'Berlin',
      postalCode: '10115',
      lon: 13.4,
      lat: 52.52,
    });
    createdPropertyIds.push(nlProperty.id, deProperty.id);

    const nlArea = encodeURIComponent('city:NL:sharedhydration');
    const deArea = encodeURIComponent('city:DE:sharedhydration');
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${nlArea}&area=${deArea}&countrycode=NL&countrycode=DE`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Sharedhydration',
        countryCode: 'NL',
        region: null,
        bbox: expect.any(Array),
      })
    );
    expect(body[1]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Sharedhydration',
        countryCode: 'DE',
        region: null,
        bbox: expect.any(Array),
      })
    );
    expect(body[0].coordinates[0]).toBeCloseTo(5.51, 5);
    expect(body[1].coordinates[0]).toBeCloseTo(13.4, 5);
  });

  it('does not hydrate readable area tokens from inactive-only property rows', async () => {
    const suffix = Date.now().toString(36);
    const city = `Inactive Hydration City ${suffix}`;
    const inactiveProperty = await createIntegrationProperty({
      street: `Inactive Hydration Street ${suffix}`,
      houseNumber: 1,
      city,
      region: `Inactive Hydration Region ${suffix}`,
      postalCode: '5666IH',
      status: 'inactive',
      lon: 5.52,
      lat: 51.49,
    });
    createdPropertyIds.push(inactiveProperty.id);

    const area = encodeURIComponent(`city:NL:${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    const response = await app.inject({
      method: 'GET',
      url: `/search/location-tokens?area=${area}&countrycode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'city',
        countryCode: 'NL',
        coordinates: null,
        bbox: null,
      })
    );
    expect(body[0].region).toBeNull();
  });
});

describe('GET /geocode/reverse', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildGeocodeTestApp();
  });

  afterAll(async () => {
    // The file-level teardown closes all Fastify apps and the shared DB connection.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
  });

  it('returns the location hierarchy from Photon without falling back to arbitrary names', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [4.8952, 52.3702] },
              properties: {
                name: 'Sint Agnietenstraat 14',
                locality: 'Burgwallen-Oude Zijde',
                district: 'Centrum',
                county: 'Amsterdam',
                city: 'Amsterdam',
                state: 'Noord-Holland',
                country: 'Nederland',
                countrycode: 'NL',
                type: 'house',
              },
            },
          ],
        }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/reverse?lon=4.8952&lat=52.3702',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(response.headers['x-geocode-cache']).toBe('miss');
    expect(JSON.parse(response.body)).toEqual({
      locality: 'Burgwallen-Oude Zijde',
      district: 'Centrum',
      county: 'Amsterdam',
      city: 'Amsterdam',
      state: 'Noord-Holland',
      country: 'Nederland',
      countryCode: 'NL',
    });
  });

  it('caches repeated reverse geocode lookups by normalized coordinate', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [4.8952, 52.3702] },
              properties: {
                city: 'Amsterdam',
                state: 'Noord-Holland',
                country: 'Nederland',
                countrycode: 'NL',
              },
            },
          ],
        }),
    } as unknown as Response);

    const firstResponse = await app.inject({
      method: 'GET',
      url: '/geocode/reverse?lon=4.8952&lat=52.3702',
    });
    const secondResponse = await app.inject({
      method: 'GET',
      url: '/geocode/reverse?lon=4.8952001&lat=52.3702001',
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers['x-geocode-cache']).toBe('miss');
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.headers['x-geocode-cache']).toBe('hit');
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns null when Photon reverse returns no features', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/geocode/reverse?lon=4.8952&lat=52.3702',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(JSON.parse(response.body)).toBeNull();
  });
});

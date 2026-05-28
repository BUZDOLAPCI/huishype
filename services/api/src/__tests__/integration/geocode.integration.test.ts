import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import { resetReverseGeocodeCacheForTests } from '../../routes/geocode.js';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { createIntegrationProperty } from './helpers/fixtures.js';

// Mock global fetch to simulate Photon responses
const originalFetch = global.fetch;
let mockFetchFn: jest.Mock<typeof global.fetch>;

beforeAll(() => {
  mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
  global.fetch = mockFetchFn;
});

afterAll(() => {
  global.fetch = originalFetch;
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

describe('GET /geocode/search', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
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

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (createdPropertyIds.length > 0) {
      await db.execute(sql`
        UPDATE properties
        SET
          status = 'inactive',
          street = CONCAT('__geocode_fixture_cleanup_', id::text),
          postal_code = LEFT(REPLACE(id::text, '-', ''), 10)
        WHERE id IN (${sql.join(
        createdPropertyIds.map((id) => sql`${id}`),
        sql`, `
      )})`);
    }
    // Keep the shared DB connection open for the following hydration tests.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
  });

  it('returns DB-backed street and property suggestions before weak Photon results', async () => {
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

    await db.execute(sql`
      UPDATE properties
      SET
        status = 'inactive',
        street = CONCAT('__geocode_fixture_cleanup_', id::text),
        postal_code = LEFT(REPLACE(id::text, '-', ''), 10)
      WHERE id IN (${firstProperty.id}, ${secondProperty.id})
    `);
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
    const body = JSON.parse(response.body);
    const streetSuggestions = body.filter(
      (suggestion: { type: string; street?: string | null; label?: string }) =>
        suggestion.type === 'street' &&
        (suggestion.street === 'Deflectiespoelstraat' ||
          suggestion.label === 'Deflectiespoelstraat')
    );

    expect(streetSuggestions).toHaveLength(1);
    expect(streetSuggestions[0]).toEqual(
      expect.objectContaining({
        id: 'street:NL:deflectiespoelstraat:city=eindhoven:region=eindhoven:postcode=5651hp',
        type: 'street',
        label: 'Deflectiespoelstraat',
        city: 'Eindhoven',
        region: 'Eindhoven',
        postalCode: '5651HP',
        street: 'Deflectiespoelstraat',
        filterToken: expect.objectContaining({
          id: 'street:NL:deflectiespoelstraat:city=eindhoven:region=eindhoven:postcode=5651hp',
          type: 'street',
          countryCode: 'NL',
          value: 'deflectiespoelstraat',
          label: 'Deflectiespoelstraat',
          city: 'Eindhoven',
          region: 'Eindhoven',
          postalCode: '5651HP',
          street: 'Deflectiespoelstraat',
        }),
      })
    );
    expect(streetSuggestions[0].id).not.toContain('W_95101');
    expect(streetSuggestions[0].filterToken.id).not.toContain('W_95101');
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
    const body = JSON.parse(response.body);
    const streetSuggestions = body.filter(
      (suggestion: { type: string; street?: string | null; label?: string }) =>
        suggestion.type === 'street' &&
        (suggestion.street === 'Tegenbosch' || suggestion.label === 'Tegenbosch')
    );

    expect(streetSuggestions).toHaveLength(1);
    expect(streetSuggestions[0]).toEqual(
      expect.objectContaining({
        type: 'street',
        label: 'Tegenbosch',
        city: 'Eindhoven',
        street: 'Tegenbosch',
        filterToken: expect.objectContaining({
          id: expect.stringMatching(/^street:NL:tegenbosch:/u),
          type: 'street',
          countryCode: 'NL',
          value: 'tegenbosch',
          label: 'Tegenbosch',
          city: 'Eindhoven',
          street: 'Tegenbosch',
        }),
      })
    );
    expect(streetSuggestions[0].id).toBe(streetSuggestions[0].filterToken.id);
    expect(JSON.stringify(body)).not.toContain('Tilburgseweg');
    expect(JSON.stringify(body)).not.toContain('W_693356158');
  });

  it('keeps a Photon street token and expands it with a same-street address when DB rows are missing', async () => {
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
                  name: 'Beeldbuisring',
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
                  street: 'Beeldbuisring',
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
      url: '/search/locations?q=Beeldbuisring&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'street',
        label: 'Beeldbuisring',
        filterToken: expect.objectContaining({
          type: 'street',
          street: 'Beeldbuisring',
        }),
      })
    );
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'address',
          label: 'Beeldbuisring 1, 5651HA Eindhoven',
          street: 'Beeldbuisring',
          postalCode: '5651HA',
        }),
      ])
    );
  });

  it('normalizes compact and spaced postcode searches to postcode and property suggestions', async () => {
    const property = await createIntegrationProperty({
      street: 'Compact Postcodehof',
      houseNumber: 12,
      city: 'Eindhoven',
      region: 'Noord-Brabant',
      postalCode: '5651 HA',
      lon: 5.457,
      lat: 51.432,
    });
    createdPropertyIds.push(property.id);

    mockFetchFn.mockResolvedValue(emptyPhotonResponse());

    for (const query of ['5651HA', '5651 HA']) {
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
              value: '5651ha',
            }),
          }),
          expect.objectContaining({
            type: 'property',
            postalCode: expect.stringMatching(/^5651\s?HA$/u),
          }),
        ])
      );
    }
  });

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
    expect(executedSql).not.toContain('AVG(ST_X');
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
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Eindhoven',
        postalCode: null,
        filterToken: expect.objectContaining({
          type: 'city',
          countryCode: 'NL',
          value: 'eindhoven',
          label: 'Eindhoven',
          postalCode: null,
        }),
      })
    );
  });

  it('falls back to local country filtering when Photon countrycode search returns no features', async () => {
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
                  name: 'Eindhoven',
                  state: 'Noord-Brabant',
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
      url: '/search/locations?q=Eindhoven&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
    const firstUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    const secondUrl = (mockFetchFn.mock.calls[1] as unknown[])[0] as string;
    expect(firstUrl).toContain('countrycode=nl');
    expect(secondUrl).not.toContain('countrycode=');

    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Eindhoven',
        countryCode: 'NL',
      })
    );
  });

  it('keeps supported same-name suggestions distinguishable by type', async () => {
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
    expect(body.map((suggestion: { type: string }) => suggestion.type)).toEqual(
      expect.arrayContaining(['city', 'street'])
    );
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
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (createdPropertyIds.length > 0) {
      await db.execute(sql`DELETE FROM properties WHERE id IN (${sql.join(
        createdPropertyIds.map((id) => sql`${id}`),
        sql`, `
      )})`);
    }
    // The final reverse-geocode describe closes the Fastify app/DB connection.
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
    resetReverseGeocodeCacheForTests();
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
        id: 'street:NL:hydrationstraat:city=hydratiedam:region=noord-brabant:postcode=5612ma',
        type: 'street',
        label: 'Hydrationstraat',
        value: 'hydrationstraat',
        countryCode: 'NL',
        city: 'Hydratiedam',
        region: 'Noord-Brabant',
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
        city: 'Hydratiedam',
        bbox: expect.any(Array),
      })
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
        region: 'Noord-Brabant',
        bbox: expect.any(Array),
      })
    );
    expect(body[1]).toEqual(
      expect.objectContaining({
        type: 'city',
        label: 'Sharedhydration',
        countryCode: 'DE',
        region: 'Berlin',
        bbox: expect.any(Array),
      })
    );
    expect(body[0].coordinates[0]).toBeCloseTo(5.51, 5);
    expect(body[1].coordinates[0]).toBeCloseTo(13.4, 5);
  });
});

describe('GET /geocode/reverse', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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

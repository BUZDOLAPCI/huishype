import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import { resetReverseGeocodeCacheForTests } from '../../routes/geocode.js';
import type { FastifyInstance } from 'fastify';

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

describe('GET /geocode/search', () => {
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

  it('returns one city area suggestion when Photon also returns a same-name station', async () => {
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
        subtitle: 'Noord-Brabant, Nederland',
        filterToken: expect.objectContaining({
          type: 'city',
          countryCode: 'NL',
          value: 'eindhoven',
          label: 'Eindhoven',
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
    } as unknown as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/search/locations?q=Eindhoven&limit=8&countrycode=NL',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.map((suggestion: { type: string }) => suggestion.type)).toEqual(['city', 'street']);
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

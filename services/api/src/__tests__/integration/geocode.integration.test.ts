import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
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
    await app.close();
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
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

  it('passes countrycode parameter to Photon', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    } as unknown as Response);

    await app.inject({
      method: 'GET',
      url: '/geocode/search?q=test&countrycode=NL',
    });

    const calledUrl = (mockFetchFn.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('countrycode=NL');
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

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for GET /properties/resolve endpoint.
 *
 * Tests against the real PostGIS database seeded with Dutch property data.
 * The endpoint resolves a postal code + house number to a local property.
 */
describe('GET /properties/resolve', () => {
  let app: FastifyInstance;

  // We'll discover a real property from the DB to use in tests
  let knownPostalCode: string;
  let knownHouseNumber: number;
  let knownHouseNumberAddition: string | null;
  let knownPropertyId: string;
  let knownCity: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Fetch a real property from the seeded database to use in tests
    const listResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1',
    });
    const listBody = JSON.parse(listResp.body);
    expect(listBody.data.length).toBeGreaterThan(0);

    const prop = listBody.data[0];
    knownPostalCode = prop.postalCode;
    knownHouseNumber = prop.houseNumber;
    knownHouseNumberAddition = prop.houseNumberAddition;
    knownPropertyId = prop.id;
    knownCity = prop.city;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should resolve a known property by postal code and house number', async () => {
    const query = knownHouseNumberAddition
      ? `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.id).toBe(knownPropertyId);
    expect(body.postalCode).toBe(knownPostalCode);
    expect(body.city).toBe(knownCity);
    expect(body).toHaveProperty('address');
    expect(body).toHaveProperty('coordinates');
    expect(body.coordinates).toHaveProperty('lon');
    expect(body.coordinates).toHaveProperty('lat');
    expect(typeof body.coordinates.lon).toBe('number');
    expect(typeof body.coordinates.lat).toBe('number');
    expect(typeof body.hasListing).toBe('boolean');
    expect(body.wozValue === null || typeof body.wozValue === 'number').toBe(true);
  });

  it('should return 404 for a non-existent address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=9999ZZ&houseNumber=99999',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('NOT_FOUND');
    expect(body).toHaveProperty('message');
  });

  it('should handle postal code with space (e.g. "5658 DP")', async () => {
    // Insert a space into the known postal code (e.g. "5658DP" -> "5658 DP")
    const withSpace = knownPostalCode.slice(0, 4) + ' ' + knownPostalCode.slice(4);

    const query = knownHouseNumberAddition
      ? `postalCode=${encodeURIComponent(withSpace)}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${encodeURIComponent(withSpace)}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(knownPropertyId);
  });

  it('should handle lowercase postal code', async () => {
    const query = knownHouseNumberAddition
      ? `postalCode=${knownPostalCode.toLowerCase()}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${knownPostalCode.toLowerCase()}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(knownPropertyId);
  });

  it('should differentiate between null addition and non-null addition', async () => {
    // If the known property has no addition, querying with an addition should 404
    // If the known property has an addition, querying without should 404
    if (knownHouseNumberAddition) {
      // Property has addition - query without it should fail
      const response = await app.inject({
        method: 'GET',
        url: `/properties/resolve?postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}`,
      });
      // Could be 200 (if a property without addition also exists) or 404
      // We just check it doesn't return the same property
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        // It should be a different property (or the same address without addition)
        expect(body.id).not.toBe(knownPropertyId);
      } else {
        expect(response.statusCode).toBe(404);
      }
    } else {
      // Property has no addition - query with a fake addition should 404
      const response = await app.inject({
        method: 'GET',
        url: `/properties/resolve?postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}&houseNumberAddition=ZZZ`,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('should return 400 for missing postalCode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?houseNumber=1',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 400 for missing houseNumber', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=5658DP',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 400 for invalid houseNumber (non-numeric)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=5658DP&houseNumber=abc',
    });
    expect(response.statusCode).toBe(400);
  });
});

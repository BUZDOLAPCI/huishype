import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for GET /properties/batch endpoint.
 *
 * Tests against the real PostGIS database seeded with Eindhoven data.
 */
describe('GET /properties/batch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return properties for valid IDs in correct order', async () => {
    // First, fetch 3 properties to get real IDs
    const listResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=3',
    });
    expect(listResp.statusCode).toBe(200);
    const listBody = JSON.parse(listResp.body);
    expect(listBody.data.length).toBe(3);

    const ids = listBody.data.map((p: { id: string }) => p.id);
    // Request in reverse order to verify ordering is preserved
    const reversedIds = [...ids].reverse();

    const response = await app.inject({
      method: 'GET',
      url: `/properties/batch?ids=${reversedIds.join(',')}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);

    // Verify order matches input (reversed)
    for (let i = 0; i < reversedIds.length; i++) {
      expect(body[i].id).toBe(reversedIds[i]);
    }

    // Verify property shape matches propertySchema
    const prop = body[0];
    expect(prop).toHaveProperty('id');
    expect(prop).toHaveProperty('address');
    expect(prop).toHaveProperty('city');
    expect(prop).toHaveProperty('postalCode');
    expect(prop).toHaveProperty('geometry');
    expect(prop).toHaveProperty('status');
    expect(prop).toHaveProperty('hasListing');
    expect(prop).toHaveProperty('commentCount');
    expect(prop).toHaveProperty('guessCount');
    expect(prop).toHaveProperty('createdAt');
    expect(prop).toHaveProperty('updatedAt');
  });

  it('should skip non-existent IDs and return only found properties', async () => {
    // Get one real property
    const listResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1',
    });
    const listBody = JSON.parse(listResp.body);
    const realId = listBody.data[0].id;

    // Mix with a non-existent UUID
    const fakeId = 'a0000000-0000-4000-a000-000000000001';
    const response = await app.inject({
      method: 'GET',
      url: `/properties/batch?ids=${fakeId},${realId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // Only the real property should be returned
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(realId);
  });

  it('should return empty array when all IDs are non-existent', async () => {
    const fakeId1 = 'a0000000-0000-4000-a000-000000000001';
    const fakeId2 = 'a0000000-0000-4000-a000-000000000002';
    const response = await app.inject({
      method: 'GET',
      url: `/properties/batch?ids=${fakeId1},${fakeId2}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual([]);
  });

  it('should return 400 when more than 50 IDs are provided', async () => {
    // Generate 51 valid-format UUIDs
    const ids = Array.from({ length: 51 }, (_, i) =>
      `a0000000-0000-4000-a000-${String(i).padStart(12, '0')}`
    );
    const response = await app.inject({
      method: 'GET',
      url: `/properties/batch?ids=${ids.join(',')}`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('should return 400 when ids param is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/batch',
    });

    expect(response.statusCode).toBe(400);
  });

  it('should return 400 when ids param is empty', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/batch?ids=',
    });

    expect(response.statusCode).toBe(400);
  });

  it('should return 400 when ids contain invalid UUIDs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/batch?ids=not-a-uuid,also-invalid',
    });

    expect(response.statusCode).toBe(400);
  });
});

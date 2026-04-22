import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for GET /properties/batch endpoint.
 *
 * Tests against hermetic properties created within this suite.
 */
describe('GET /properties/batch', () => {
  jest.setTimeout(30000);
  let app: FastifyInstance;
  let seededPropertyIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    for (let index = 0; index < 3; index++) {
      const property = await createIntegrationProperty({
        street: 'Batch Fixture Street',
        houseNumber: index + 1,
        city: 'Batch City',
        postalCode: '9090AA',
        lon: 5.471 + index * 0.0001,
        lat: 51.441 + index * 0.0001,
      });
      seededPropertyIds.push(property.id);
    }
  });

  afterAll(async () => {
    if (seededPropertyIds.length > 0) {
      await db.execute(sql`
        DELETE FROM properties
        WHERE id IN (${sql.join(seededPropertyIds.map((id) => sql`${id}`), sql`, `)})
      `);
    }
    if (app) {
      await app.close();
    }
  });

  it('should return properties for valid IDs in correct order', async () => {
    const ids = seededPropertyIds;
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
    expect(prop).toHaveProperty('propertyLikeCount');
    expect(prop).toHaveProperty('topLevelCommentCount');
    expect(prop).toHaveProperty('replyCount');
    expect(prop).toHaveProperty('guessCount');
    expect(prop).toHaveProperty('createdAt');
    expect(prop).toHaveProperty('updatedAt');
  });

  it('should skip non-existent IDs and return only found properties', async () => {
    const realId = seededPropertyIds[0];

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

  it('returns imageryGeometry for snapped aerial framing', async () => {
    const propertyId = crypto.randomUUID();
    const osmId = Number(`8${Date.now()}`.slice(0, 12));

    await db.execute(sql`
      INSERT INTO properties (
        id,
        country_code,
        street,
        house_number,
        city,
        postal_code,
        status,
        geometry
      )
      VALUES (
        ${propertyId},
        'NL',
        'Batch Imagery Street',
        2,
        'TestCity',
        '1234AB',
        'active',
        ST_SetSRID(ST_MakePoint(3.5, 53.00025), 4326)
      )
    `);

    await db.execute(sql`
      INSERT INTO osm_buildings (osm_id, geometry)
      VALUES (
        ${osmId},
        ST_GeomFromText(
          'MULTIPOLYGON(((3.5003 53.0001, 3.5007 53.0001, 3.5007 53.0004, 3.5003 53.0004, 3.5003 53.0001)))',
          4326
        )
      )
    `);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/batch?ids=${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].imageryGeometry.coordinates[0]).toBeGreaterThan(3.5003);
      expect(body[0].imageryGeometry.coordinates[0]).toBeLessThan(3.5007);
      expect(body[0].imageryGeometry.coordinates[1]).toBeGreaterThan(53.0001);
      expect(body[0].imageryGeometry.coordinates[1]).toBeLessThan(53.0005);
    } finally {
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      await db.execute(sql`DELETE FROM osm_buildings WHERE osm_id = ${osmId}`);
    }
  }, 60000);
});

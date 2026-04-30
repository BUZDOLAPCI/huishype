import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import type { FastifyInstance } from 'fastify';
import { createIntegrationListing, createIntegrationProperty } from './helpers/fixtures.js';

describe('GET /health', () => {
  let app: FastifyInstance | undefined;
  let fetchSpy: jest.SpiedFunction<typeof fetch> | undefined;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it('should return 200', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
  });

  it('should return status ok', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  it('should include expected response shape', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');

    expect(typeof body.status).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('should return a valid ISO timestamp', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('should return uptime as a positive number', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('should fail readiness when map projections are stale for active property data', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const property = await createIntegrationProperty({
      street: 'Readiness Projection Stale Street',
      lon: 5.61,
      lat: 51.49,
    });
    await createIntegrationListing({
      propertyId: property.id,
      askingPrice: 525000,
      thumbnailUrl: 'https://cdn.example.com/readiness-stale.jpg',
    });

    try {
      const response = await app!.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.checks.projections.status).toBe('error');
      expect(body.checks.projections.message).toMatch(/Projection|projected|stale/i);
    } finally {
      await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should return 200', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
  });

  it('should mirror property tile pyramid readiness in the canonical health status', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.status).toBe(body.propertyTilePyramid.status);

    if (body.status === 'ok') {
      expect(body.propertyTilePyramid.currentVersionId).toEqual(expect.any(String));
      expect(body.propertyTilePyramid.degradedReason).toBeNull();
      expect(body.propertyTilePyramid.terminalFailureCount).toBe(0);
    } else {
      expect(body.propertyTilePyramid.status).toBe('degraded');
      expect(
        body.propertyTilePyramid.degradedReason ||
          body.propertyTilePyramid.activeCandidateVersionId ||
          body.propertyTilePyramid.retryableFailureDueAt ||
          body.propertyTilePyramid.terminalFailureCount > 0
      ).toBeTruthy();
    }
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
    expect(body).toHaveProperty('propertyTilePyramid');
    expect(body.propertyTilePyramid).toHaveProperty('status');
    expect(body.propertyTilePyramid).toHaveProperty('currentVersionId');
    expect(body.propertyTilePyramid).toHaveProperty('degradedReason');

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
});

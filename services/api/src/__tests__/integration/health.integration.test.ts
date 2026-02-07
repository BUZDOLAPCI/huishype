import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
  });

  it('should return status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  it('should include expected response shape', async () => {
    const response = await app.inject({
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
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('should return uptime as a positive number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.uptime).toBeGreaterThan(0);
  });
});

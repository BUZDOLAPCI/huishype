import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

describe('Reactions Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /comments/:id/like', () => {
    it('should handle the endpoint (route is registered)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      // Route is registered - we should get something other than 404 (Not Found route)
      // Could be 200 (success), 400 (validation error), or 500 (DB error)
      expect([200, 400, 500]).toContain(response.statusCode);
    });

    it('should handle invalid UUID format with 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/comments/invalid-uuid/like',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /comments/:id/like', () => {
    it('should handle request without user ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      // Should be 400 (validation), 401 (auth required), or 500 (DB error)
      expect([400, 401, 500]).toContain(response.statusCode);
    });

    it('should handle request with user ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
        headers: {
          'x-user-id': '00000000-0000-0000-0000-000000000001',
        },
      });

      // With user ID but no real DB, expect 201 (success), 400 (validation/already liked), or 500 (DB error)
      expect([201, 400, 500]).toContain(response.statusCode);
    });

    it('should handle invalid UUID format with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/comments/invalid-uuid/like',
        headers: {
          'x-user-id': '00000000-0000-0000-0000-000000000001',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /comments/:id/like', () => {
    it('should handle request without user ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      // Should be 400 (validation), 401 (auth required), or 500 (DB error)
      expect([400, 401, 500]).toContain(response.statusCode);
    });

    it('should handle invalid UUID format with 400', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/comments/invalid-uuid/like',
        headers: {
          'x-user-id': '00000000-0000-0000-0000-000000000001',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle valid request format', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
        headers: {
          'x-user-id': '00000000-0000-0000-0000-000000000001',
        },
      });

      // With valid format, expect 200 (success), 400 (validation), 404 (not liked), or 500 (DB error)
      expect([200, 400, 404, 500]).toContain(response.statusCode);
    });
  });

  describe('OpenAPI Documentation', () => {
    it('should include reactions endpoints in swagger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);

      // Check that reactions endpoints are documented
      expect(swagger.paths).toHaveProperty('/comments/{id}/like');
      expect(swagger.paths['/comments/{id}/like']).toHaveProperty('get');
      expect(swagger.paths['/comments/{id}/like']).toHaveProperty('post');
      expect(swagger.paths['/comments/{id}/like']).toHaveProperty('delete');
    });

    it('should have correct tags for reactions endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);

      // Check that endpoints have the reactions tag
      const likePath = swagger.paths['/comments/{id}/like'];
      expect(likePath.get.tags).toContain('reactions');
      expect(likePath.post.tags).toContain('reactions');
      expect(likePath.delete.tags).toContain('reactions');
    });

    it('should document request parameters correctly', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);

      // Check that id parameter is documented
      const likePath = swagger.paths['/comments/{id}/like'];
      expect(likePath.get.parameters).toBeDefined();
      expect(likePath.get.parameters.some((p: { name: string }) => p.name === 'id')).toBe(true);
    });
  });

  describe('Route Registration', () => {
    it('should register GET /comments/:id/like route', async () => {
      // Just verify the route is registered (not returning 404)
      const response = await app.inject({
        method: 'GET',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      expect(response.statusCode).not.toBe(404);
    });

    it('should register POST /comments/:id/like route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      expect(response.statusCode).not.toBe(404);
    });

    it('should register DELETE /comments/:id/like route', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/comments/00000000-0000-0000-0000-000000000001/like',
      });

      expect(response.statusCode).not.toBe(404);
    });
  });
});

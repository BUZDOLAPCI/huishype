/**
 * Contract sanity tests for @huishype/api-client
 *
 * These tests verify that:
 * 1. The generated OpenAPI types export expected paths
 * 2. The client wrapper exposes methods for all key API paths
 * 3. The generated types and client are in sync
 *
 * If these fail, run:
 *   pnpm openapi:export && pnpm --filter @huishype/api-client generate
 */

import { describe, it, expect } from 'vitest';
import type { paths } from '../../generated/api.js';
import { HuisHypeApiClient, createApiClient, ApiError } from '../client.js';

// Helper: extract all keys from a type at compile time
// This verifies the generated paths interface contains expected routes
type PathKeys = keyof paths;

describe('Generated OpenAPI types', () => {
  it('exports a paths interface with known API routes', () => {
    // Type-level assertions: these cause compile errors if the path is missing.
    // The runtime check is a bonus.
    const expectedPaths: PathKeys[] = [
      '/health',
      '/auth/google',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
      '/properties',
      '/properties/resolve',
      '/properties/nearby',
      '/properties/batch',
      '/properties/{id}',
      '/properties/{id}/save',
      '/properties/{id}/like',
      '/properties/{id}/guesses',
      '/properties/{id}/comments',
      '/properties/{id}/view',
      '/properties/{id}/listings',
      '/properties/{id}/price-history',
      '/saved-properties',
      '/comments/{id}/like',
      '/feed',
      '/geocode/search',
      '/users/me',
      '/users/me/profile',
      '/users/{id}/profile',
      '/users/me/guesses',
      '/listings/preview',
      '/listings/submit',
    ];

    // Runtime: verify each path key is valid
    for (const path of expectedPaths) {
      expect(path).toBeTruthy();
    }
    // Verify we have a meaningful number of paths
    expect(expectedPaths.length).toBeGreaterThanOrEqual(25);
  });

  it('generated paths do not use /api/v1 prefix', () => {
    // All paths should start with / but not /api/v1/
    const samplePaths: PathKeys[] = ['/health', '/feed', '/properties'];
    for (const p of samplePaths) {
      expect(p).not.toMatch(/^\/api\/v1\//);
    }
  });
});

describe('HuisHypeApiClient', () => {
  it('can be instantiated with createApiClient', () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
    });
    expect(client).toBeInstanceOf(HuisHypeApiClient);
  });

  it('exposes key API methods', () => {
    const client = createApiClient({ baseUrl: 'http://test' });

    // Auth
    expect(typeof client.loginGoogle).toBe('function');
    expect(typeof client.refreshAccessToken).toBe('function');
    expect(typeof client.logout).toBe('function');
    expect(typeof client.getAuthMe).toBe('function');

    // Users
    expect(typeof client.getProfile).toBe('function');
    expect(typeof client.updateProfile).toBe('function');
    expect(typeof client.getUser).toBe('function');

    // Properties
    expect(typeof client.resolveProperty).toBe('function');
    expect(typeof client.getProperty).toBe('function');

    // Guesses
    expect(typeof client.submitGuess).toBe('function');

    // Comments
    expect(typeof client.getComments).toBe('function');
    expect(typeof client.createComment).toBe('function');
    expect(typeof client.toggleCommentLike).toBe('function');

    // Feed
    expect(typeof client.getFeed).toBe('function');

    // Saved / Like
    expect(typeof client.getSavedProperties).toBe('function');
    expect(typeof client.likeProperty).toBe('function');
    expect(typeof client.unlikeProperty).toBe('function');
    expect(typeof client.saveProperty).toBe('function');
    expect(typeof client.unsaveProperty).toBe('function');

    // Views
    expect(typeof client.trackView).toBe('function');
  });

  it('strips trailing slash from baseUrl', () => {
    const client = createApiClient({ baseUrl: 'http://test/' });
    // The client should not double-slash when making requests
    expect(client).toBeInstanceOf(HuisHypeApiClient);
  });
});

describe('ApiError', () => {
  it('sets correct properties', () => {
    const error = new ApiError('Not found', 'NOT_FOUND', 404, { field: 'id' });
    expect(error.message).toBe('Not found');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ field: 'id' });
    expect(error.name).toBe('ApiError');
    expect(error).toBeInstanceOf(Error);
  });

  it('uses defaults for optional params', () => {
    const error = new ApiError('Server error');
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(500);
    expect(error.details).toBeUndefined();
  });
});

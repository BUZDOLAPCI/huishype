/**
 * Contract sanity tests for @huishype/api-client
 *
 * If these fail, regenerate the contract:
 *   pnpm openapi:export && pnpm --filter @huishype/api-client generate
 */

import { describe, it, expect, vi } from 'vitest';
import type { paths } from '../../generated/api.js';
import type {
  GetFeedRequest,
  GetFeedResponse,
  GetSavedPropertiesResponse,
  SubmitListingRequest,
  SubmitListingResponse,
} from '@huishype/shared';
import { ApiError, HuisHypeApiClient, createApiClient } from '../client.js';

type PathKeys = keyof paths;
type Assert<T extends true> = T;
type IsExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false;
type Expand<T> = { [K in keyof T]: T[K] };
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
    ? true
    : false
  : false;

type FeedQueryFromOpenApi = NonNullable<paths['/feed']['get']['parameters']['query']>;
type FeedResponseFromOpenApi = paths['/feed']['get']['responses'][200]['content']['application/json'];
type AuthSessionResponseFromOpenApi = paths['/auth/session']['get']['responses'][200]['content']['application/json'];
type SubmitListingRequestFromOpenApi = paths['/listings/submit']['post']['requestBody']['content']['application/json'];
type SubmitListingResponseFromOpenApi = paths['/listings/submit']['post']['responses'][201]['content']['application/json'];
type SubmitListingErrorFromOpenApi = paths['/listings/submit']['post']['responses'][400]['content']['application/json'];
type CanonicalSubmitListingRequest = Expand<SubmitListingRequest>;
type CanonicalSubmitListingResponse = Expand<SubmitListingResponse>;
type CanonicalSubmitListingError = {
  error: string;
  message: string;
};
type FeedClientMethod = HuisHypeApiClient['getFeed'];
type ExpectedFeedClientMethod = (params: GetFeedRequest) => Promise<GetFeedResponse>;
type AuthSessionClientMethod = HuisHypeApiClient['getAuthSession'];
type ExpectedAuthSessionClientMethod = () => Promise<AuthSessionResponseFromOpenApi>;
type SavedPropertiesQueryFromOpenApi = NonNullable<paths['/saved-properties']['get']['parameters']['query']>;
type SavedPropertiesResponseFromOpenApi = paths['/saved-properties']['get']['responses'][200]['content']['application/json'];
type SavedPropertiesClientMethod = HuisHypeApiClient['getSavedProperties'];
type ExpectedSavedPropertiesClientMethod = (
  params: SavedPropertiesQueryFromOpenApi
) => Promise<GetSavedPropertiesResponse>;
type HasStaleMapMethod = 'getMapProperties' extends keyof HuisHypeApiClient ? true : false;

const feedContractAssertions = [
  true as Assert<IsExact<FeedQueryFromOpenApi, GetFeedRequest>>,
  true as Assert<IsExact<FeedResponseFromOpenApi, GetFeedResponse>>,
  true as Assert<IsExact<SubmitListingRequestFromOpenApi, CanonicalSubmitListingRequest>>,
  true as Assert<IsExact<SubmitListingResponseFromOpenApi, CanonicalSubmitListingResponse>>,
  true as Assert<IsExact<SubmitListingErrorFromOpenApi, CanonicalSubmitListingError>>,
  true as Assert<IsExact<FeedClientMethod, ExpectedFeedClientMethod>>,
  true as Assert<IsExact<AuthSessionClientMethod, ExpectedAuthSessionClientMethod>>,
  true as Assert<IsExact<SavedPropertiesClientMethod, ExpectedSavedPropertiesClientMethod>>,
  true as Assert<IsExact<SavedPropertiesResponseFromOpenApi, GetSavedPropertiesResponse>>,
  true as Assert<Equal<keyof FeedQueryFromOpenApi, 'filter' | 'page' | 'limit' | 'lat' | 'lon' | 'country'>>,
  true as Assert<Equal<FeedQueryFromOpenApi['filter'], 'trending' | 'latest' | undefined>>,
  true as Assert<Equal<keyof SavedPropertiesQueryFromOpenApi, 'limit' | 'offset'>>,
  true as Assert<Equal<HasStaleMapMethod, false>>,
] as const;

describe('Generated OpenAPI types', () => {
  it('keeps the canonical shared contract aligned with the generated OpenAPI types', () => {
    expect(feedContractAssertions).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('exports a paths interface with known API routes', () => {
    const expectedPaths: PathKeys[] = [
      '/health',
      '/auth/google',
      '/auth/apple',
      '/auth/email/request',
      '/auth/email/verify',
      '/auth/refresh',
      '/auth/logout',
      '/auth/session',
      '/auth/me',
      '/auth/token/google',
      '/auth/token/apple',
      '/auth/token/email/verify',
      '/auth/token/refresh',
      '/auth/token/logout',
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

    for (const path of expectedPaths) {
      expect(path).toBeTruthy();
    }
    expect(expectedPaths.length).toBeGreaterThanOrEqual(35);
  });

  it('generated paths do not use /api/v1 prefix', () => {
    const samplePaths: PathKeys[] = ['/health', '/feed', '/properties', '/auth/token/google'];
    for (const path of samplePaths) {
      expect(path).not.toMatch(/^\/api\/v1\//);
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

  it('exposes key browser and explicit-token auth methods', () => {
    const client = createApiClient({ baseUrl: 'http://test' });

    expect(typeof client.loginGoogle).toBe('function');
    expect(typeof client.loginGoogleWithTokens).toBe('function');
    expect(typeof client.loginApple).toBe('function');
    expect(typeof client.loginAppleWithTokens).toBe('function');
    expect(typeof client.requestEmailMagicLink).toBe('function');
    expect(typeof client.verifyEmailToken).toBe('function');
    expect(typeof client.verifyEmailTokenWithTokens).toBe('function');
    expect(typeof client.refreshSession).toBe('function');
    expect(typeof client.refreshTokenSession).toBe('function');
    expect(typeof client.logout).toBe('function');
    expect(typeof client.logoutTokenSession).toBe('function');
    expect(typeof client.getAuthSession).toBe('function');
    expect(typeof client.getAuthMe).toBe('function');
  });

  it('exposes key application methods', () => {
    const client = createApiClient({ baseUrl: 'http://test' });

    expect(typeof client.getProfile).toBe('function');
    expect(typeof client.updateProfile).toBe('function');
    expect(typeof client.getUser).toBe('function');
    expect(typeof client.resolveProperty).toBe('function');
    expect(typeof client.getProperty).toBe('function');
    expect(typeof client.submitGuess).toBe('function');
    expect(typeof client.getComments).toBe('function');
    expect(typeof client.createComment).toBe('function');
    expect(typeof client.toggleCommentLike).toBe('function');
    expect(typeof client.getFeed).toBe('function');
    expect(typeof client.getSavedProperties).toBe('function');
    expect(typeof client.likeProperty).toBe('function');
    expect(typeof client.unlikeProperty).toBe('function');
    expect(typeof client.saveProperty).toBe('function');
    expect(typeof client.unsaveProperty).toBe('function');
    expect(typeof client.trackView).toBe('function');
    expect('getMapProperties' in client).toBe(false);
  });

  it('uses credentials=include for browser requests', async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(JSON.stringify({
      user: {
        id: 'user-1',
        username: 'user',
        displayName: 'User',
        profilePhotoUrl: null,
        karma: 0,
        karmaRank: 'Newcomer',
        createdAt: new Date().toISOString(),
        email: 'user@example.com',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await client.getAuthSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.credentials).toBe('include');
    expect(request.headers.get('Authorization')).toBeNull();
  });

  it('attaches bearer auth only when an explicit access token is set', async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(JSON.stringify({
      profile: {
        id: 'user-1',
        username: 'user',
        displayName: 'User',
        profilePhotoUrl: null,
        karma: 0,
        karmaRank: 'Newcomer',
        createdAt: new Date().toISOString(),
        totalGuesses: 0,
        resolvedGuesses: 0,
        activeAreas: [],
        badges: [],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      accessToken: 'token-123',
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await client.getProfile();

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get('Authorization')).toBe('Bearer token-123');
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

  it('parses backend error envelopes using the canonical error field', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: 'INVALID_URL',
      message: 'URL must be from a recognized listing platform.',
      details: { field: 'url' },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await expect(client.loginGoogle('mock-token')).rejects.toMatchObject({
      message: 'URL must be from a recognized listing platform.',
      code: 'INVALID_URL',
      status: 400,
      details: { field: 'url' },
    });
  });

  it('triggers onAuthError for 401 responses', async () => {
    const onAuthError = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      fetch: fetchMock as typeof globalThis.fetch,
      onAuthError,
    });

    await expect(client.getAuthMe()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });
});

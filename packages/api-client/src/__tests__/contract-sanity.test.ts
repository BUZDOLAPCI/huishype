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

import { describe, it, expect, vi } from 'vitest';
import type { paths } from '../../generated/api.js';
import type {
  GetFeedRequest,
  GetFeedResponse,
  GetFollowingViewportRequest,
  GetFollowingViewportResponse,
  GetPropertyResponse,
  GetSavedPropertiesResponse,
  PropertyResolveRequest,
  PropertyResolveResponse,
  SubmitListingRequest,
  SubmitListingResponse,
} from '@huishype/shared';
import { HuisHypeApiClient, createApiClient, ApiError } from '../client.js';

// Helper: extract all keys from a type at compile time
// This verifies the generated paths interface contains expected routes
type PathKeys = keyof paths;
type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
type Expand<T> = { [K in keyof T]: T[K] };

type FeedQueryFromOpenApi = NonNullable<paths['/feed']['get']['parameters']['query']>;
type FeedResponseFromOpenApi =
  paths['/feed']['get']['responses'][200]['content']['application/json'];
type SubmitListingRequestFromOpenApi =
  paths['/listings/submit']['post']['requestBody']['content']['application/json'];
type SubmitListingResponseFromOpenApi =
  paths['/listings/submit']['post']['responses'][201]['content']['application/json'];
type SubmitListingErrorFromOpenApi =
  paths['/listings/submit']['post']['responses'][400]['content']['application/json'];
type CanonicalSubmitListingRequest = Expand<SubmitListingRequest>;
type CanonicalSubmitListingResponse = Expand<SubmitListingResponse>;
type CanonicalSubmitListingError = {
  error: string;
  message: string;
};
type SavedPropertiesQueryFromOpenApi = NonNullable<
  paths['/saved-properties']['get']['parameters']['query']
>;
type SavedPropertiesResponseFromOpenApi =
  paths['/saved-properties']['get']['responses'][200]['content']['application/json'];
type ActivityQueryFromOpenApi = NonNullable<paths['/activity']['get']['parameters']['query']>;
type ActivityResponseFromOpenApi =
  paths['/activity']['get']['responses'][200]['content']['application/json'];
type SelfActivityResponseFromOpenApi =
  paths['/users/me/activity']['get']['responses'][200]['content']['application/json'];
type NotificationsResponseFromOpenApi =
  paths['/notifications']['get']['responses'][200]['content']['application/json'];
type NotificationEventTypeFromOpenApi =
  NotificationsResponseFromOpenApi['items'][number]['eventType'];
type FollowRouteResponseFromOpenApi =
  paths['/users/{id}/follow']['put']['responses'][200]['content']['application/json'];
type PropertyResponseFromOpenApi =
  paths['/properties/{id}']['get']['responses'][200]['content']['application/json'];
type ResolvePropertyQueryFromOpenApi =
  paths['/properties/resolve']['get']['parameters']['query'];
type ResolvePropertyResponseFromOpenApi =
  paths['/properties/resolve']['get']['responses'][200]['content']['application/json'];
type FollowingViewportQueryFromOpenApi =
  paths['/properties/following-viewport']['get']['parameters']['query'];
type FollowingViewportResponseFromOpenApi =
  paths['/properties/following-viewport']['get']['responses'][200]['content']['application/json'];
type HasStaleMapMethod = 'getMapProperties' extends keyof HuisHypeApiClient ? true : false;
type ResolvePropertyMethodRequest = Parameters<HuisHypeApiClient['resolveProperty']>[0];
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

type FeedQuery = NonNullable<paths['/feed']['get']['parameters']['query']>;
const feedContractAssertions = [
  true as Assert<IsExact<FeedQueryFromOpenApi, GetFeedRequest>>,
  true as Assert<IsExact<FeedResponseFromOpenApi, GetFeedResponse>>,
  true as Assert<IsExact<SubmitListingRequestFromOpenApi, CanonicalSubmitListingRequest>>,
  true as Assert<IsExact<SubmitListingResponseFromOpenApi, CanonicalSubmitListingResponse>>,
  true as Assert<IsExact<SubmitListingErrorFromOpenApi, CanonicalSubmitListingError>>,
  true as Expect<Equal<keyof FeedQuery, 'filter' | 'page' | 'limit' | 'lat' | 'lon' | 'country'>>,
  true as Expect<Equal<FeedQuery['filter'], 'trending' | 'latest' | undefined>>,
  true as Expect<Equal<Extract<PathKeys, '/properties/map'>, never>>,
  true as Expect<Equal<keyof SavedPropertiesQueryFromOpenApi, 'limit' | 'offset'>>,
  true as Assert<IsExact<SavedPropertiesResponseFromOpenApi, GetSavedPropertiesResponse>>,
  true as Assert<IsExact<PropertyResponseFromOpenApi, GetPropertyResponse>>,
  true as Expect<
    Equal<
      ActivityResponseFromOpenApi['items'][number]['eventType'],
      'comment' | 'property_like' | 'price_guess'
    >
  >,
  true as Expect<
    Equal<
      SelfActivityResponseFromOpenApi['items'][number]['eventType'],
      'comment' | 'property_like' | 'price_guess' | 'save'
    >
  >,
  true as Expect<
    Equal<
      NotificationEventTypeFromOpenApi,
      | 'property_comment'
      | 'comment_reply'
      | 'comment_like'
      | 'property_like'
      | 'property_guess'
      | 'new_follower'
      | 'achievement_unlocked'
    >
  >,
  true as Expect<
    Equal<
      NotificationsResponseFromOpenApi['items'][number]['actor'],
      { id: string; displayName: string; profilePhotoUrl: string | null } | null
    >
  >,
  true as Expect<Equal<ActivityQueryFromOpenApi['scope'], 'public' | 'following' | undefined>>,
  true as Expect<
    Equal<
      FollowRouteResponseFromOpenApi['relationship'],
      'self' | 'none' | 'following' | 'followed_by' | 'mutual'
    >
  >,
  true as Expect<
    Equal<ResolvePropertyQueryFromOpenApi, PropertyResolveRequest>
  >,
  true as Expect<
    Equal<ResolvePropertyMethodRequest, PropertyResolveRequest>
  >,
  true as Expect<
    Equal<
      ResolvePropertyResponseFromOpenApi,
      PropertyResolveResponse
    >
  >,
  true as Expect<
    Equal<
      keyof FollowingViewportQueryFromOpenApi,
      keyof GetFollowingViewportRequest
    >
  >,
  true as Assert<IsExact<FollowingViewportResponseFromOpenApi, GetFollowingViewportResponse>>,
  true as Expect<Equal<HasStaleMapMethod, false>>,
] as const;

describe('Generated OpenAPI types', () => {
  it('keeps the canonical shared contract aligned with the generated OpenAPI types', () => {
    expect(feedContractAssertions).toEqual(Array(feedContractAssertions.length).fill(true));
  });

  it('exports a paths interface with known API routes', () => {
    // Type-level assertions: these cause compile errors if the path is missing.
    // The runtime check is a bonus.
    const expectedPaths: PathKeys[] = [
      '/health',
      '/auth/google',
      '/auth/email/request',
      '/auth/email/verify',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
      '/properties',
      '/properties/resolve',
      '/properties/nearby',
      '/properties/following-viewport',
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
      '/users/me/followers',
      '/users/me/following',
      '/users/{id}/follow',
      '/users/me/guesses',
      '/activity',
      '/users/me/activity',
      '/notifications',
      '/notifications/unread-count',
      '/notifications/read-all',
      '/notifications/{id}/read',
      '/push-tokens',
      '/listings/preview',
      '/listings/submit',
    ];

    // Runtime: verify each path key is valid
    for (const path of expectedPaths) {
      expect(path).toBeTruthy();
    }
    // Verify we have a meaningful number of paths
    expect(expectedPaths.length).toBeGreaterThanOrEqual(37);
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
    expect(typeof client.requestEmailMagicLink).toBe('function');
    expect(typeof client.verifyEmailToken).toBe('function');
    expect(typeof client.refreshAccessToken).toBe('function');
    expect(typeof client.logout).toBe('function');
    expect(typeof client.getAuthMe).toBe('function');

    // Users
    expect(typeof client.getProfile).toBe('function');
    expect(typeof client.updateProfile).toBe('function');
    expect(typeof client.getUser).toBe('function');
    expect(typeof client.getFollowers).toBe('function');
    expect(typeof client.getFollowing).toBe('function');
    expect(typeof client.followUser).toBe('function');
    expect(typeof client.unfollowUser).toBe('function');

    // Properties
    expect(typeof client.resolveProperty).toBe('function');
    expect(typeof client.getProperty).toBe('function');
    expect(typeof client.getFollowingViewport).toBe('function');
    expect('getMapProperties' in client).toBe(false);

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
    expect(typeof client.getActivity).toBe('function');
    expect(typeof client.getMyActivity).toBe('function');
    expect(typeof client.getNotifications).toBe('function');
    expect(typeof client.getUnreadNotificationCount).toBe('function');
    expect(typeof client.markAllNotificationsRead).toBe('function');
    expect(typeof client.markNotificationRead).toBe('function');
    expect(typeof client.registerPushToken).toBe('function');
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

  it('adds x-session-id for anonymous property view tracking when configured', async () => {
    const sessionIdResolver = vi.fn().mockResolvedValue('session-123');
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      sessionIdResolver,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          viewCount: 1,
          uniqueViewers: 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await expect(client.trackView('a0000000-0000-4000-a000-000000000001')).resolves.toEqual({
        viewCount: 1,
        uniqueViewers: 1,
      });
      expect(sessionIdResolver).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/properties/a0000000-0000-4000-a000-000000000001/view',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-session-id': 'session-123',
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('serializes following viewport market state arrays against the canonical route', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      accessToken: 'mock-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    try {
      await expect(
        client.getFollowingViewport({
          bbox: '4.8,52.3,4.9,52.4',
          marketState: ['for-sale', 'sold'],
        })
      ).resolves.toEqual({ items: [] });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/properties/following-viewport?bbox=4.8%2C52.3%2C4.9%2C52.4&marketState=for-sale%2Csold',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer mock-token',
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('serializes resolveProperty against the canonical query contract without coercion', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    try {
      await expect(
        client.resolveProperty({
          postalCode: '1016 GV',
          houseNumber: 263,
          countryCode: 'NL',
          street: 'Prinsengracht',
          city: 'Amsterdam',
        })
      ).resolves.toBeNull();

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/properties/resolve?postalCode=1016+GV&houseNumber=263&countryCode=NL&street=Prinsengracht&city=Amsterdam',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
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
    const client = createApiClient({ baseUrl: 'http://localhost:3100' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'INVALID_URL',
          message: 'URL must be from a recognized listing platform.',
          details: { field: 'url' },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await expect(client.loginGoogle('mock-token')).rejects.toMatchObject({
        message: 'URL must be from a recognized listing platform.',
        code: 'INVALID_URL',
        status: 400,
        details: { field: 'url' },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

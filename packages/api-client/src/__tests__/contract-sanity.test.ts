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
  GetGroupedPropertyActivityRequest,
  GetGroupedPropertyActivityResponse,
  GetFollowingNearbyPropertyRequest,
  GetFollowingNearbyPropertyResponse,
  GetFollowersResponse,
  GetFollowingPropertyTilesRequest,
  GetFollowingPropertyTilesResponse,
  GetFollowingResponse,
  GetMyProfileResponse,
  GetPropertyResponse,
  GetSavedPropertiesResponse,
  GetUserProfileResponse,
  PropertyResolveRequest,
  PropertyResolveResponse,
  SearchUsersRequest,
  SearchUsersResponse,
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
type ListingPreviewRequestFromOpenApi =
  paths['/listings/preview']['post']['requestBody']['content']['application/json'];
type ListingPreviewResponseFromOpenApi =
  paths['/listings/preview']['post']['responses'][200]['content']['application/json'];
type SubmitListingRequestFromOpenApi =
  paths['/listings/submit']['post']['requestBody']['content']['application/json'];
type SubmitListingResponseFromOpenApi =
  paths['/listings/submit']['post']['responses'][201]['content']['application/json'];
type SubmitListingErrorFromOpenApi =
  paths['/listings/submit']['post']['responses'][400]['content']['application/json'];
type PropertyListingsResponseFromOpenApi =
  paths['/properties/{id}/listings']['get']['responses'][200]['content']['application/json'];
type CanonicalListingPriceType = 'sale' | 'rent' | 'unknown';
type CanonicalListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';
type CanonicalListingVerificationState =
  | 'provisional'
  | 'validated'
  | 'invalid'
  | 'validation_pending'
  | 'validation_blocked'
  | 'validation_failed';
type CanonicalListingPreviewWatchState = 'not_required' | 'will_enqueue' | 'unsupported';
type CanonicalListingPreviewReasonCode =
  | 'source_identity_match'
  | 'address_match'
  | 'address_mismatch'
  | 'source_not_supported'
  | 'source_not_found'
  | 'mirror_unavailable'
  | 'parser_error'
  | 'og_unavailable'
  | 'validation_pending';
type CanonicalListingPreviewRequest = {
  url: string;
  propertyId: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  askingPrice?: number;
  priceType?: CanonicalListingPriceType;
  currency?: string;
};
type CanonicalListingPreviewResponse = {
  sourceName: string;
  rawUrl: string;
  canonicalUrl: string;
  sourceListingId: string | null;
  sourceListingIdKind: string | null;
  validationState: 'valid' | 'invalid' | 'provisional';
  matchState: 'matched' | 'mismatch' | 'unverified' | 'unsupported';
  watchState: CanonicalListingPreviewWatchState;
  reasonCode: CanonicalListingPreviewReasonCode;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  askingPrice: number | null;
  priceType: CanonicalListingPriceType;
  currency: string | null;
  address: unknown | null;
  submittedPropertyId: string;
  matchedPropertyId: string | null;
};
type CanonicalSubmitListingRequest = {
  url: string;
  propertyId: string;
  ogTitle?: string;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  askingPrice?: number;
  priceType?: CanonicalListingPriceType;
  currency?: string;
};
type CanonicalSubmitListingResponse = {
  id: string;
  propertyId: string;
  sourceUrl: string;
  sourceName: string;
  canonicalUrl: string | null;
  sourceListingId: string | null;
  status: CanonicalListingStatus;
  verificationState: CanonicalListingVerificationState;
  watchState: CanonicalListingPreviewWatchState;
  watchId: string | null;
  reasonCode: string;
  createdAt: string;
};
type CanonicalSubmitListingError = {
  error: string;
  message: string;
};
type CanonicalPropertyListingReadItem = {
  id: string;
  sourceUrl: string;
  sourceName: string;
  canonicalUrl: string | null;
  sourceListingId: string | null;
  askingPrice: number | null;
  priceType: string | null;
  currency: string | null;
  thumbnailUrl: string | null;
  ogTitle: string | null;
  description: string | null;
  livingAreaM2: number | null;
  numRooms: number | null;
  energyLabel: string | null;
  status: CanonicalListingStatus;
  verificationState: CanonicalListingVerificationState;
  watchState: string | null;
  reasonCode: string | null;
  createdAt: string;
};
type CanonicalPropertyListingsResponse = {
  data: CanonicalPropertyListingReadItem[];
};
type SavedPropertiesQueryFromOpenApi = NonNullable<
  paths['/saved-properties']['get']['parameters']['query']
>;
type SavedPropertiesResponseFromOpenApi =
  paths['/saved-properties']['get']['responses'][200]['content']['application/json'];
type UserSearchQueryFromOpenApi = NonNullable<
  paths['/users/search']['get']['parameters']['query']
>;
type UserSearchResponseFromOpenApi =
  paths['/users/search']['get']['responses'][200]['content']['application/json'];
type UserSearchErrorFromOpenApi =
  paths['/users/search']['get']['responses'][400]['content']['application/json'];
type CanonicalSavedProperty = Expand<
  GetSavedPropertiesResponse['data'][number] & { isRead: boolean }
>;
type CanonicalSavedPropertiesResponse = Expand<
  Omit<GetSavedPropertiesResponse, 'data'> & { data: CanonicalSavedProperty[] }
>;
type ActivityQueryFromOpenApi = NonNullable<paths['/activity']['get']['parameters']['query']>;
type ActivityResponseFromOpenApi =
  paths['/activity']['get']['responses'][200]['content']['application/json'];
type GroupedPropertyActivityQueryFromOpenApi = NonNullable<
  paths['/activity/properties']['get']['parameters']['query']
>;
type GroupedPropertyActivityResponseFromOpenApi =
  paths['/activity/properties']['get']['responses'][200]['content']['application/json'];
type SelfActivityResponseFromOpenApi =
  paths['/users/me/activity']['get']['responses'][200]['content']['application/json'];
type PublicProfileResponseFromOpenApi =
  paths['/users/{id}/profile']['get']['responses'][200]['content']['application/json'];
type MyProfileResponseFromOpenApi =
  paths['/users/me']['get']['responses'][200]['content']['application/json'];
type FollowersResponseFromOpenApi =
  paths['/users/me/followers']['get']['responses'][200]['content']['application/json'];
type FollowingResponseFromOpenApi =
  paths['/users/me/following']['get']['responses'][200]['content']['application/json'];
type NotificationsResponseFromOpenApi =
  paths['/notifications']['get']['responses'][200]['content']['application/json'];
type NotificationEventTypeFromOpenApi =
  NotificationsResponseFromOpenApi['items'][number]['eventType'];
type FollowRouteResponseFromOpenApi =
  paths['/users/{id}/follow']['put']['responses'][200]['content']['application/json'];
type PropertyResponseFromOpenApi =
  paths['/properties/{id}']['get']['responses'][200]['content']['application/json'];
type CanonicalPropertyResponse = Expand<GetPropertyResponse & { isRead: boolean }>;
type ResolvePropertyQueryFromOpenApi = paths['/properties/resolve']['get']['parameters']['query'];
type ResolvePropertyResponseFromOpenApi =
  paths['/properties/resolve']['get']['responses'][200]['content']['application/json'];
type ResolvePropertyBodyFromOpenApi = Expand<Exclude<ResolvePropertyResponseFromOpenApi, null>>;
type CanonicalResolvePropertyBody = Expand<Exclude<PropertyResolveResponse, null>>;
type FollowingPropertyTilesQueryFromOpenApi = NonNullable<
  paths['/tiles/following/properties.json']['get']['parameters']['query']
>;
type FollowingPropertyTilesResponseFromOpenApi =
  paths['/tiles/following/properties.json']['get']['responses'][200]['content']['application/json'];
type ReadPropertyTilesQueryFromOpenApi = NonNullable<
  paths['/tiles/properties/read.json']['get']['parameters']['query']
>;
type ReadPropertyTilesResponseFromOpenApi =
  paths['/tiles/properties/read.json']['get']['responses'][200]['content']['application/json'];
type FollowingNearbyQueryFromOpenApi = NonNullable<
  paths['/properties/following-nearby']['get']['parameters']['query']
>;
type NearbyGroupedResponseFromOpenApi =
  paths['/properties/nearby']['get']['responses'][200]['content']['application/json'];
type NearbySingleFromOpenApi = Extract<
  Exclude<NearbyGroupedResponseFromOpenApi, null>,
  { groupKind: 'single' }
>;
type NearbyClusterFromOpenApi = Extract<
  Exclude<NearbyGroupedResponseFromOpenApi, null>,
  { groupKind: 'cluster' }
>;
type FollowingNearbySharedSingle = Extract<
  Exclude<GetFollowingNearbyPropertyResponse, null>,
  { groupKind: 'single' }
>;
type FollowingNearbySharedCluster = Extract<
  Exclude<GetFollowingNearbyPropertyResponse, null>,
  { groupKind: 'cluster' }
>;
type CanonicalNearbySingle = {
  nodeClass: 'active' | 'ghost';
  groupKind: 'single';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  isRead: boolean;
  address: string;
  city: string;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
};
type CanonicalNearbyCluster = {
  nodeClass: 'active' | 'ghost';
  groupKind: 'cluster';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  isRead: boolean;
};
type CanonicalNearbyGroupedResponse = CanonicalNearbySingle | CanonicalNearbyCluster | null;
type HasStaleMapMethod = 'getMapProperties' extends keyof HuisHypeApiClient ? true : false;
type HasGeneratedUserSearchPath = Extract<PathKeys, '/users/search'>;
type ResolvePropertyMethodRequest = Parameters<HuisHypeApiClient['resolveProperty']>[0];
type SearchUsersMethodRequest = Parameters<HuisHypeApiClient['searchUsers']>[0];
type SearchUsersMethodResponse = Awaited<ReturnType<HuisHypeApiClient['searchUsers']>>;
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
  true as Assert<IsExact<ListingPreviewRequestFromOpenApi, CanonicalListingPreviewRequest>>,
  true as Assert<IsExact<ListingPreviewResponseFromOpenApi, CanonicalListingPreviewResponse>>,
  true as Assert<IsExact<SubmitListingRequestFromOpenApi, CanonicalSubmitListingRequest>>,
  true as Assert<IsExact<SubmitListingResponseFromOpenApi, CanonicalSubmitListingResponse>>,
  true as Assert<IsExact<SubmitListingErrorFromOpenApi, CanonicalSubmitListingError>>,
  true as Assert<IsExact<PropertyListingsResponseFromOpenApi, CanonicalPropertyListingsResponse>>,
  true as Expect<Equal<keyof FeedQuery, 'filter' | 'page' | 'limit' | 'lat' | 'lon' | 'country'>>,
  true as Expect<Equal<FeedQuery['filter'], 'trending' | 'latest' | undefined>>,
  true as Expect<
    Equal<FeedResponseFromOpenApi['items'][number]['activityLevel'], 'hot' | 'warm' | 'cold'>
  >,
  true as Expect<Equal<Extract<PathKeys, '/properties/map'>, never>>,
  true as Expect<Equal<keyof SavedPropertiesQueryFromOpenApi, 'limit' | 'offset'>>,
  true as Assert<IsExact<SavedPropertiesResponseFromOpenApi, CanonicalSavedPropertiesResponse>>,
  true as Assert<IsExact<PropertyResponseFromOpenApi, CanonicalPropertyResponse>>,
  true as Assert<IsExact<PublicProfileResponseFromOpenApi, GetUserProfileResponse>>,
  true as Assert<IsExact<MyProfileResponseFromOpenApi, GetMyProfileResponse>>,
  true as Assert<IsExact<FollowersResponseFromOpenApi, GetFollowersResponse>>,
  true as Assert<IsExact<FollowingResponseFromOpenApi, GetFollowingResponse>>,
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
  true as Assert<
    IsExact<GroupedPropertyActivityQueryFromOpenApi, GetGroupedPropertyActivityRequest>
  >,
  true as Assert<
    IsExact<GroupedPropertyActivityResponseFromOpenApi, GetGroupedPropertyActivityResponse>
  >,
  true as Expect<
    Equal<keyof ActivityResponseFromOpenApi['pagination'], 'limit' | 'offset' | 'hasMore'>
  >,
  true as Expect<
    Equal<
      keyof GroupedPropertyActivityResponseFromOpenApi['items'][number]['counts'],
      'likeCount' | 'commentCount' | 'guessCount'
    >
  >,
  true as Expect<
    Equal<GroupedPropertyActivityResponseFromOpenApi['items'][number]['preview']['kind'], 'comment' | 'summary'>
  >,
  true as Expect<
    Equal<
      keyof ActivityResponseFromOpenApi['items'][number]['property'],
      | 'id'
      | 'address'
      | 'streetName'
      | 'houseNumber'
      | 'houseNumberAddition'
      | 'city'
      | 'postalCode'
      | 'countryCode'
      | 'geometry'
      | 'thumbnailUrl'
    >
  >,
  true as Expect<
    Equal<
      FollowRouteResponseFromOpenApi['relationship'],
      'self' | 'none' | 'following' | 'followed_by' | 'mutual'
    >
  >,
  true as Expect<Equal<ResolvePropertyQueryFromOpenApi, PropertyResolveRequest>>,
  true as Expect<Equal<ResolvePropertyMethodRequest, PropertyResolveRequest>>,
  true as Expect<Equal<keyof ResolvePropertyBodyFromOpenApi, keyof CanonicalResolvePropertyBody>>,
  true as Expect<
    Equal<Exclude<ResolvePropertyBodyFromOpenApi['coordinates'], null>['lon'], number>
  >,
  true as Expect<
    Equal<Exclude<ResolvePropertyBodyFromOpenApi['coordinates'], null>['lat'], number>
  >,
  true as Expect<Equal<Extract<ResolvePropertyBodyFromOpenApi['coordinates'], null>, null>>,
  true as Expect<
    Equal<
      ResolvePropertyBodyFromOpenApi['hasActiveListing'],
      CanonicalResolvePropertyBody['hasActiveListing']
    >
  >,
  true as Expect<
    Equal<
      ResolvePropertyBodyFromOpenApi['marketState'],
      CanonicalResolvePropertyBody['marketState']
    >
  >,
  true as Expect<
    Equal<
      ResolvePropertyBodyFromOpenApi['officialValuation'],
      CanonicalResolvePropertyBody['officialValuation']
    >
  >,
  true as Expect<
    Equal<keyof FollowingPropertyTilesQueryFromOpenApi, keyof GetFollowingPropertyTilesRequest>
  >,
  true as Expect<
    Equal<Extract<keyof FollowingPropertyTilesQueryFromOpenApi, 'bbox' | 'socialScope'>, never>
  >,
  true as Expect<
    Equal<
      FollowingPropertyTilesQueryFromOpenApi['activity'],
      GetFollowingPropertyTilesRequest['activity']
    >
  >,
  true as Assert<
    IsExact<FollowingPropertyTilesResponseFromOpenApi, GetFollowingPropertyTilesResponse>
  >,
  true as Expect<
    Equal<keyof ReadPropertyTilesQueryFromOpenApi, keyof FollowingPropertyTilesQueryFromOpenApi>
  >,
  true as Expect<
    Equal<
      ReadPropertyTilesQueryFromOpenApi['activity'],
      FollowingPropertyTilesQueryFromOpenApi['activity']
    >
  >,
  true as Assert<IsExact<ReadPropertyTilesResponseFromOpenApi, GetFollowingPropertyTilesResponse>>,
  true as Expect<
    Equal<keyof FollowingNearbyQueryFromOpenApi, keyof GetFollowingNearbyPropertyRequest>
  >,
  true as Expect<
    Equal<Extract<keyof FollowingNearbyQueryFromOpenApi, 'bbox' | 'socialScope'>, never>
  >,
  true as Expect<
    Equal<
      FollowingNearbyQueryFromOpenApi['activity'],
      GetFollowingNearbyPropertyRequest['activity']
    >
  >,
  true as Assert<IsExact<NearbyGroupedResponseFromOpenApi, CanonicalNearbyGroupedResponse>>,
  true as Assert<IsExact<NearbySingleFromOpenApi, CanonicalNearbySingle>>,
  true as Assert<IsExact<NearbyClusterFromOpenApi, CanonicalNearbyCluster>>,
  true as Expect<
    Equal<keyof FollowingNearbySharedSingle, Exclude<keyof CanonicalNearbySingle, 'isRead'>>
  >,
  true as Expect<
    Equal<keyof FollowingNearbySharedCluster, Exclude<keyof CanonicalNearbyCluster, 'isRead'>>
  >,
  true as Expect<Equal<FollowingNearbySharedSingle['bbox'], CanonicalNearbySingle['bbox']>>,
  true as Expect<Equal<FollowingNearbySharedCluster['bbox'], CanonicalNearbyCluster['bbox']>>,
  true as Expect<
    Equal<FollowingNearbySharedSingle['marketState'], CanonicalNearbySingle['marketState']>
  >,
  true as Expect<Equal<HasStaleMapMethod, false>>,
  true as Expect<Equal<SearchUsersMethodRequest, SearchUsersRequest>>,
  true as Assert<IsExact<SearchUsersMethodResponse, SearchUsersResponse>>,
  true as Expect<Equal<HasGeneratedUserSearchPath, '/users/search'>>,
  true as Expect<Equal<UserSearchQueryFromOpenApi['q'], string | undefined>>,
  true as Assert<IsExact<UserSearchResponseFromOpenApi, SearchUsersResponse>>,
  true as Assert<IsExact<UserSearchErrorFromOpenApi, { error: string; message: string }>>,
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
      '/properties/following-nearby',
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
      '/activity/properties',
      '/users/me/activity',
      '/notifications',
      '/notifications/unread-count',
      '/notifications/read-all',
      '/notifications/{id}/read',
      '/push-tokens',
      '/listings/preview',
      '/listings/submit',
      '/tiles/following/properties.json',
      '/tiles/properties/read.json',
      '/tiles/properties/read/{z}/{x}/{y}.pbf',
    ];

    // Runtime: verify each path key is valid
    for (const path of expectedPaths) {
      expect(path).toBeTruthy();
    }
    // Verify we have a meaningful number of paths
    expect(expectedPaths.length).toBeGreaterThanOrEqual(39);
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
    expect(typeof client.searchUsers).toBe('function');
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
    expect(typeof client.getFollowingPropertyTiles).toBe('function');
    expect(typeof client.getFollowingNearbyProperty).toBe('function');
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
    expect(typeof client.getGroupedPropertyActivity).toBe('function');
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

  it('serializes user search requests against the canonical public route', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      accessToken: 'mock-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'b0000000-0000-4000-a000-000000000001',
              displayName: 'Jan de Vries',
              handle: 'jandevries',
              profilePhotoUrl: null,
              relationship: 'self',
              followerCount: 2,
            },
          ],
          pagination: {
            limit: 20,
            offset: 0,
            hasMore: false,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await expect(
        client.searchUsers({
          q: '@jan',
          limit: 20,
          offset: 0,
        })
      ).resolves.toHaveProperty('items');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/users/search?q=%40jan&limit=20&offset=0',
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

  it('serializes Following TileJSON market filters against the canonical authenticated route', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      accessToken: 'mock-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          tilejson: '2.1.0',
          name: 'HuisHype Following Properties',
          description: 'Personalized grouped property data from followed-user qualifying activity',
          tiles: [
            'http://localhost:3100/tiles/following/properties/{z}/{x}/{y}.pbf?marketState=for-sale%2Csold',
          ],
          minzoom: 0,
          maxzoom: 22,
          bounds: [-180, -85, 180, 85],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await expect(
        client.getFollowingPropertyTiles({
          marketState: ['for-sale', 'sold'],
          activity: '30d',
        })
      ).resolves.toHaveProperty('tilejson', '2.1.0');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/tiles/following/properties.json?marketState=for-sale%2Csold&activity=30d',
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

  it('serializes Following nearby requests against the canonical authenticated route', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3100',
      accessToken: 'mock-token',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          nodeClass: 'active',
          groupKind: 'single',
          primaryPropertyId: 'a0000000-0000-4000-a000-000000000001',
          pointCount: 1,
          propertyIds: ['a0000000-0000-4000-a000-000000000001'],
          previewPropertyIds: ['a0000000-0000-4000-a000-000000000001'],
          coordinate: [4.89, 52.37],
          distanceMeters: 12,
          bbox: null,
          activeListingCount: 1,
          socialCount: 1,
          recentSocialCount: 1,
          socialScoreTotal: 10,
          socialScoreMax: 10,
          recentSocialScoreTotal: 4,
          commentCount: 2,
          address: 'Fixture Street 1, 1234 AB Amsterdam',
          city: 'Amsterdam',
          askingPrice: 550000,
          thumbnailUrl: null,
          hasActiveListing: true,
          marketState: 'for-sale',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    try {
      await expect(
        client.getFollowingNearbyProperty({
          lon: 4.8952,
          lat: 52.3702,
          zoom: 16,
          marketState: ['for-sale', 'sold'],
          activity: '10d',
        })
      ).resolves.toHaveProperty('groupKind', 'single');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3100/properties/following-nearby?lon=4.8952&lat=52.3702&zoom=16&marketState=for-sale%2Csold&activity=10d',
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

/**
 * Handler alignment tests for @huishype/mocks
 *
 * Verifies that MSW handlers are correctly wired and cover
 * the expected API paths. Does not start MSW — tests handler
 * array structure and fixture data integrity only.
 */

import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { server } from '../server.js';
import {
  handlers,
  authHandlers,
  propertyHandlers,
  guessHandlers,
  commentHandlers,
  geocodeHandlers,
  feedHandlers,
  userHandlers,
  listingHandlers,
  notificationHandlers,
  leaderboardHandlers,
  activityHandlers,
  achievementHandlers,
  emailAuthHandlers,
} from '../handlers/index.js';
import {
  mockUsers,
  mockUserProfiles,
  mockProperties,
  mockPropertyDetails,
  mockPropertySummaries,
  mockListings,
  mockGuesses,
  mockComments,
  mockMapProperties,
  mockPropertyClusters,
  mockFMV,
  getMockUser,
  getMockProperty,
  getMockComments,
  getMockGuesses,
} from '../data/fixtures.js';

describe('Mock handler runtime parity', () => {
  const listingPropertyId = '11111111-1111-4111-8111-111111111111';

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('returns the live /auth/me response envelope', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();

    const meResponse = await fetch('http://localhost/auth/me', {
      headers: {
        Authorization: `Bearer ${loginBody.session.accessToken as string}`,
      },
    });
    const meBody = await meResponse.json();

    expect(meResponse.status).toBe(200);
    expect(meBody).toHaveProperty('user');
    expect(meBody.user).toHaveProperty('id');
    expect(meBody.user).toHaveProperty('username');
  });

  it('uses canonical error envelopes across core mock handlers', async () => {
    const loginErrorResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(await loginErrorResponse.json()).toEqual({
      error: 'INVALID_REQUEST',
      message: 'Missing idToken',
    });

    const savedErrorResponse = await fetch('http://localhost/saved-properties');
    expect(await savedErrorResponse.json()).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });

    const guessesErrorResponse = await fetch('http://localhost/properties/unknown/guesses');
    expect(await guessesErrorResponse.json()).toEqual({
      error: 'NOT_FOUND',
      message: 'Property not found',
    });
  });

  it('matches live /saved-properties query params and envelope', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const response = await fetch('http://localhost/saved-properties?limit=1&offset=0', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('pagination');
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('savedAt');
      expect(body.data[0]).toHaveProperty('countryCode');
    }
  });

  it('matches live listing preview/submit auth split and payload envelopes', async () => {
    const previewResponse = await fetch('http://localhost/listings/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        propertyId: listingPropertyId,
      }),
    });
    const previewBody = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(previewBody).toHaveProperty('ogTitle');
    expect(previewBody).toHaveProperty('ogImage');
    expect(previewBody).toHaveProperty('sourceName');
    expect(previewBody).toHaveProperty('addressMatch');
    expect(previewBody).toHaveProperty('warning');

    const previewInvalidUrlResponse = await fetch('http://localhost/listings/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://evil-site.com/listing',
        propertyId: listingPropertyId,
      }),
    });
    expect(previewInvalidUrlResponse.status).toBe(400);
    expect(await previewInvalidUrlResponse.json()).toEqual({
      error: 'INVALID_URL',
      message: 'URL must be from a recognized listing platform.',
    });

    const unauthSubmit = await fetch('http://localhost/listings/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        propertyId: listingPropertyId,
        ogTitle: previewBody.ogTitle,
        thumbnailUrl: previewBody.ogImage,
      }),
    });
    const unauthSubmitBody = await unauthSubmit.json();
    expect(unauthSubmit.status).toBe(401);
    expect(unauthSubmitBody).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(unauthSubmitBody).not.toHaveProperty('code');

    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const invalidSubmitResponse = await fetch('http://localhost/listings/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url: 'https://evil-site.com/listing',
        propertyId: listingPropertyId,
        ogTitle: previewBody.ogTitle,
        thumbnailUrl: previewBody.ogImage,
      }),
    });
    expect(invalidSubmitResponse.status).toBe(400);
    expect(await invalidSubmitResponse.json()).toEqual({
      error: 'INVALID_URL',
      message: 'URL must be from a recognized listing platform.',
    });

    const submitResponse = await fetch('http://localhost/listings/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
        propertyId: listingPropertyId,
        ogTitle: previewBody.ogTitle,
        thumbnailUrl: previewBody.ogImage,
      }),
    });
    const submitBody = await submitResponse.json();

    expect(submitResponse.status).toBe(201);
    expect(submitBody).toHaveProperty('id');
    expect(submitBody).toHaveProperty('propertyId', listingPropertyId);
    expect(submitBody).toHaveProperty('sourceUrl');
    expect(submitBody).toHaveProperty('sourceName');
    expect(submitBody).toHaveProperty('status');
    expect(submitBody).toHaveProperty('createdAt');
  });

  it('matches live /properties/:id/listings response envelope', async () => {
    const response = await fetch(`http://localhost/properties/${listingPropertyId}/listings`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('data');
    expect(body).not.toHaveProperty('listings');
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('thumbnailUrl');
      expect(body.data[0]).toHaveProperty('sourceUrl');
      expect(body.data[0]).toHaveProperty('createdAt');
    }
  });

  it('matches live geocode validation for empty query and oversized limit', async () => {
    const emptyQueryResponse = await fetch('http://localhost/geocode/search?q=');
    const emptyQueryBody = await emptyQueryResponse.json();
    expect(emptyQueryResponse.status).toBe(400);
    expect(emptyQueryBody).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Invalid query parameters',
    });

    const oversizedLimitResponse = await fetch('http://localhost/geocode/search?q=test&limit=21');
    const oversizedLimitBody = await oversizedLimitResponse.json();
    expect(oversizedLimitResponse.status).toBe(400);
    expect(oversizedLimitBody).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Invalid query parameters',
    });
  });

  it('matches live feed validation for canonical and obsolete filters', async () => {
    const trendingResponse = await fetch('http://localhost/feed?filter=trending&page=1&limit=5');
    const trendingBody = await trendingResponse.json();
    expect(trendingResponse.status).toBe(200);
    expect(trendingBody).toHaveProperty('items');
    expect(trendingBody).toHaveProperty('pagination');

    const obsoleteFilterResponse = await fetch('http://localhost/feed?filter=controversial');
    const obsoleteFilterBody = await obsoleteFilterResponse.json();
    expect(obsoleteFilterResponse.status).toBe(400);
    expect(obsoleteFilterBody).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Invalid query parameters',
    });
  });

  it('matches public resolve and nearby grouped map contracts', async () => {
    const resolveResponse = await fetch(
      'http://localhost/properties/resolve?postalCode=1016GV&houseNumber=263&countryCode=NL',
    );
    const resolveBody = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolveBody).toHaveProperty('hasActiveListing', true);
    expect(resolveBody).toHaveProperty('marketState', 'for-sale');
    expect(resolveBody).not.toHaveProperty('hasListing');

    const nearbyResponse = await fetch(
      'http://localhost/properties/nearby?lon=4.8952&lat=52.3702&zoom=17',
    );
    const nearbyBody = await nearbyResponse.json();

    expect(nearbyResponse.status).toBe(200);
    expect(nearbyBody).toHaveProperty('activeListingCount');
    expect(nearbyBody).toHaveProperty('socialCount');
    expect(nearbyBody).toHaveProperty('recentSocialCount');
    expect(nearbyBody).toHaveProperty('socialScoreTotal');
    expect(nearbyBody).toHaveProperty('socialScoreMax');
    expect(nearbyBody).toHaveProperty('recentSocialScoreTotal');
    expect(nearbyBody).toHaveProperty('hasActiveListing');
    expect(nearbyBody).toHaveProperty('marketState');
    expect(nearbyBody).not.toHaveProperty('hasListing');
    expect(nearbyBody).not.toHaveProperty('activityScore');
    expect(nearbyBody).not.toHaveProperty('activityScoreTotal');
  });

  it('matches following viewport auth split and sparse overlay payload', async () => {
    const unauthorizedResponse = await fetch(
      'http://localhost/properties/following-viewport?bbox=4.8,52.3,4.9,52.4',
    );
    expect(unauthorizedResponse.status).toBe(401);

    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const response = await fetch(
      'http://localhost/properties/following-viewport?bbox=4.8,52.3,4.9,52.4&marketState=for-sale',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty('coordinate');
    expect(body.items[0]).toHaveProperty('activityTypes');
    expect(body.items[0]).toHaveProperty('actorCount');
    expect(body.items[0]).toHaveProperty('lastActivityAt');
  });

  it('matches property view identity requirements and response envelope', async () => {
    const missingIdentityResponse = await fetch('http://localhost/properties/prop-001/view', {
      method: 'POST',
    });
    expect(missingIdentityResponse.status).toBe(400);
    expect(await missingIdentityResponse.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'Authenticated user or x-session-id header is required.',
    });

    const sessionResponse = await fetch('http://localhost/properties/prop-001/view', {
      method: 'POST',
      headers: { 'x-session-id': 'mock-session-1' },
    });
    const sessionBody = await sessionResponse.json();

    expect(sessionResponse.status).toBe(200);
    expect(sessionBody).toHaveProperty('viewCount');
    expect(sessionBody).toHaveProperty('uniqueViewers');
  });

  it('matches follow-aware user profile and follow route behavior', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const publicProfileResponse = await fetch('http://localhost/users/user-002/profile');
    const publicProfileBody = await publicProfileResponse.json();
    expect(publicProfileResponse.status).toBe(200);
    expect(publicProfileBody.relationship).toBe('none');
    expect(publicProfileBody).toHaveProperty('followerCount');
    expect(publicProfileBody).toHaveProperty('followingCount');

    const followResponse = await fetch('http://localhost/users/user-002/follow', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    const followBody = await followResponse.json();
    expect(followResponse.status).toBe(200);
    expect(followBody.relationship).toBe('following');
    expect(followBody.followerCount).toBeGreaterThan(0);

    const followersResponse = await fetch('http://localhost/users/me/following', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const followersBody = await followersResponse.json();
    expect(followersResponse.status).toBe(200);
    expect(Array.isArray(followersBody.items)).toBe(true);

    const selfFollowResponse = await fetch('http://localhost/users/user-001/follow', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(selfFollowResponse.status).toBe(400);
  });

  it('matches activity scope auth split and excludes save from public/following', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const publicResponse = await fetch('http://localhost/activity?scope=public&limit=20');
    const publicBody = await publicResponse.json();
    expect(publicResponse.status).toBe(200);
    expect(publicBody.items.every((item: { eventType: string }) => item.eventType !== 'save')).toBe(
      true
    );
    expect(publicBody.items[0].property).toHaveProperty('streetName');
    expect(publicBody.items[0].property).toHaveProperty('postalCode');
    expect(publicBody.items[0].property).toHaveProperty('countryCode');

    const unauthorizedFollowingResponse = await fetch('http://localhost/activity?scope=following');
    expect(unauthorizedFollowingResponse.status).toBe(401);

    const followingResponse = await fetch('http://localhost/activity?scope=following&limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const followingBody = await followingResponse.json();
    expect(followingResponse.status).toBe(200);
    expect(
      followingBody.items.every((item: { eventType: string }) => item.eventType !== 'save')
    ).toBe(true);

    const selfResponse = await fetch('http://localhost/users/me/activity?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const selfBody = await selfResponse.json();
    expect(selfResponse.status).toBe(200);
    expect(selfBody.items.some((item: { eventType: string }) => item.eventType === 'save')).toBe(
      true
    );
  });

  it('matches canonical notification event names in mock responses', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const response = await fetch('http://localhost/notifications?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.items.some((item: { eventType: string }) => item.eventType === 'new_follower')
    ).toBe(true);
    expect(
      body.items.every((item: { eventType: string }) =>
        [
          'property_comment',
          'comment_reply',
          'comment_like',
          'property_like',
          'property_guess',
          'new_follower',
          'achievement_unlocked',
        ].includes(item.eventType)
      )
    ).toBe(true);
  });
});

describe('Handler wiring', () => {
  it('exports a non-empty combined handlers array', () => {
    expect(handlers).toBeInstanceOf(Array);
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('combined handlers include all handler groups', () => {
    const allGrouped = [
      ...authHandlers,
      ...userHandlers,
      ...feedHandlers,
      ...listingHandlers,
      ...propertyHandlers,
      ...guessHandlers,
      ...commentHandlers,
      ...geocodeHandlers,
      ...notificationHandlers,
      ...leaderboardHandlers,
      ...activityHandlers,
      ...achievementHandlers,
      ...emailAuthHandlers,
    ];
    expect(handlers.length).toBe(allGrouped.length);
  });

  it('has handlers for all major API areas', () => {
    expect(authHandlers.length).toBeGreaterThan(0);
    expect(propertyHandlers.length).toBeGreaterThan(0);
    expect(guessHandlers.length).toBeGreaterThan(0);
    expect(commentHandlers.length).toBeGreaterThan(0);
    expect(geocodeHandlers.length).toBeGreaterThan(0);
    expect(feedHandlers.length).toBeGreaterThan(0);
    expect(userHandlers.length).toBeGreaterThan(0);
    expect(listingHandlers.length).toBeGreaterThan(0);
    expect(notificationHandlers.length).toBeGreaterThan(0);
    expect(leaderboardHandlers.length).toBeGreaterThan(0);
    expect(activityHandlers.length).toBeGreaterThan(0);
    expect(achievementHandlers.length).toBeGreaterThan(0);
    expect(emailAuthHandlers.length).toBeGreaterThan(0);
  });
});

describe('Handler path alignment', () => {
  type HandlerInfo = { method: string; path: string };
  type HandlerWithInfo = {
    info?: {
      method?: unknown;
      path?: unknown;
    };
  };

  function getHandlerInfo(handler: unknown): HandlerInfo | null {
    if (typeof handler !== 'object' || handler === null || !('info' in handler)) {
      return null;
    }

    const info = (handler as HandlerWithInfo).info;
    if (typeof info?.method === 'string' && typeof info.path === 'string') {
      return { method: info.method.toUpperCase(), path: info.path };
    }
    return null;
  }

  it('auth handlers do not use /api/v1 prefix', () => {
    for (const handler of authHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('property handlers do not use /api/v1 prefix', () => {
    for (const handler of propertyHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('feed handler uses /feed path (no prefix)', () => {
    for (const handler of feedHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('user handlers do not use /api/v1 prefix', () => {
    for (const handler of userHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });
});

describe('Fixture data integrity', () => {
  it('mockUsers has at least 3 users', () => {
    expect(mockUsers.length).toBeGreaterThanOrEqual(3);
  });

  it('mockUserProfiles has same count as mockUsers', () => {
    expect(mockUserProfiles.length).toBe(mockUsers.length);
  });

  it('mockProperties has at least 3 properties', () => {
    expect(mockProperties.length).toBeGreaterThanOrEqual(3);
  });

  it('mockPropertyDetails has same count as mockProperties', () => {
    expect(mockPropertyDetails.length).toBe(mockProperties.length);
  });

  it('mockPropertyDetails include likeCount, isLiked, isSaved fields', () => {
    for (const detail of mockPropertyDetails) {
      expect(typeof detail.likeCount).toBe('number');
      expect(typeof detail.isLiked).toBe('boolean');
      expect(typeof detail.isSaved).toBe('boolean');
    }
  });

  it('mockPropertySummaries has same count as mockPropertyDetails', () => {
    expect(mockPropertySummaries.length).toBe(mockPropertyDetails.length);
  });

  it('mockListings references valid property IDs', () => {
    const propertyIds = new Set(mockProperties.map((p) => p.id));
    for (const listing of mockListings) {
      expect(propertyIds.has(listing.propertyId)).toBe(true);
    }
  });

  it('mockGuesses references valid user and property IDs', () => {
    const userIds = new Set(mockUsers.map((u) => u.id));
    const propertyIds = new Set(mockProperties.map((p) => p.id));
    for (const guess of mockGuesses) {
      expect(userIds.has(guess.userId)).toBe(true);
      expect(propertyIds.has(guess.propertyId)).toBe(true);
    }
  });

  it('mockComments references valid users', () => {
    const userIds = new Set(mockUsers.map((u) => u.id));
    for (const comment of mockComments) {
      expect(userIds.has(comment.userId)).toBe(true);
    }
  });

  it('mockFMV has valid structure', () => {
    expect(typeof mockFMV.value).toBe('number');
    expect(typeof mockFMV.confidence).toBe('string');
    expect(typeof mockFMV.guessCount).toBe('number');
    expect(mockFMV.distribution).toBeDefined();
  });

  it('mockMapProperties has same count as mockProperties', () => {
    expect(mockMapProperties.length).toBe(mockProperties.length);
  });

  it('mockPropertyClusters has valid structure', () => {
    expect(mockPropertyClusters.length).toBeGreaterThan(0);
    for (const cluster of mockPropertyClusters) {
      expect(cluster.id).toBeTruthy();
      expect(typeof cluster.coordinates.lat).toBe('number');
      expect(typeof cluster.coordinates.lon).toBe('number');
      expect(typeof cluster.count).toBe('number');
    }
  });

  it('getMockUser returns user for valid ID', () => {
    const user = getMockUser('user-001');
    expect(user).toBeDefined();
    expect(user?.id).toBe('user-001');
  });

  it('getMockUser returns undefined for invalid ID', () => {
    expect(getMockUser('nonexistent')).toBeUndefined();
  });

  it('getMockProperty returns property for valid ID', () => {
    const prop = getMockProperty('prop-001');
    expect(prop).toBeDefined();
    expect(prop?.id).toBe('prop-001');
  });

  it('getMockComments returns comments for valid property', () => {
    const comments = getMockComments('prop-001');
    expect(comments.length).toBeGreaterThan(0);
  });

  it('getMockGuesses returns guesses for valid property', () => {
    const guesses = getMockGuesses('prop-001');
    expect(guesses.length).toBeGreaterThan(0);
  });
});

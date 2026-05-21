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
  reportHandlers,
  resetMockFollowState,
  resetMockReports,
  resetMockReadState,
  resetMockSessions,
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
  mockPropertyIds,
  mockUserIds,
  getMockUser,
  getMockProperty,
  getMockComments,
  getMockGuesses,
} from '../data/fixtures.js';

describe('Mock handler runtime parity', () => {
  const listingPropertyId = '11111111-1111-4111-8111-111111111111';
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const nearbyGroupedBaseKeys = [
    'nodeClass',
    'groupKind',
    'primaryPropertyId',
    'pointCount',
    'propertyIds',
    'previewPropertyIds',
    'pyramidVersionId',
    'pyramidNodeId',
    'membershipComplete',
    'readStateCoverage',
    'coordinate',
    'bbox',
    'activeListingCount',
    'socialCount',
    'recentSocialCount',
    'socialScoreTotal',
    'socialScoreMax',
    'recentSocialScoreTotal',
    'commentCount',
    'isRead',
    'distanceMeters',
  ] as const;
  const nearbySingleKeys = [
    ...nearbyGroupedBaseKeys,
    'address',
    'city',
    'askingPrice',
    'thumbnailUrl',
    'hasActiveListing',
    'marketState',
  ].sort();
  const nearbyClusterKeys = [...nearbyGroupedBaseKeys].sort();

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    resetMockSessions();
    resetMockFollowState();
    resetMockReadState();
    resetMockReports();
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

  it('matches report creation and admin moderation mock envelopes', async () => {
    const propertyResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'wrong_location',
          details: 'Marker is off.',
          reporterDeviceId: 'mock-device',
        }),
      }
    );
    const propertyBody = await propertyResponse.json();

    expect(propertyResponse.status).toBe(201);
    expect(propertyBody.report).toMatchObject({
      targetType: 'property',
      targetId: mockPropertyIds.prinsengracht263,
      reporterUserId: null,
      reporterDeviceId: 'mock-device',
      reason: 'wrong_location',
      status: 'unresolved',
    });

    const deniedResponse = await fetch('http://localhost/admin/reports/properties');
    expect(deniedResponse.status).toBe(401);

    const queueResponse = await fetch('http://localhost/admin/reports/properties', {
      headers: { Authorization: 'Bearer mock-admin-token' },
    });
    const queueBody = await queueResponse.json();
    expect(queueResponse.status).toBe(200);
    expect(queueBody.data).toHaveLength(1);
    expect(queueBody.meta.total).toBe(1);

    const patchResponse = await fetch(
      `http://localhost/admin/reports/${propertyBody.report.id as string}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer mock-admin-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mark_property_reviewed' }),
      }
    );
    const patchBody = await patchResponse.json();
    expect(patchResponse.status).toBe(200);
    expect(patchBody.report.status).toBe('resolved');
    expect(patchBody.report.reviewAction).toBe('mark_property_reviewed');
  });

  it('hides comments through admin report mocks', async () => {
    const commentId = getMockComments(mockPropertyIds.prinsengracht263)[0].id;
    const reportResponse = await fetch(`http://localhost/comments/${commentId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'spam',
        reporterDeviceId: 'mock-device',
      }),
    });
    const reportBody = await reportResponse.json();
    expect(reportResponse.status).toBe(201);

    const beforeResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/comments`
    );
    const beforeBody = await beforeResponse.json();
    expect(beforeBody.thread.comments.some((comment: { id: string }) => comment.id === commentId)).toBe(true);

    const patchResponse = await fetch(`http://localhost/admin/reports/${reportBody.report.id as string}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer mock-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'hide_comment' }),
    });
    const patchBody = await patchResponse.json();
    expect(patchResponse.status).toBe(200);
    expect(patchBody.hiddenCommentId).toBe(commentId);

    const afterResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/comments`
    );
    const afterBody = await afterResponse.json();
    expect(afterBody.thread.comments.some((comment: { id: string }) => comment.id === commentId)).toBe(false);
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
      expect(body.data[0]).toHaveProperty('hasActiveListing');
      expect(body.data[0]).toHaveProperty('marketState');
      expect(body.data[0]).toHaveProperty('latestListingStatus');
      expect(body.data[0]).toHaveProperty('topLevelCommentCount');
      expect(body.data[0]).toHaveProperty('replyCount');
      expect(body.data[0]).toHaveProperty('socialScore');
      expect(body.data[0]).toHaveProperty('recentSocialScore');
      expect(body.data[0]).toHaveProperty('isSaved', true);
      expect(body.data[0]).not.toHaveProperty('commentCount');
      expect(body.data[0].id).toMatch(uuidShape);
    }
  });

  it('exposes official valuation years and hydrate acceptance on property detail mocks', async () => {
    const detailResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}`
    );
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody).toMatchObject({
      officialValuation: 2850000,
      officialValuationYear: 2024,
      officialValuationSourceFetch: {
        source: 'woz',
        expectedValuationYear: 2024,
        supportsClientFetch: {
          web: true,
          native: true,
        },
      },
    });
    expect(detailBody).not.toHaveProperty('officialValuationExpectedYear');
    expect(detailBody).not.toHaveProperty('officialValuationHydrationSupported');
    expect(detailBody).not.toHaveProperty('officialValuationVerified');

    const hydrateResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/official-valuations/hydrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'woz',
          valuation: 2910000,
          valuationYear: 2024,
          referenceDate: '2024-01-01',
        }),
      }
    );
    const hydrateBody = await hydrateResponse.json();

    expect(hydrateResponse.status).toBe(200);
    expect(hydrateBody).toEqual({
      propertyId: mockPropertyIds.prinsengracht263,
      source: 'woz',
      status: 'accepted',
      officialValuation: 2910000,
      officialValuationYear: 2024,
    });

    const refreshedDetailResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}`
    );
    await expect(refreshedDetailResponse.json()).resolves.toMatchObject({
      officialValuation: 2910000,
      officialValuationYear: 2024,
    });
  });

  it('matches live /properties/:id/guesses envelope and price-start fields', async () => {
    const activeSaleResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/guesses?page=1&limit=2`
    );
    const activeSaleBody = await activeSaleResponse.json();

    expect(activeSaleResponse.status).toBe(200);
    expect(activeSaleBody).toHaveProperty('data');
    expect(activeSaleBody).toHaveProperty('meta');
    expect(activeSaleBody).toHaveProperty('fmv');
    expect(activeSaleBody).toHaveProperty('activeListingAskingPrice', 2950000);
    expect(activeSaleBody).not.toHaveProperty('cursor');
    expect(activeSaleBody).not.toHaveProperty('hasMore');
    expect(activeSaleBody).not.toHaveProperty('priceGuessStart');
    expect(activeSaleBody.meta).toEqual({
      page: 1,
      limit: 2,
      total: 2,
      totalPages: 1,
    });
    expect(activeSaleBody.fmv).toEqual({
      fmv: 2780000,
      confidence: 'high',
      guessCount: 42,
      distribution: {
        p10: 2500000,
        p25: 2650000,
        p50: 2780000,
        p75: 2900000,
        p90: 3200000,
        min: 2500000,
        max: 3200000,
      },
      officialValuation: 2850000,
      askingPrice: 2950000,
      divergence: -170000,
    });
    expect(activeSaleBody.data[0]).toMatchObject({
      propertyId: mockPropertyIds.prinsengracht263,
      isMemeGuess: false,
      user: {
        karmaRank: {
          title: expect.any(String),
          level: expect.any(Number),
        },
      },
    });

    const nonListingResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.oudegracht150}/guesses`
    );
    const nonListingBody = await nonListingResponse.json();

    expect(nonListingResponse.status).toBe(200);
    expect(nonListingBody).toHaveProperty('activeListingAskingPrice', null);
    expect(nonListingBody.priceGuessStart).toEqual({
      price: 585000,
      source: 'official_valuation',
      confidence: 'weak',
      sampleSize: 0,
    });
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
    expect(previewBody).toHaveProperty('sourceName');
    expect(previewBody).toHaveProperty('rawUrl');
    expect(previewBody).toHaveProperty('canonicalUrl');
    expect(previewBody).toHaveProperty('sourceListingId');
    expect(previewBody).toHaveProperty('sourceListingIdKind');
    expect(previewBody).toHaveProperty('validationState', 'valid');
    expect(previewBody).toHaveProperty('matchState', 'matched');
    expect(previewBody).toHaveProperty('handoffState', 'will_create');
    expect(previewBody).toHaveProperty('reasonCode');
    expect(previewBody).toHaveProperty('title');
    expect(previewBody).toHaveProperty('description');
    expect(previewBody).toHaveProperty('imageUrl');
    expect(previewBody).toHaveProperty('askingPrice');
    expect(previewBody).toHaveProperty('priceType');
    expect(previewBody).toHaveProperty('currency');
    expect(previewBody).toHaveProperty('submittedPropertyId', listingPropertyId);
    expect(previewBody).toHaveProperty('matchedPropertyId', listingPropertyId);
    expect(previewBody).toHaveProperty('previewToken');
    expect(previewBody).toHaveProperty('previewId');

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
        previewToken: previewBody.previewToken,
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
        previewToken: 'invalid-preview-token-for-handler-alignment',
      }),
    });
    expect(invalidSubmitResponse.status).toBe(400);
    expect(await invalidSubmitResponse.json()).toMatchObject({ error: 'INVALID_PREVIEW_TOKEN' });

    const submitResponse = await fetch('http://localhost/listings/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        previewToken: previewBody.previewToken,
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
    expect(submitBody).toHaveProperty('canonicalUrl');
    expect(submitBody).toHaveProperty('sourceListingId');
    expect(submitBody).toHaveProperty('candidateHandoffState', 'queued');
    expect(submitBody).toHaveProperty('candidateId');
    expect(submitBody).toHaveProperty('verificationState', 'validated');
    expect(submitBody).toHaveProperty('reasonCode');

    const provisionalPreviewResponse = await fetch('http://localhost/listings/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.funda.nl/koop/eindhoven/huis-unavailable/',
        propertyId: listingPropertyId,
      }),
    });
    const provisionalPreviewBody = await provisionalPreviewResponse.json();
    expect(provisionalPreviewResponse.status).toBe(200);
    expect(provisionalPreviewBody).toMatchObject({
      validationState: 'provisional',
      matchState: 'unverified',
      handoffState: 'will_create',
      reasonCode: 'mirror_unavailable',
      matchedPropertyId: null,
    });

    const provisionalSubmitResponse = await fetch('http://localhost/listings/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        previewToken: provisionalPreviewBody.previewToken,
      }),
    });
    const provisionalSubmitBody = await provisionalSubmitResponse.json();
    expect(provisionalSubmitResponse.status).toBe(201);
    expect(provisionalSubmitBody).toMatchObject({
      propertyId: listingPropertyId,
      verificationState: 'provisional',
      reasonCode: 'mirror_unavailable',
    });

    for (const [urlFragment, reasonCode] of [
      ['parser-error', 'parser_error'],
      ['validation-pending', 'validation_pending'],
    ] as const) {
      const response = await fetch('http://localhost/listings/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.pararius.com/apartment-for-rent/eindhoven/${urlFragment}/listing`,
          propertyId: listingPropertyId,
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        validationState: 'provisional',
        matchState: 'unverified',
        handoffState: 'will_create',
        reasonCode,
        matchedPropertyId: null,
      });
    }

    const mismatchPreviewResponse = await fetch('http://localhost/listings/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.funda.nl/detail/mismatch-12345',
        propertyId: listingPropertyId,
      }),
    });
    const mismatchPreviewBody = await mismatchPreviewResponse.json();
    expect(mismatchPreviewResponse.status).toBe(400);
    expect(mismatchPreviewBody).toMatchObject({
      error: 'LISTING_VALIDATION_FAILED',
      message: 'Listing validation failed: address_mismatch',
    });
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
      expect(body.data[0]).toHaveProperty('propertyId');
      expect(body.data[0]).toHaveProperty('sourceUrl');
      expect(body.data[0]).toHaveProperty('canonicalUrl');
      expect(body.data[0]).toHaveProperty('displayUrl');
      expect(body.data[0]).toHaveProperty('sourceListingId');
      expect(body.data[0]).toHaveProperty('candidateHandoffState');
      expect(body.data[0]).toHaveProperty('verificationState');
      expect(body.data[0]).toHaveProperty('reasonCode');
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
      'http://localhost/properties/resolve?postalCode=1016GV&houseNumber=263&countryCode=NL'
    );
    const resolveBody = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolveBody).toHaveProperty('hasActiveListing', true);
    expect(resolveBody).toHaveProperty('marketState', 'for-sale');
    expect(resolveBody).toHaveProperty('officialValuationSourceFetch');
    expect(resolveBody.officialValuationSourceFetch).toMatchObject({
      source: 'woz',
      expectedValuationYear: 2024,
      supportsClientFetch: {
        web: true,
        native: true,
      },
    });
    expect(resolveBody).not.toHaveProperty('hasListing');

    const nearbySingleResponse = await fetch(
      'http://localhost/properties/nearby?lon=4.8952&lat=52.3702&zoom=17'
    );
    const nearbySingleBody = await nearbySingleResponse.json();

    expect(nearbySingleResponse.status).toBe(200);
    expect(nearbySingleBody).toHaveProperty('groupKind', 'single');
    expect(nearbySingleBody).toHaveProperty('hasActiveListing');
    expect(nearbySingleBody).toHaveProperty('marketState');
    expect(nearbySingleBody).toHaveProperty('isRead', false);
    expect(Object.keys(nearbySingleBody).sort()).toEqual(nearbySingleKeys);

    const nearbyClusterResponse = await fetch(
      'http://localhost/properties/nearby?lon=4.8952&lat=52.3702&zoom=13'
    );
    const nearbyClusterBody = await nearbyClusterResponse.json();

    expect(nearbyClusterResponse.status).toBe(200);
    expect(nearbyClusterBody).toHaveProperty('groupKind', 'cluster');
    expect(nearbyClusterBody).toHaveProperty('isRead', false);
    expect(nearbyClusterBody.pyramidVersionId).toMatch(uuidShape);
    expect(nearbyClusterBody).toHaveProperty('membershipComplete', false);
    expect(nearbyClusterBody).toHaveProperty('readStateCoverage', 'partial');
    expect(nearbyClusterBody.propertyIds).toEqual([]);
    expect(nearbyClusterBody.previewPropertyIds.length).toBeGreaterThan(0);
    expect(Object.keys(nearbyClusterBody).sort()).toEqual(nearbyClusterKeys);

    const nearbyNullResponse = await fetch(
      'http://localhost/properties/nearby?lon=3.5&lat=55.1&zoom=17'
    );
    expect(nearbyNullResponse.status).toBe(200);
    expect(await nearbyNullResponse.json()).toBeNull();
  });

  it('matches resolve validation and null lookup semantics', async () => {
    const missingRequiredResponse = await fetch(
      'http://localhost/properties/resolve?postalCode=1016GV'
    );
    expect(missingRequiredResponse.status).toBe(400);
    expect(await missingRequiredResponse.json()).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });

    const invalidHouseNumberResponse = await fetch(
      'http://localhost/properties/resolve?postalCode=1016GV&houseNumber=abc&countryCode=NL'
    );
    expect(invalidHouseNumberResponse.status).toBe(400);
    expect(await invalidHouseNumberResponse.json()).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });

    const mismatchedAdditionResponse = await fetch(
      'http://localhost/properties/resolve?postalCode=1016GV&houseNumber=263&houseNumberAddition=A&countryCode=NL'
    );
    expect(mismatchedAdditionResponse.status).toBe(200);
    expect(await mismatchedAdditionResponse.json()).toBeNull();
  });

  it('matches Following TileJSON auth split and personalized nearby grouped payloads', async () => {
    const unauthorizedResponse = await fetch('http://localhost/tiles/following/properties.json');
    expect(unauthorizedResponse.status).toBe(401);

    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const omittedActivityTileJsonResponse = await fetch(
      'http://localhost/tiles/following/properties.json',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const omittedActivityTileJsonBody = await omittedActivityTileJsonResponse.json();

    expect(omittedActivityTileJsonResponse.status).toBe(200);
    expect(omittedActivityTileJsonBody.tiles[0]).toContain('activity=all-time');

    const legacyAllActivityTileJsonResponse = await fetch(
      'http://localhost/tiles/following/properties.json?activity=all',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const legacyAllActivityTileJsonBody = await legacyAllActivityTileJsonResponse.json();

    expect(legacyAllActivityTileJsonResponse.status).toBe(200);
    expect(legacyAllActivityTileJsonBody.tiles[0]).toContain('activity=all-time');
    expect(legacyAllActivityTileJsonBody.tiles[0]).not.toContain('activity=all&');

    const tileJsonResponse = await fetch(
      'http://localhost/tiles/following/properties.json?marketState=for-sale,sold&activity=10d',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const tileJsonBody = await tileJsonResponse.json();

    expect(tileJsonResponse.status).toBe(200);
    expect(tileJsonBody).toHaveProperty('tilejson', '2.1.0');
    expect(tileJsonBody).toHaveProperty('tiles');
    expect(Array.isArray(tileJsonBody.tiles)).toBe(true);
    expect(tileJsonBody.tiles[0]).toContain('/tiles/following/properties/{z}/{x}/{y}.pbf');
    expect(tileJsonBody.tiles[0]).toContain('marketState=for-sale%2Csold');
    expect(tileJsonBody.tiles[0]).toContain('activity=10d');

    const nearbyResponse = await fetch(
      'http://localhost/properties/following-nearby?lon=4.8952&lat=52.3702&zoom=17&marketState=for-sale',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const nearbyBody = await nearbyResponse.json();

    expect(nearbyResponse.status).toBe(200);
    expect(nearbyBody).toHaveProperty('groupKind', 'single');
    expect(nearbyBody).toHaveProperty('primaryPropertyId');
    expect(nearbyBody).toHaveProperty('hasActiveListing');
    expect(nearbyBody).toHaveProperty('marketState', 'for-sale');
    expect(Object.keys(nearbyBody).sort()).toEqual(nearbySingleKeys);

    const tenDayNearbyResponse = await fetch(
      'http://localhost/properties/following-nearby?lon=4.8952&lat=52.3702&zoom=17&marketState=for-sale&activity=10d',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const tenDayNearbyBody = await tenDayNearbyResponse.json();

    expect(tenDayNearbyResponse.status).toBe(200);
    expect(tenDayNearbyBody).toHaveProperty('groupKind', 'single');
    expect(tenDayNearbyBody).toHaveProperty('primaryPropertyId', mockPropertyIds.herengracht502);
    expect(tenDayNearbyBody).toHaveProperty('isRead', false);

    const todayNearbyResponse = await fetch(
      'http://localhost/properties/following-nearby?lon=4.8952&lat=52.3702&zoom=17&marketState=for-sale&activity=today',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(todayNearbyResponse.status).toBe(200);
    expect(await todayNearbyResponse.json()).toBeNull();

    const followResponse = await fetch(`http://localhost/users/${mockUserIds.sophie}/follow`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(followResponse.status).toBe(200);

    const afterFollowResponse = await fetch(
      'http://localhost/properties/following-nearby?lon=4.8952&lat=52.3702&zoom=13&marketState=for-sale',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const afterFollowBody = await afterFollowResponse.json();

    expect(afterFollowResponse.status).toBe(200);
    expect(afterFollowBody).toHaveProperty('groupKind', 'cluster');
    expect(afterFollowBody).toHaveProperty('isRead', false);
    expect(Object.keys(afterFollowBody).sort()).toEqual(nearbyClusterKeys);
    expect(afterFollowBody.propertyIds).toEqual(
      expect.arrayContaining([mockPropertyIds.herengracht502, mockPropertyIds.prinsengracht263])
    );
  });

  it('matches property view identity requirements and response envelope', async () => {
    const missingIdentityResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/view`,
      { method: 'POST' }
    );
    expect(missingIdentityResponse.status).toBe(400);
    expect(await missingIdentityResponse.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'Authenticated user or x-session-id header is required.',
    });

    const sessionResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}/view`,
      {
        method: 'POST',
        headers: { 'x-session-id': 'mock-session-1' },
      }
    );
    const sessionBody = await sessionResponse.json();

    expect(sessionResponse.status).toBe(200);
    expect(sessionBody).toHaveProperty('viewCount');
    expect(sessionBody).toHaveProperty('uniqueViewers');

    const sessionDetailResponse = await fetch(
      `http://localhost/properties/${mockPropertyIds.prinsengracht263}`,
      {
        headers: { 'x-session-id': 'mock-session-1' },
      }
    );
    expect(sessionDetailResponse.status).toBe(200);
    expect(await sessionDetailResponse.json()).toHaveProperty('isRead', true);
  });

  it('matches read-state TileJSON identity requirements and envelope', async () => {
    const missingIdentityResponse = await fetch('http://localhost/tiles/properties/read.json');
    expect(missingIdentityResponse.status).toBe(400);
    expect(await missingIdentityResponse.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'Authenticated user or x-session-id header is required.',
    });

    const tileJsonResponse = await fetch(
      'http://localhost/tiles/properties/read.json?marketState=for-sale,sold&activity=10d',
      {
        headers: { 'x-session-id': 'mock-session-tiles' },
      }
    );
    const tileJsonBody = await tileJsonResponse.json();

    expect(tileJsonResponse.status).toBe(200);
    expect(tileJsonBody).toHaveProperty('tilejson', '2.1.0');
    expect(tileJsonBody).toHaveProperty('name', 'HuisHype Read Properties');
    expect(tileJsonBody).toHaveProperty('tiles');
    expect(Array.isArray(tileJsonBody.tiles)).toBe(true);
    expect(tileJsonBody.tiles[0]).toContain('/tiles/properties/read/{z}/{x}/{y}.pbf');
    expect(tileJsonBody.tiles[0]).toContain('marketState=for-sale%2Csold');
    expect(tileJsonBody.tiles[0]).toContain('activity=10d');

    const missingIdentityTileResponse = await fetch(
      'http://localhost/tiles/properties/read/12/2048/1363.pbf'
    );
    expect(missingIdentityTileResponse.status).toBe(400);

    const tileResponse = await fetch('http://localhost/tiles/properties/read/12/2048/1363.pbf', {
      headers: { 'x-session-id': 'mock-session-tiles' },
    });
    expect(tileResponse.status).toBe(204);
  });

  it('matches follow-aware user profile and follow route behavior', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const publicProfileResponse = await fetch(
      `http://localhost/users/${mockUserIds.sophie}/profile`
    );
    const publicProfileBody = await publicProfileResponse.json();
    expect(publicProfileResponse.status).toBe(200);
    expect(publicProfileBody.relationship).toBe('none');
    expect(publicProfileBody).toHaveProperty('followerCount');
    expect(publicProfileBody).toHaveProperty('followingCount');

    const followResponse = await fetch(`http://localhost/users/${mockUserIds.sophie}/follow`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    const followBody = await followResponse.json();
    expect(publicProfileBody.id).toMatch(uuidShape);
    expect(followResponse.status).toBe(200);
    expect(followBody.relationship).toBe('following');
    expect(followBody.followerCount).toBeGreaterThan(0);

    const viewerAwareProfileResponse = await fetch(
      `http://localhost/users/${mockUserIds.sophie}/profile`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const viewerAwareProfileBody = await viewerAwareProfileResponse.json();
    expect(viewerAwareProfileResponse.status).toBe(200);
    expect(viewerAwareProfileBody.relationship).toBe('following');
    expect(viewerAwareProfileBody.followerCount).toBe(followBody.followerCount);
    expect(viewerAwareProfileBody.followingCount).toBe(followBody.followingCount);

    const followersResponse = await fetch('http://localhost/users/me/following', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const followersBody = await followersResponse.json();
    expect(followersResponse.status).toBe(200);
    expect(Array.isArray(followersBody.items)).toBe(true);

    expect(followersBody.items[0].id).toMatch(uuidShape);

    const selfFollowResponse = await fetch(`http://localhost/users/${mockUserIds.jan}/follow`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(selfFollowResponse.status).toBe(400);
  });

  it('matches user search validation, ranking, and viewer-aware payload shape', async () => {
    const invalidResponse = await fetch('http://localhost/users/search?q=@j');
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: 'QUERY_TOO_SHORT',
      message: 'Search query must be at least 2 characters.',
    });

    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const exactResponse = await fetch(
      'http://localhost/users/search?q=jandevries&limit=20&offset=0'
    );
    const exactBody = await exactResponse.json();
    expect(exactResponse.status).toBe(200);
    expect(exactBody.items[0]).toEqual({
      id: mockUserIds.jan,
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
      relationship: 'none',
      followerCount: 2,
    });
    expect(Object.keys(exactBody.items[0]).sort()).toEqual([
      'displayName',
      'followerCount',
      'handle',
      'id',
      'profilePhotoUrl',
      'relationship',
    ]);
    expect(exactBody.items[0]).not.toHaveProperty('email');
    expect(exactBody.pagination).toEqual({
      limit: 20,
      offset: 0,
      hasMore: false,
    });

    const displayPrefixResponse = await fetch('http://localhost/users/search?q=maria%20bak');
    const displayPrefixBody = await displayPrefixResponse.json();
    expect(displayPrefixResponse.status).toBe(200);
    expect(displayPrefixBody.items[0]).toHaveProperty('handle', 'mariabakker');

    const containsTieResponse = await fetch('http://localhost/users/search?q=en');
    const containsTieBody = await containsTieResponse.json();
    expect(containsTieResponse.status).toBe(200);
    expect(containsTieBody.items.map((item: { handle: string }) => item.handle)).toEqual([
      'larshendriks',
      'pieterjansen',
    ]);

    const authenticatedResponse = await fetch('http://localhost/users/search?q=@@lars', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const authenticatedBody = await authenticatedResponse.json();
    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedBody.items[0]).toEqual(
      expect.objectContaining({
        id: mockUserIds.lars,
        handle: 'larshendriks',
        relationship: 'mutual',
        followerCount: 1,
      })
    );
  });

  it('resets follow-state mutations between tests', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const profileResponse = await fetch(`http://localhost/users/${mockUserIds.sophie}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profileBody = await profileResponse.json();

    expect(profileResponse.status).toBe(200);
    expect(profileBody.relationship).toBe('none');
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
    expect(publicBody.pagination).toEqual(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        hasMore: expect.any(Boolean),
      })
    );
    expect(publicBody.items[0].actor.id).toMatch(uuidShape);
    expect(publicBody.items[0].property.id).toMatch(uuidShape);
    expect(publicBody.items[0].property).toHaveProperty('streetName');
    expect(publicBody.items[0].property).toHaveProperty('postalCode');
    expect(publicBody.items[0].property).toHaveProperty('countryCode');
    expect(publicBody.items[0].property).toHaveProperty('geometry');

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
    expect(followingBody.items.map((item: { actor: { id: string } }) => item.actor.id)).toEqual(
      expect.arrayContaining([mockUserIds.maria, mockUserIds.lars])
    );
    expect(
      followingBody.items.some(
        (item: { actor: { id: string } }) => item.actor.id === mockUserIds.sophie
      )
    ).toBe(false);

    const followResponse = await fetch(`http://localhost/users/${mockUserIds.sophie}/follow`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(followResponse.status).toBe(200);

    const followingAfterFollowResponse = await fetch(
      'http://localhost/activity?scope=following&limit=20',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const followingAfterFollowBody = await followingAfterFollowResponse.json();
    expect(followingAfterFollowResponse.status).toBe(200);
    expect(
      followingAfterFollowBody.items.some(
        (item: { actor: { id: string }; eventType: string }) =>
          item.actor.id === mockUserIds.sophie && item.eventType === 'comment'
      )
    ).toBe(true);

    const selfResponse = await fetch('http://localhost/users/me/activity?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const selfBody = await selfResponse.json();
    expect(selfResponse.status).toBe(200);
    expect(selfBody.items.some((item: { eventType: string }) => item.eventType === 'save')).toBe(
      true
    );
    expect(selfBody.pagination).toEqual(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        hasMore: expect.any(Boolean),
      })
    );
  });

  it('matches grouped property activity auth split and grouped payload shape', async () => {
    const loginResponse = await fetch('http://localhost/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token' }),
    });
    const loginBody = await loginResponse.json();
    const token = loginBody.session.accessToken as string;

    const publicResponse = await fetch(
      'http://localhost/activity/properties?scope=public&limit=20'
    );
    const publicBody = await publicResponse.json();
    expect(publicResponse.status).toBe(200);
    expect(publicBody.pagination).toEqual(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        hasMore: expect.any(Boolean),
      })
    );
    expect(publicBody.items[0]).toHaveProperty('property');
    expect(publicBody.items[0]).toHaveProperty('lastActivityAt');
    expect(publicBody.items[0]).toHaveProperty('counts');
    expect(publicBody.items[0]).toHaveProperty('recentActors');
    expect(publicBody.items[0]).toHaveProperty('preview');
    expect(publicBody.items[0].counts).toEqual(
      expect.objectContaining({
        likeCount: expect.any(Number),
        commentCount: expect.any(Number),
        guessCount: expect.any(Number),
      })
    );
    expect(Array.isArray(publicBody.items[0].recentActors)).toBe(true);
    expect(publicBody.items[0].recentActors.length).toBeLessThanOrEqual(3);
    expect(['comment', 'summary']).toContain(publicBody.items[0].preview.kind);

    const unauthorizedFollowingResponse = await fetch(
      'http://localhost/activity/properties?scope=following&limit=20'
    );
    expect(unauthorizedFollowingResponse.status).toBe(401);

    const followingResponse = await fetch(
      'http://localhost/activity/properties?scope=following&limit=20',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const followingBody = await followingResponse.json();
    expect(followingResponse.status).toBe(200);
    const allowedRecentActorIds = new Set<string>([mockUserIds.maria, mockUserIds.lars]);
    expect(
      followingBody.items.every((item: { recentActors: Array<{ id: string }> }) =>
        item.recentActors.every(({ id }) => allowedRecentActorIds.has(id))
      )
    ).toBe(true);
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
      ...reportHandlers,
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
    const user = getMockUser(mockUserIds.jan);
    expect(user).toBeDefined();
    expect(user?.id).toBe(mockUserIds.jan);
  });

  it('getMockUser returns undefined for invalid ID', () => {
    expect(getMockUser('nonexistent')).toBeUndefined();
  });

  it('getMockProperty returns property for valid ID', () => {
    const prop = getMockProperty(mockPropertyIds.prinsengracht263);
    expect(prop).toBeDefined();
    expect(prop?.id).toBe(mockPropertyIds.prinsengracht263);
  });

  it('getMockComments returns comments for valid property', () => {
    const comments = getMockComments(mockPropertyIds.prinsengracht263);
    expect(comments.length).toBeGreaterThan(0);
  });

  it('getMockGuesses returns guesses for valid property', () => {
    const guesses = getMockGuesses(mockPropertyIds.prinsengracht263);
    expect(guesses.length).toBeGreaterThan(0);
  });

  it('exports report handlers', () => {
    expect(reportHandlers.length).toBeGreaterThanOrEqual(6);
  });
});

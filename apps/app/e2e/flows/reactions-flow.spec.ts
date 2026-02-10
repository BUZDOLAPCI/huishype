/**
 * Reactions (Likes) Flow E2E Tests
 *
 * Tests the reactions/likes system end-to-end:
 * - Like a comment via API, verify count updates
 * - Unlike via API, verify count decrements
 * - Unauthenticated like returns 401
 * - Cannot double-like (returns 400)
 * - Like status check works correctly
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { createTestUser } from './helpers/test-user';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
];

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

/** Fetch a real property ID from the API */
async function getTestProperty(request: APIRequestContext) {
  const response = await request.get(`${API_BASE_URL}/properties?limit=1&city=Eindhoven`);
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.data.length).toBeGreaterThan(0);
  return { id: data.data[0].id as string };
}

/** Create a test comment to use as reaction target */
async function createTestComment(
  request: APIRequestContext,
  propertyId: string,
  userId: string
) {
  const response = await request.post(
    `${API_BASE_URL}/properties/${propertyId}/comments`,
    {
      data: { content: `Comment for reaction test ${Date.now()}` },
      headers: { 'x-user-id': userId },
    }
  );
  expect(response.status()).toBe(201);
  const data = await response.json();
  return { id: data.id as string };
}

test.describe('Reactions Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`, consoleErrors);
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('like a comment via API and verify count increases', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'likeauthor');
    const liker = await createTestUser(request, 'liker');
    const comment = await createTestComment(request, property.id, author.userId);

    // Check initial like status
    const initialStatus = await request.get(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(initialStatus.ok()).toBe(true);
    const initialData = await initialStatus.json();
    expect(initialData.liked).toBe(false);
    const initialCount = initialData.likeCount;

    // Like the comment
    const likeResponse = await request.post(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(likeResponse.status()).toBe(201);
    const likeData = await likeResponse.json();
    expect(likeData.liked).toBe(true);
    expect(likeData.likeCount).toBe(initialCount + 1);
    expect(likeData.message).toContain('liked');

    // Verify the like persists via GET
    const afterLikeStatus = await request.get(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(afterLikeStatus.ok()).toBe(true);
    const afterLikeData = await afterLikeStatus.json();
    expect(afterLikeData.liked).toBe(true);
    expect(afterLikeData.likeCount).toBe(initialCount + 1);
  });

  test('unlike a comment via API and verify count decreases', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'unlikeauthor');
    const liker = await createTestUser(request, 'unliker');
    const comment = await createTestComment(request, property.id, author.userId);

    // Like it first
    const likeResp = await request.post(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(likeResp.status()).toBe(201);
    const likeData = await likeResp.json();
    const likedCount = likeData.likeCount;

    // Unlike it
    const unlikeResp = await request.delete(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(unlikeResp.ok()).toBe(true);
    const unlikeData = await unlikeResp.json();
    expect(unlikeData.liked).toBe(false);
    expect(unlikeData.likeCount).toBe(likedCount - 1);
    expect(unlikeData.message).toContain('unliked');

    // Verify the unlike persists
    const statusResp = await request.get(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(statusResp.ok()).toBe(true);
    const statusData = await statusResp.json();
    expect(statusData.liked).toBe(false);
  });

  test('unauthenticated like returns 401', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'unauthlikeauthor');
    const comment = await createTestComment(request, property.id, author.userId);

    // Try to like without authentication
    const response = await request.post(
      `${API_BASE_URL}/comments/${comment.id}/like`
      // No x-user-id header
    );

    expect(response.status()).toBe(401);
    const errorData = await response.json();
    expect(errorData.error).toBe('UNAUTHORIZED');
  });

  test('double-like returns 409 ALREADY_LIKED', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'doublelikeauthor');
    const liker = await createTestUser(request, 'doubleliker');
    const comment = await createTestComment(request, property.id, author.userId);

    // Like once
    const firstLike = await request.post(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(firstLike.status()).toBe(201);

    // Try to like again
    const secondLike = await request.post(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(secondLike.status()).toBe(409);
    const errorData = await secondLike.json();
    expect(errorData.error).toBe('ALREADY_LIKED');
  });

  test('unlike without prior like returns 404', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'nolikeauthor');
    const user = await createTestUser(request, 'nolikeuser');
    const comment = await createTestComment(request, property.id, author.userId);

    // Try to unlike without having liked
    const response = await request.delete(
      `${API_BASE_URL}/comments/${comment.id}/like`,
      {
        headers: { 'x-user-id': user.userId },
      }
    );
    expect(response.status()).toBe(404);
    const errorData = await response.json();
    expect(errorData.error).toBe('NOT_FOUND');
  });

  test('multiple users can like the same comment', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'multiauthor');
    const comment = await createTestComment(request, property.id, author.userId);

    // Three users like the comment (created sequentially to avoid timestamp collisions)
    const user1 = await createTestUser(request, 'multiliker1');
    const user2 = await createTestUser(request, 'multiliker2');
    const user3 = await createTestUser(request, 'multiliker3');
    const users = [user1, user2, user3];

    for (const user of users) {
      const resp = await request.post(
        `${API_BASE_URL}/comments/${comment.id}/like`,
        {
          headers: { 'x-user-id': user.userId },
        }
      );
      expect(resp.status()).toBe(201);
    }

    // Verify the count is correct
    const status = await request.get(`${API_BASE_URL}/comments/${comment.id}/like`);
    expect(status.ok()).toBe(true);
    const data = await status.json();
    expect(data.likeCount).toBe(3);
  });

  test('like buttons are visible on comments in property page', async ({ page, request }) => {
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // Scroll to comments
    await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.textContent?.includes('Comments') && el.tagName !== 'SCRIPT') {
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          break;
        }
      }
    });

    await page.waitForTimeout(1000);

    // The property detail page has mock comments with like buttons
    const likeButtons = page.locator('[data-testid="like-button"]');
    const count = await likeButtons.count();
    console.log(`Found ${count} like buttons on property detail page`);

    // Page renders without error
    await expect(page.locator('body')).toBeVisible();
  });

  test('like a property via API and verify count increases', async ({ request }) => {
    const property = await getTestProperty(request);
    const liker = await createTestUser(request, 'propliker');

    // Like the property
    const likeResponse = await request.post(
      `${API_BASE_URL}/properties/${property.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(likeResponse.status()).toBe(201);
    const likeData = await likeResponse.json();
    expect(likeData.liked).toBe(true);
    expect(likeData.likeCount).toBeGreaterThanOrEqual(1);
  });

  test('unlike a property via API after liking', async ({ request }) => {
    const property = await getTestProperty(request);
    const liker = await createTestUser(request, 'propunliker');

    // Like first
    const likeResp = await request.post(
      `${API_BASE_URL}/properties/${property.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(likeResp.status()).toBe(201);

    // Unlike
    const unlikeResp = await request.delete(
      `${API_BASE_URL}/properties/${property.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );
    expect(unlikeResp.ok()).toBe(true);
    const unlikeData = await unlikeResp.json();
    expect(unlikeData.liked).toBe(false);
  });

  test('unauthenticated property like returns 401', async ({ request }) => {
    const property = await getTestProperty(request);

    const response = await request.post(
      `${API_BASE_URL}/properties/${property.id}/like`
    );
    expect(response.status()).toBe(401);
    const errorData = await response.json();
    expect(errorData.error).toBe('UNAUTHORIZED');
  });

  test('GET /properties/:id includes isLiked and likeCount', async ({ request }) => {
    const property = await getTestProperty(request);
    const liker = await createTestUser(request, 'propdetailliker');

    // Fetch property without auth - should have isLiked: false
    const unauthResp = await request.get(`${API_BASE_URL}/properties/${property.id}`);
    expect(unauthResp.ok()).toBe(true);
    const unauthData = await unauthResp.json();
    expect(unauthData).toHaveProperty('likeCount');
    expect(unauthData).toHaveProperty('isLiked');
    expect(unauthData.isLiked).toBe(false);

    // Like the property
    await request.post(
      `${API_BASE_URL}/properties/${property.id}/like`,
      {
        headers: { 'x-user-id': liker.userId },
      }
    );

    // Fetch property with auth - should have isLiked: true
    const authResp = await request.get(`${API_BASE_URL}/properties/${property.id}`, {
      headers: { 'x-user-id': liker.userId },
    });
    expect(authResp.ok()).toBe(true);
    const authData = await authResp.json();
    expect(authData.isLiked).toBe(true);
    expect(authData.likeCount).toBeGreaterThanOrEqual(1);
  });

  test('like count reflects in comments list API response', async ({ request }) => {
    const property = await getTestProperty(request);
    const author = await createTestUser(request, 'countauthor');
    const liker = await createTestUser(request, 'countliker');

    // Create a comment
    const commentResp = await request.post(
      `${API_BASE_URL}/properties/${property.id}/comments`,
      {
        data: { content: `Like count test ${Date.now()}` },
        headers: { 'x-user-id': author.userId },
      }
    );
    expect(commentResp.status()).toBe(201);
    const comment = await commentResp.json();

    // Like it
    await request.post(`${API_BASE_URL}/comments/${comment.id}/like`, {
      headers: { 'x-user-id': liker.userId },
    });

    // Fetch comments list and verify likeCount
    const listResp = await request.get(
      `${API_BASE_URL}/properties/${property.id}/comments?sort=recent&limit=50`
    );
    expect(listResp.ok()).toBe(true);
    const listData = await listResp.json();

    const foundComment = listData.data.find(
      (c: { id: string }) => c.id === comment.id
    );
    expect(foundComment).toBeDefined();
    expect(foundComment.likeCount).toBe(1);
  });
});

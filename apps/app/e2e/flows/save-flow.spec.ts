/**
 * Save Flow E2E Tests
 *
 * Tests the property save/unsave system end-to-end:
 * - Save button visible in QuickActions (bookmark-outline icon)
 * - Unauthenticated save attempt returns 401
 * - Authenticated save toggles via API (POST returns 201, GET /properties/:id returns isSaved=true)
 * - Authenticated unsave via API (DELETE returns 200, GET /properties/:id returns isSaved=false)
 * - Save status persists via GET /saved-properties list
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
  /net::ERR_NAME_NOT_RESOLVED/,
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

test.describe('Save Flow', () => {
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

  test('save button is visible in QuickActions on property page', async ({ page, request }) => {
    const property = await getTestProperty(request);

    await page.goto(`/property/${property.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Loading property...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // The property detail page should show the save button with bookmark icon
    // The QuickActions bar renders Save/Share/Like buttons
    const saveButton = page.locator('[data-testid="quick-action-save"]');
    await expect(saveButton).toBeVisible({ timeout: 10000 });
  });

  test('unauthenticated save returns 401', async ({ request }) => {
    const property = await getTestProperty(request);

    // Try to save without authentication
    const response = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`
      // No auth header
    );

    expect(response.status()).toBe(401);
    const errorData = await response.json();
    expect(errorData.error).toBe('UNAUTHORIZED');
  });

  test('authenticated save via API returns 201 and isSaved=true', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'saver');

    // Save the property
    const saveResponse = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(saveResponse.status()).toBe(201);
    const saveData = await saveResponse.json();
    expect(saveData.saved).toBe(true);

    // Verify via GET /properties/:id that isSaved is true
    const propertyResponse = await request.get(
      `${API_BASE_URL}/properties/${property.id}`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(propertyResponse.ok()).toBe(true);
    const propertyData = await propertyResponse.json();
    expect(propertyData.isSaved).toBe(true);
  });

  test('authenticated unsave via API returns 200 and isSaved=false', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'unsaver');

    // Save it first
    const saveResp = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(saveResp.status()).toBe(201);

    // Unsave it
    const unsaveResp = await request.delete(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(unsaveResp.ok()).toBe(true);
    const unsaveData = await unsaveResp.json();
    expect(unsaveData.saved).toBe(false);

    // Verify via GET /properties/:id that isSaved is false
    const propertyResponse = await request.get(
      `${API_BASE_URL}/properties/${property.id}`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(propertyResponse.ok()).toBe(true);
    const propertyData = await propertyResponse.json();
    expect(propertyData.isSaved).toBe(false);
  });

  test('save status persists via GET /saved-properties list', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'persistsaver');

    // Save the property
    const saveResp = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(saveResp.status()).toBe(201);

    // Verify it appears in the saved-properties list
    const listResp = await request.get(
      `${API_BASE_URL}/saved-properties`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(listResp.ok()).toBe(true);
    const listData = await listResp.json();
    expect(listData.data).toBeDefined();
    expect(Array.isArray(listData.data)).toBe(true);

    const savedIds = listData.data.map((p: { id: string }) => p.id);
    expect(savedIds).toContain(property.id);
  });

  test('unsaved property does not appear in saved-properties list', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'removesaver');

    // Save then unsave
    await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    await request.delete(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );

    // Verify it does NOT appear in the saved-properties list
    const listResp = await request.get(
      `${API_BASE_URL}/saved-properties`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(listResp.ok()).toBe(true);
    const listData = await listResp.json();

    const savedIds = (listData.data || []).map((p: { id: string }) => p.id);
    expect(savedIds).not.toContain(property.id);
  });

  test('double save returns 409 ALREADY_SAVED', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'doublesaver');

    // Save once
    const firstSave = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(firstSave.status()).toBe(201);

    // Try to save again
    const secondSave = await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );
    expect(secondSave.status()).toBe(409);
    const errorData = await secondSave.json();
    expect(errorData.error).toBe('ALREADY_SAVED');
  });

  test('unsave without prior save returns 404', async ({ request }) => {
    const property = await getTestProperty(request);
    const user = await createTestUser(request, 'nosaveuser');

    // Try to unsave without having saved
    const response = await request.delete(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${user.accessToken}` },
      }
    );
    expect(response.status()).toBe(404);
    const errorData = await response.json();
    expect(errorData.error).toBe('NOT_FOUND');
  });

  test('GET /properties/:id includes isSaved field', async ({ request }) => {
    const property = await getTestProperty(request);
    const saver = await createTestUser(request, 'issavedcheck');

    // Fetch property without auth - should have isSaved: false
    const unauthResp = await request.get(`${API_BASE_URL}/properties/${property.id}`);
    expect(unauthResp.ok()).toBe(true);
    const unauthData = await unauthResp.json();
    expect(unauthData).toHaveProperty('isSaved');
    expect(unauthData.isSaved).toBe(false);

    // Save the property
    await request.post(
      `${API_BASE_URL}/properties/${property.id}/save`,
      {
        headers: { authorization: `Bearer ${saver.accessToken}` },
      }
    );

    // Fetch property with auth - should have isSaved: true
    const authResp = await request.get(`${API_BASE_URL}/properties/${property.id}`, {
      headers: { authorization: `Bearer ${saver.accessToken}` },
    });
    expect(authResp.ok()).toBe(true);
    const authData = await authResp.json();
    expect(authData.isSaved).toBe(true);
  });
});

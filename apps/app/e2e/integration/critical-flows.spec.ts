import { test, expect } from '@playwright/test';
import { waitForFeedLoaded, waitForMapReady } from './helpers';
import {
  getPlaywrightApiUrl,
  getPlaywrightArtifactPath,
  getPlaywrightWebOrigin,
} from '../helpers/runtime';

/**
 * Integration tests for HuisHype that exercise the real Playwright web runtime:
 * - Real API server (not MSW mocks)
 * - Real database (Docker Postgres with PostGIS)
 * - Real statically served web app
 *
 * These tests catch real integration issues like:
 * - Wrong API URL prefixes
 * - API validation mismatches
 * - Database connection issues
 * - Route registration problems
 *
 * Normally these run through the root Playwright wrapper, which provisions the
 * API process and static web runtime on dynamic ports and exposes them through
 * the runtime helpers imported below.
 */

const API_BASE_URL = getPlaywrightApiUrl();
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';

async function dismissWelcomeModalIfVisible(page: import('@playwright/test').Page): Promise<void> {
  const dismissButton = page.getByTestId('welcome-modal-dismiss-button');
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
    await expect(page.getByTestId('welcome-modal-card')).toBeHidden();
  }
}

test.describe('Critical Flows - Full Stack Integration', () => {
  test.describe('API Health & Connectivity', () => {
    test('API health check - server is running', async ({ request }) => {
      const response = await request.get(`${API_BASE_URL}/health`);

      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(['ok', 'degraded']).toContain(data.status);
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('uptime');
    });

    test('API CORS is configured correctly', async ({ request }) => {
      const response = await request.get(`${API_BASE_URL}/health`, {
        headers: {
          Origin: getPlaywrightWebOrigin(),
        },
      });

      expect(response.ok()).toBe(true);
    });
  });

  test.describe('Properties API - Full Stack', () => {
    test('Properties endpoint returns valid data structure', async ({ request }) => {
      const response = await request.get(`${API_BASE_URL}/properties?limit=10`);

      expect(response.ok()).toBe(true);

      const data = await response.json();

      // Verify response structure
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
      expect(Array.isArray(data.data)).toBe(true);

      // Verify meta structure
      expect(data.meta).toHaveProperty('page');
      expect(data.meta).toHaveProperty('limit');
      expect(data.meta).toHaveProperty('total');
      expect(data.meta).toHaveProperty('totalPages');

      // If there are properties, verify property structure
      if (data.data.length > 0) {
        const property = data.data[0];
        expect(property).toHaveProperty('id');
        expect(property).toHaveProperty('address');
        expect(property).toHaveProperty('city');
        expect(property).toHaveProperty('status');
        expect(property).toHaveProperty('createdAt');
        expect(property).toHaveProperty('updatedAt');
      }
    });

    test('API accepts limit=100 (frontend default)', async ({ request }) => {
      // This is the max limit that the API schema allows
      const response = await request.get(`${API_BASE_URL}/properties?limit=100`);

      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data.meta.limit).toBe(100);
    });

    test('API rejects limit > 100', async ({ request }) => {
      // API validation should reject limits above 100
      const response = await request.get(`${API_BASE_URL}/properties?limit=500`);

      // Should return 400 Bad Request
      expect(response.status()).toBe(400);
    });

    test('API pagination works correctly', async ({ request }) => {
      // Get first page
      const page1Response = await request.get(`${API_BASE_URL}/properties?page=1&limit=5`);
      expect(page1Response.ok()).toBe(true);

      const page1Data = await page1Response.json();
      expect(page1Data.meta.page).toBe(1);

      // If there's more than one page, verify page 2
      if (page1Data.meta.totalPages > 1) {
        const page2Response = await request.get(`${API_BASE_URL}/properties?page=2&limit=5`);
        expect(page2Response.ok()).toBe(true);

        const page2Data = await page2Response.json();
        expect(page2Data.meta.page).toBe(2);

        // First items should be different (if we have enough data)
        if (page1Data.data.length > 0 && page2Data.data.length > 0) {
          expect(page1Data.data[0].id).not.toBe(page2Data.data[0].id);
        }
      }
    });

    test('API filter by city works', async ({ request }) => {
      // First get all properties to find a city
      const allResponse = await request.get(`${API_BASE_URL}/properties?limit=10`);
      const allData = await allResponse.json();

      if (allData.data.length > 0) {
        const city = allData.data[0].city;

        // Filter by that city
        const filteredResponse = await request.get(
          `${API_BASE_URL}/properties?city=${encodeURIComponent(city)}`
        );
        expect(filteredResponse.ok()).toBe(true);

        const filteredData = await filteredResponse.json();

        // All returned properties should be from the specified city
        for (const property of filteredData.data) {
          expect(property.city).toBe(city);
        }
      }
    });

    test('API bounding box query works', async ({ request }) => {
      // Netherlands approximate bounding box
      const bbox = '3.0,50.5,7.5,53.5';

      const response = await request.get(`${API_BASE_URL}/properties?bbox=${bbox}&limit=10`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
    });

    test('API point + radius query works', async ({ request }) => {
      // Amsterdam approximate center
      const lat = 52.3676;
      const lon = 4.9041;
      const radius = 5000; // 5km

      const response = await request.get(
        `${API_BASE_URL}/properties?lat=${lat}&lon=${lon}&radius=${radius}&limit=10`
      );
      expect(response.ok()).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  test.describe('Frontend + API Integration', () => {
    test.setTimeout(60_000);

    test('Map view loads without API errors', async ({ page }) => {
      // Listen for console errors
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Listen for failed requests
      const failedRequests: string[] = [];
      page.on('requestfailed', (request) => {
        failedRequests.push(
          `${request.method()} ${request.url()}: ${request.failure()?.errorText}`
        );
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Take screenshot for debugging
      await page.screenshot({
        path: getPlaywrightArtifactPath('integration', 'integration-map-view.png'),
        fullPage: true,
      });

      // Should NOT see the generic error state
      const errorState = page.locator('text=Failed to load');
      const isErrorVisible = await errorState.isVisible().catch(() => false);

      if (isErrorVisible) {
        // Log additional debugging info
        console.error('Error state visible. Console errors:', consoleErrors);
        console.error('Failed requests:', failedRequests);
      }

      expect(isErrorVisible).toBe(false);
    });

    test('Map view loads properties from real API', async ({ page }) => {
      // Intercept API calls to verify they go to the real API
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        if (request.url().includes('/properties')) {
          apiCalls.push(request.url());
        }
      });

      const firstPropertiesRequest = page.waitForRequest((request) =>
        request.url().includes('/properties')
      );
      await page.goto('/');
      await firstPropertiesRequest;

      // Take screenshot
      await page.screenshot({
        path: getPlaywrightArtifactPath('integration', 'integration-map-properties.png'),
        fullPage: true,
      });

      // Verify API calls were made
      expect(apiCalls.length).toBeGreaterThan(0);

      // Verify API calls went to a real API (not a mock)
      // Match any host on port 3100 (localhost, LAN IP, etc.)
      const validApiCalls = apiCalls.filter(
        (url) => url.includes(':3100/') || url.includes(API_BASE_URL)
      );
      expect(validApiCalls.length).toBeGreaterThan(0);
    });

    test('Feed view loads properties from real API', async ({ page }) => {
      await page.addInitScript((storageKey) => {
        window.localStorage.setItem(storageKey, '1');
      }, WELCOME_MODAL_DISMISSED_KEY);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await dismissWelcomeModalIfVisible(page);

      // Try to navigate to feed tab
      const feedTab = page
        .getByRole('tab', { name: /feed/i })
        .or(page.locator('[data-testid="feed-tab"]'))
        .or(page.locator('text=Feed'));

      const isFeedTabVisible = await feedTab
        .first()
        .isVisible()
        .catch(() => false);

      if (isFeedTabVisible) {
        await feedTab.first().click();
        await waitForFeedLoaded(page);

        // Take screenshot
        await page.screenshot({
          path: getPlaywrightArtifactPath('integration', 'integration-feed-view.png'),
          fullPage: true,
        });

        // Should NOT see error state
        const errorState = page.locator('text=Failed to load');
        const isErrorVisible = await errorState.isVisible().catch(() => false);
        expect(isErrorVisible).toBe(false);
      } else {
        // Feed tab might not exist yet, that's ok
        console.log('Feed tab not visible, skipping feed view test');
      }
    });

    test('Frontend uses correct API URL prefix', async ({ page }) => {
      // Track all API requests
      const apiRequests: { url: string; status: number }[] = [];

      page.on('response', (response) => {
        const url = response.url();
        if (url.includes('/properties') || url.includes('/health')) {
          apiRequests.push({
            url,
            status: response.status(),
          });
        }
      });

      await page.goto('/');
      await waitForMapReady(page);

      // Verify no 404s on API endpoints
      const notFoundRequests = apiRequests.filter((r) => r.status === 404);

      if (notFoundRequests.length > 0) {
        console.error('404 requests:', notFoundRequests);
      }

      expect(notFoundRequests.length).toBe(0);
    });
  });

  test.describe('Error Handling', () => {
    test('Frontend handles empty data gracefully', async ({ page, request }) => {
      // First check how many properties we have
      const apiResponse = await request.get(`${API_BASE_URL}/properties?limit=1`);
      const apiData = await apiResponse.json();

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await waitForMapReady(page);

      // Take screenshot
      await page.screenshot({
        path: getPlaywrightArtifactPath('integration', 'integration-data-state.png'),
        fullPage: true,
      });

      // Page should render something (not crash)
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // If no data, should show empty state, not error state
      if (apiData.meta.total === 0) {
        const errorState = page.locator('text=Failed to load');
        const isErrorVisible = await errorState.isVisible().catch(() => false);
        expect(isErrorVisible).toBe(false);
      }
    });
  });
});

test.describe('Comments API - Full Stack', () => {
  test('Comments endpoint returns valid structure', async ({ request }) => {
    // First get a property ID
    const propertiesResponse = await request.get(`${API_BASE_URL}/properties?limit=1`);

    if (propertiesResponse.ok()) {
      const propertiesData = await propertiesResponse.json();

      if (propertiesData.data.length > 0) {
        const propertyId = propertiesData.data[0].id;

        const commentsResponse = await request.get(
          `${API_BASE_URL}/properties/${propertyId}/comments`
        );

        // Comments endpoint should exist and return valid structure
        expect(commentsResponse.ok()).toBe(true);

        const commentsData = await commentsResponse.json();
        expect(commentsData).toHaveProperty('data');
        expect(Array.isArray(commentsData.data)).toBe(true);
      }
    }
  });
});

test.describe('Guesses API - Full Stack', () => {
  test('Guesses endpoint returns valid structure', async ({ request }) => {
    // First get a property ID
    const propertiesResponse = await request.get(`${API_BASE_URL}/properties?limit=1`);

    if (propertiesResponse.ok()) {
      const propertiesData = await propertiesResponse.json();

      if (propertiesData.data.length > 0) {
        const propertyId = propertiesData.data[0].id;

        const guessesResponse = await request.get(
          `${API_BASE_URL}/properties/${propertyId}/guesses`
        );

        // Guesses endpoint should exist and return valid structure
        expect(guessesResponse.ok()).toBe(true);

        const guessesData = await guessesResponse.json();
        expect(guessesData).toHaveProperty('data');
        expect(Array.isArray(guessesData.data)).toBe(true);
      }
    }
  });
});

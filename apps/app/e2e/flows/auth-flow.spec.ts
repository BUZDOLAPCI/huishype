/**
 * Auth Flow E2E Tests
 *
 * Tests the web authentication flow:
 * - Login button is visible in the header
 * - Auth modal opens on login click
 * - Auth API endpoints work correctly (google, refresh, me, logout)
 * - Unauthenticated users get 401 on protected routes
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { createTestUser } from './helpers/test-user';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';
const SCREENSHOT_DIR = 'test-results/flows';

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

test.use({ trace: 'off' });

test.describe('Auth Flow', () => {
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
      console.error(`Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('Login button is visible in header on map page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Check for login button in header
    const loginButton = page.locator('[data-testid="header-login-button"]');
    const userAvatar = page.locator('[data-testid="header-user-avatar"]');

    const hasLogin = await loginButton.isVisible().catch(() => false);
    const hasAvatar = await userAvatar.isVisible().catch(() => false);

    // Either login button (not authenticated) or avatar (authenticated) should be visible
    expect(
      hasLogin || hasAvatar,
      'Header should show login button or user avatar'
    ).toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/auth-header-state.png` });
  });

  test('Auth API: mock Google login creates new user', async ({ request }) => {
    const uniqueId = `e2eauth${Date.now()}`;
    const response = await request.post(`${API_BASE_URL}/auth/google`, {
      data: {
        idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();

    expect(body).toHaveProperty('session');
    expect(body).toHaveProperty('isNewUser', true);
    expect(body.session).toHaveProperty('accessToken');
    expect(body.session).toHaveProperty('refreshToken');
    expect(body.session).toHaveProperty('user');
    expect(body.session.user).toHaveProperty('id');
    expect(body.session.user).toHaveProperty('username');
    expect(body.session.user).toHaveProperty('karma');
    expect(body.session.user).toHaveProperty('karmaRank');
  });

  test('Auth API: /auth/me returns user with valid token', async ({ request }) => {
    const user = await createTestUser(request, 'authme');

    const response = await request.get(`${API_BASE_URL}/auth/me`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty('user');
    expect(body.user.id).toBe(user.userId);
  });

  test('Auth API: /auth/me returns 401 without token', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/auth/me`);
    expect(response.status()).toBe(401);
  });

  test('Auth API: token refresh works', async ({ request }) => {
    const uniqueId = `e2erefresh${Date.now()}`;
    const loginResp = await request.post(`${API_BASE_URL}/auth/google`, {
      data: {
        idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
      },
    });

    const loginBody = await loginResp.json();
    const { refreshToken } = loginBody.session;

    const refreshResp = await request.post(`${API_BASE_URL}/auth/refresh`, {
      data: { refreshToken },
    });

    expect(refreshResp.ok()).toBe(true);
    const refreshBody = await refreshResp.json();
    expect(refreshBody).toHaveProperty('accessToken');
    expect(refreshBody).toHaveProperty('expiresAt');
  });

  test('Auth API: protected endpoints reject unauthenticated requests', async ({ request }) => {
    // Test several protected endpoints
    const protectedEndpoints = [
      { method: 'GET' as const, url: `${API_BASE_URL}/saved-properties` },
      { method: 'GET' as const, url: `${API_BASE_URL}/users/me` },
    ];

    for (const endpoint of protectedEndpoints) {
      const response = await request[endpoint.method.toLowerCase() as 'get'](endpoint.url);
      expect(
        response.status(),
        `${endpoint.method} ${endpoint.url} should return 401`
      ).toBe(401);
    }
  });

  test('Auth API: logout returns 204', async ({ request }) => {
    const uniqueId = `e2elogout${Date.now()}`;
    const loginResp = await request.post(`${API_BASE_URL}/auth/google`, {
      data: {
        idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
      },
    });
    const loginBody = await loginResp.json();
    const { refreshToken } = loginBody.session;

    // Logout should return 204
    const logoutResp = await request.post(`${API_BASE_URL}/auth/logout`, {
      data: { refreshToken },
    });
    expect(logoutResp.status()).toBe(204);
  });
});

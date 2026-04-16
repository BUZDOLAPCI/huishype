/**
 * Auth Flow E2E Tests
 *
 * Tests the web authentication flow:
 * - Profile tab unauthenticated state opens the real AuthModal UI
 * - Auth API endpoints work correctly (google, refresh, me, logout)
 * - Unauthenticated users get 401 on protected routes
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { createTestUser } from './helpers/test-user';
import { getPlaywrightApiUrl, getPlaywrightArtifactPath } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const API_BASE_URL = getPlaywrightApiUrl();
const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.use({ trace: 'off' });

test.describe('Auth Flow', () => {
  let consoleErrors: string[] = [];
  let allowedUnauthorizedConsoleErrors = 0;

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    allowedUnauthorizedConsoleErrors = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/.test(
            text,
          ) &&
          allowedUnauthorizedConsoleErrors > 0
        ) {
          allowedUnauthorizedConsoleErrors -= 1;
          return;
        }
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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

  test('Unauthenticated profile opens the auth modal', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="profile-auth-required"]', { timeout: 30000 });

    const signInButton = page.locator('[data-testid="profile-sign-in-button"]');
    await expect(signInButton).toBeVisible({ timeout: 10000 });
    await signInButton.click();

    const authModal = page.locator('[data-testid="auth-modal-overlay"]');
    await expect(authModal).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Sign in with Google')).toBeVisible();
    await expect(page.getByLabel('Continue with email')).toBeVisible();
    await expect(page.getByLabel('Sign in with Apple')).not.toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/auth-profile-state.png` });
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

  test('Magic link callback: invalid token shows error and home link', async ({ page }) => {
    allowedUnauthorizedConsoleErrors = 1;
    // Use a 64-char hex string so it passes Zod's length(64) schema
    // validation and actually tests the token-lookup failure path.
    await page.goto('/auth/callback?emailToken=deadbeef00000000000000000000000000000000000000000000000000000000');
    await page.waitForLoadState('domcontentloaded');

    // The callback component should initially show a loading/verifying state,
    // then transition to an error state once the API rejects the token.
    // Wait for the error message or "Go to home screen" link to appear.
    const errorOrHome = page.locator('text=/Invalid or expired|Go to home screen/');
    await expect(errorOrHome.first()).toBeVisible({ timeout: 30000 });
    allowedUnauthorizedConsoleErrors = 0;

    // Verify the "Go to home screen" navigation link is present
    const homeLink = page.locator('text=Go to home screen');
    await expect(homeLink).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/auth-magic-link-invalid-token.png` });

    // Click "Go to home screen" and verify navigation away from callback
    await homeLink.click();
    await page.waitForURL((url) => !url.pathname.includes('/auth/callback'), {
      timeout: 30000,
    });
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

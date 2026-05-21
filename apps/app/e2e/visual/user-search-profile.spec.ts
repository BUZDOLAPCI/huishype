import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
} from '../helpers/console';
import { getPlaywrightApiUrl } from '../helpers/runtime';

const API_BASE_URL = getPlaywrightApiUrl();
const SCREENSHOT_DIR = path.join('test-results', 'reference-expectations', 'user-search-profile');

test.use({ trace: 'off', video: 'off' });

test.describe('Profile user search', () => {
  let consoleErrors: string[] = [];

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page, request }) => {
    consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);

    const unique = `usersearch${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const authResponse = await request.post(`${API_BASE_URL}/auth/google`, {
      data: { idToken: `mock-google-e2e${unique}-gid${unique}` },
      timeout: 45_000,
    });
    expect(authResponse.ok()).toBe(true);
    const authBody = await authResponse.json();
    const session = authBody.session as {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: string;
      user: {
        id: string;
        handle?: string;
        displayName?: string;
        karma?: number;
        karmaRank?: string;
        createdAt?: string;
      };
    };

    await page.addInitScript(({ storedSession }) => {
      localStorage.setItem('huishype_access_token', storedSession.accessToken);
      localStorage.setItem('huishype_refresh_token', storedSession.refreshToken);
      localStorage.setItem('huishype_token_expiry', storedSession.expiresAt);
      localStorage.setItem('huishype_user', JSON.stringify(storedSession.user));
    }, {
      storedSession: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken ?? 'e2e-refresh-token',
        expiresAt: session.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        user: {
          id: session.user.id,
          handle: session.user.handle ?? unique,
          username: session.user.handle ?? unique,
          displayName: session.user.displayName ?? 'Search Viewer',
          karma: session.user.karma ?? 0,
          karmaRank: session.user.karmaRank ?? 'Newcomer',
          createdAt: session.user.createdAt ?? new Date().toISOString(),
        },
      },
    });

    await page.route('**/users/search?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'search-target-1',
              displayName: 'Target User',
              handle: 'target-user',
              profilePhotoUrl: null,
              relationship: 'none',
              followerCount: 18,
            },
            {
              id: session.user.id,
              displayName: 'Search Viewer',
              handle: session.user.handle ?? unique,
              profilePhotoUrl: null,
              relationship: 'self',
              followerCount: 2,
            },
          ],
          pagination: { limit: 20, offset: 0, hasMore: false },
        }),
      });
    });
  });

  test.afterEach(() => {
    expectNoConsoleErrors(consoleErrors);
  });

  test('opens user search from profile and renders typed results', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-screen')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('profile-search-user-button').click();
    await expect(page.getByTestId('user-search-screen')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('user-search-input').fill('@target');
    await expect(page.getByTestId('user-search-result-search-target-1')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('@target-user')).toBeVisible();
    await expect(page.getByTestId('user-search-follow-search-target-1')).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'user-search-profile-current.png'),
      fullPage: false,
    });
  });
});

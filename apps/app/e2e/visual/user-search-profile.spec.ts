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
const TARGET_USER_ID = 'a0000000-0000-4000-a000-000000000551';

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
              id: TARGET_USER_ID,
              displayName: 'Target User',
              handle: 'target_user',
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

    await page.route('**/users/by-handle/**/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TARGET_USER_ID,
          displayName: 'Target User',
          handle: 'target_user',
          profilePhotoUrl: null,
          homeCountry: 'NL',
          karma: 64,
          karmaRank: { title: 'Local Expert', level: 4 },
          guessCount: 18,
          commentCount: 7,
          averageAccuracy: 86.4,
          joinedAt: '2026-01-01T00:00:00.000Z',
          followerCount: 22,
          followingCount: 9,
          relationship: 'none',
        }),
      });
    });

    await page.route(`**/users/${TARGET_USER_ID}/achievements`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          earned: [
            {
              key: 'first_guess',
              name: 'First Guess',
              description: 'Submit your first price guess',
              icon: 'Target',
              category: 'guessing',
              awardedAt: '2026-01-03T00:00:00.000Z',
            },
            {
              key: 'karma_50',
              name: 'Trusted Voice',
              description: 'Reached 50 karma points',
              icon: 'Medal',
              category: 'milestone',
              awardedAt: '2026-01-04T00:00:00.000Z',
            },
          ],
        }),
      });
    });

    await page.route(`**/users/${TARGET_USER_ID}/activity?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'a0000000-0000-4000-a000-000000000651',
              eventType: 'price_guess',
              actor: {
                id: TARGET_USER_ID,
                displayName: 'Target User',
                handle: 'target_user',
                profilePhotoUrl: null,
              },
              property: {
                id: 'a0000000-0000-4000-a000-000000000652',
                address: 'Beeldbuisring 41',
                streetName: 'Beeldbuisring',
                houseNumber: 41,
                houseNumberAddition: null,
                city: 'Eindhoven',
                postalCode: '5651HA',
                countryCode: 'NL',
                geometry: null,
                thumbnailUrl: null,
              },
              createdAt: '2026-06-11T10:00:00.000Z',
              meta: null,
            },
            {
              id: 'a0000000-0000-4000-a000-000000000653',
              eventType: 'comment',
              actor: {
                id: TARGET_USER_ID,
                displayName: 'Target User',
                handle: 'target_user',
                profilePhotoUrl: null,
              },
              property: {
                id: 'a0000000-0000-4000-a000-000000000654',
                address: 'Vestdijk 12',
                streetName: 'Vestdijk',
                houseNumber: 12,
                houseNumberAddition: null,
                city: 'Eindhoven',
                postalCode: '5611CC',
                countryCode: 'NL',
                geometry: null,
                thumbnailUrl: null,
              },
              createdAt: '2026-06-10T10:00:00.000Z',
              meta: { contentPreview: 'Useful local detail' },
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
    await expect(page.getByTestId(`user-search-result-${TARGET_USER_ID}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('@target_user')).toBeVisible();
    await expect(page.getByTestId(`user-search-follow-${TARGET_USER_ID}`)).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'user-search-profile-current.png'),
      fullPage: false,
    });
  });

  test('renders public profile reputation surface', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-screen')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('profile-search-user-button').click();
    await expect(page.getByTestId('user-search-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('user-search-input').fill('@target');
    await expect(page.getByTestId(`user-search-result-${TARGET_USER_ID}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Target User/ }).click();

    await expect(page.getByTestId('public-profile-screen')).toBeVisible({ timeout: 30_000 });
    const publicProfile = page.getByTestId('public-profile-screen');
    await expect(publicProfile.getByText('Target User')).toBeVisible();
    await expect(publicProfile.getByText('@target_user')).toBeVisible();
    await expect(publicProfile.getByTestId('public-profile-follow-button')).toBeVisible();
    await expect(publicProfile.getByTestId('profile-stats-card')).toContainText('86%');
    await expect(publicProfile.getByTestId('profile-achievements-section')).toContainText(
      'First Guess'
    );
    await expect(publicProfile.getByTestId('profile-activity-section')).toContainText(
      'Beeldbuisring 41'
    );
    await expect(publicProfile.getByTestId('profile-settings')).toHaveCount(0);
    await expect(publicProfile.getByTestId('profile-avatar-edit')).toHaveCount(0);
    await expect(publicProfile.getByTestId('profile-followers-link')).toHaveCount(0);

    const declineAnalytics = page.getByRole('button', { name: 'Decline' });
    if (await declineAnalytics.isVisible().catch(() => false)) {
      await declineAnalytics.click();
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'public-profile-reputation-current.png'),
      fullPage: true,
    });
  });
});

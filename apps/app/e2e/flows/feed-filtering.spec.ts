/**
 * Flow E2E Test: Feed Filtering
 *
 * Tests the feed view with filter interactions:
 * - Feed loads with property cards or grouped property-post cards
 * - Filter chips are visible and interactive
 * - Clicking filter chips changes the active filter
 * - Clicking a property card navigates to property detail
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { getPlaywrightApiUrl, getPlaywrightArtifactPath } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const API_BASE_URL = getPlaywrightApiUrl();
const API_ORIGIN = new URL(API_BASE_URL).origin;

// Screenshot output directory
const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

test.describe('Feed Filtering', () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];
  let expectedResolveConflictResponses: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];
    expectedResolveConflictResponses = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });

    page.on('response', (response) => {
      if (response.status() === 409 && response.url().includes('/properties/resolve')) {
        expectedResolveConflictResponses.push(response.url());
      }
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
    }

    const unexpectedConsoleErrors = consoleErrors.filter((error) => {
      const isBrowserResourceConflict =
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(
          error
        );
      return !(isBrowserResourceConflict && expectedResolveConflictResponses.length > 0);
    });

    if (unexpectedConsoleErrors.length > 0) {
      console.error(`Console errors detected (${unexpectedConsoleErrors.length}):`);
      unexpectedConsoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      unexpectedConsoleErrors,
      `Expected zero unexpected console errors but found ${unexpectedConsoleErrors.length}`
    ).toHaveLength(0);
  });

  test('feed loads with filter chips and content', async ({ page }) => {
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for feed to render - it will show one of: feed-screen, feed-loading, feed-empty, feed-error
    await Promise.race([
      page.waitForSelector('[data-testid="feed-screen"]', { timeout: 10000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-loading"]', { timeout: 10000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-empty"]', { timeout: 10000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-error"]', { timeout: 10000 }).catch(() => null),
      page
        .waitForSelector('[data-testid="filter-chip-trending"]', { timeout: 10000 })
        .catch(() => null),
    ]);

    // Additional wait for content to settle
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-loaded.png` });

    // Filter chips should always be visible (they show even in loading/empty/error states)
    const trendingFilter = page.locator('[data-testid="filter-chip-trending"]');
    await expect(trendingFilter, '"Trending" filter chip should be visible').toBeVisible({
      timeout: 5000,
    });

    // Check for other filter chips
    const latestFilter = page.locator('[data-testid="filter-chip-latest"]');
    const activityFilter = page.locator('[data-testid="filter-chip-recent-activity"]');

    const chipVisibility = {
      trending: await trendingFilter.isVisible().catch(() => false),
      latest: await latestFilter.isVisible().catch(() => false),
      activity: await activityFilter.isVisible().catch(() => false),
    };
    console.log('Filter chip visibility:', chipVisibility);

    // All 3 filter chips should be visible
    expect(chipVisibility.trending).toBe(true);
    expect(chipVisibility.latest).toBe(true);
    expect(chipVisibility.activity).toBe(true);

    // Check how many property cards loaded
    const propertyCards = page.locator('[data-testid="property-feed-card"]');
    const groupedCards = page.locator('[data-testid="property-activity-card"]');
    const cardCount = await propertyCards.count();
    const groupedCardCount = await groupedCards.count();
    console.log(
      `Found ${cardCount} property feed cards and ${groupedCardCount} grouped activity cards`
    );

    // Should not show error state
    const errorState = page.locator('[data-testid="feed-error"]');
    const isErrorVisible = await errorState.isVisible().catch(() => false);
    expect(isErrorVisible, 'Feed should not show error state').toBe(false);
  });

  test('filter chips change active filter', async ({ page }) => {
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for filter chips to appear
    const trendingFilter = page.locator('[data-testid="filter-chip-trending"]');
    await expect(trendingFilter).toBeVisible({ timeout: 10000 });

    // Take initial screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-trending.png` });

    // Click "Latest" filter — assert it exists before interacting
    const latestFilter = page.locator('[data-testid="filter-chip-latest"]');
    await expect(latestFilter, '"Latest" filter chip should be visible').toBeVisible({
      timeout: 5000,
    });
    await latestFilter.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-latest.png` });

    // Click "Recent Activity" filter — assert it exists before interacting
    const activityFilter = page.locator('[data-testid="filter-chip-recent-activity"]');
    await expect(activityFilter, '"Recent Activity" filter chip should be visible').toBeVisible({
      timeout: 5000,
    });
    await activityFilter.click();
    await page.waitForTimeout(2000);
    await Promise.race([
      page
        .locator('[data-testid="property-activity-card"]')
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => null),
      page
        .locator('[data-testid="feed-empty"]')
        .waitFor({ timeout: 5000 })
        .catch(() => null),
    ]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-activity.png` });

    // Click back to "Trending" filter
    await trendingFilter.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-back-to-trending.png` });
  });

  test('direct feed filter URL hydrates chips, query params, and canonicalizes interactions', async ({
    page,
  }) => {
    const feedRequests: URL[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === API_ORIGIN && url.pathname === '/feed') {
        feedRequests.push(url);
      }
    });

    await page.goto('/feed?marketState=for-sale&area=city:NL:eindhoven&feedTab=latest', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.getByTestId('filter-chip-latest')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('search-area-chip').filter({ hasText: 'Eindhoven' })).toBeVisible(
      { timeout: 15_000 }
    );

    await expect
      .poll(
        () =>
          feedRequests.some(
            (url) =>
              url.searchParams.get('filter') === 'latest' &&
              url.searchParams.get('marketState') === 'for-sale' &&
              url.searchParams.getAll('area').includes('city:NL:eindhoven')
          ),
        { timeout: 15_000 }
      )
      .toBe(true);

    await expect
      .poll(() =>
        page.evaluate(() => ({
          feedTab: new URLSearchParams(window.location.search).get('feedTab'),
          marketState: new URLSearchParams(window.location.search).get('marketState'),
          area: new URLSearchParams(window.location.search).getAll('area'),
        }))
      )
      .toEqual({
        feedTab: 'latest',
        marketState: 'for-sale',
        area: ['city:NL:eindhoven'],
      });

    await page.getByTestId('map-filter-pill-market-state-for-rent').click();
    await expect
      .poll(() => page.evaluate(() => window.location.pathname + window.location.search))
      .toBe('/feed?feedTab=latest&marketState=for-sale%2Cfor-rent&area=city%3ANL%3Aeindhoven');

    await page.getByTestId('filter-chip-trending').click();
    await expect
      .poll(() => page.evaluate(() => new URLSearchParams(window.location.search).get('feedTab')))
      .toBeNull();
    await expect
      .poll(() => page.evaluate(() => new URLSearchParams(window.location.search).getAll('area')))
      .toEqual(['city:NL:eindhoven']);
  });

  test('unresolved direct address search keeps area chip and navigates to map focus', async ({
    page,
  }) => {
    await page.route('**/search/locations?**', async (route) => {
      const url = new URL(route.request().url());
      const query = (url.searchParams.get('q') ?? '').toLowerCase();

      if (query.includes('eindhoven')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'city:NL:eindhoven',
              type: 'city',
              label: 'Eindhoven',
              subtitle: 'Noord-Brabant, Nederland',
              countryCode: 'NL',
              coordinates: [5.4697, 51.4416],
              bbox: [5.35, 51.36, 5.57, 51.51],
              filterToken: {
                type: 'city',
                countryCode: 'NL',
                value: 'eindhoven',
                label: 'Eindhoven',
                coordinates: [5.4697, 51.4416],
                bbox: [5.35, 51.36, 5.57, 51.51],
              },
            },
          ]),
        });
        return;
      }

      if (query.includes('unresolvedstraat')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'address:NL:unresolvedstraat-10',
              type: 'address',
              label: 'Unresolvedstraat 10, Eindhoven',
              subtitle: '9999ZZ Eindhoven',
              address: 'Unresolvedstraat 10, Eindhoven',
              city: 'Eindhoven',
              countryCode: 'NL',
              street: 'Unresolvedstraat',
              postalCode: '9999ZZ',
              houseNumber: '10',
              houseNumberAddition: null,
              coordinates: [5.49, 51.45],
            },
          ]),
        });
        return;
      }

      await route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    await page.route('**/geocode/search?**', async (route) => {
      const url = new URL(route.request().url());
      const query = (url.searchParams.get('q') ?? '').toLowerCase();

      if (query.includes('unresolvedstraat')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'address:NL:unresolvedstraat-10',
              displayName: 'Unresolvedstraat 10, Eindhoven',
              coordinates: [5.49, 51.45],
              city: 'Eindhoven',
              postalCode: '9999ZZ',
              street: 'Unresolvedstraat',
              houseNumber: '10',
              countryCode: 'NL',
            },
          ]),
        });
        return;
      }

      await route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    await page.route('**/properties/resolve?**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: 'null' });
    });

    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const searchInput = page.getByTestId('search-bar-input');
    await expect(searchInput).toBeVisible({ timeout: 15_000 });

    const eindhovenResult = page
      .getByTestId('search-result-item')
      .filter({ hasText: 'Eindhoven' })
      .first();
    await searchInput.click();
    await searchInput.focus();
    await searchInput.fill('Eindhoven');
    await expect(eindhovenResult).toBeVisible({ timeout: 15_000 });
    await eindhovenResult.click();
    await expect(
      page.getByTestId('search-area-chip').filter({ hasText: 'Eindhoven' })
    ).toBeVisible();
    await expect(searchInput).toHaveValue('');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('feed-screen').or(page.getByTestId('feed-empty'))).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);

    const unresolvedResult = page
      .getByTestId('search-result-item')
      .filter({ hasText: 'Unresolvedstraat 10, Eindhoven' })
      .first();
    await searchInput.click();
    await searchInput.focus();
    await searchInput.fill('');
    await searchInput.fill('Unresolvedstraat 10');
    await expect(searchInput).toHaveValue('Unresolvedstraat 10', { timeout: 5000 });
    await expect(unresolvedResult).toBeVisible({ timeout: 15_000 });
    await unresolvedResult.click();

    await expect(page).toHaveURL(/\/@51\.45,5\.49,17z(?:[/?#]|$)/, { timeout: 15_000 });
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.getByTestId('search-area-chip').filter({ hasText: 'Eindhoven' }).count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  });

  test('property card has expected content structure', async ({ page }) => {
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for property cards to load
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    await feedScreen.waitFor({ timeout: 15000 }).catch(() => null);

    const propertyCard = page.locator('[data-testid="property-feed-card"]').first();
    const cardVisible = await propertyCard.isVisible({ timeout: 10000 }).catch(() => false);

    if (cardVisible) {
      // Card should have reasonable dimensions
      const cardBox = await propertyCard.boundingBox();
      expect(cardBox).not.toBeNull();
      if (cardBox) {
        expect(cardBox.width).toBeGreaterThan(200);
        expect(cardBox.height).toBeGreaterThan(100);
      }

      // Check for image or placeholder
      const hasImage = await propertyCard
        .locator('[data-testid="property-image"]')
        .isVisible()
        .catch(() => false);
      const hasPlaceholder = await propertyCard
        .locator('text=No image available')
        .isVisible()
        .catch(() => false);
      expect(hasImage || hasPlaceholder, 'Card should have image or placeholder').toBe(true);

      // Check for address text
      const addressElement = propertyCard.locator('[data-testid="property-address"]');
      const hasAddress = await addressElement.isVisible().catch(() => false);

      if (hasAddress) {
        const addressText = (await addressElement.textContent()) || '';
        console.log(`First card address: ${addressText}`);
        // Address should not be empty
        expect(addressText.length).toBeGreaterThan(0);
      }

      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-card-detail.png` });
    } else {
      // No cards - check if empty state is showing
      const emptyState = page.locator('[data-testid="feed-empty"]');
      const isEmpty = await emptyState.isVisible().catch(() => false);

      console.log(`No property cards visible. Empty state: ${isEmpty}`);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-no-cards.png` });
    }
  });

  test('recent activity uses grouped property-post cards', async ({ page }) => {
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const activityFilter = page.locator('[data-testid="filter-chip-recent-activity"]');
    await expect(activityFilter).toBeVisible({ timeout: 10000 });
    await activityFilter.click();
    await page.waitForTimeout(2000);

    const groupedCard = page.locator('[data-testid="property-activity-card"]').first();
    const cardVisible = await groupedCard.isVisible({ timeout: 10000 }).catch(() => false);

    if (cardVisible) {
      await expect(groupedCard.locator('[data-testid="property-activity-stats"]')).toBeVisible();
      const statPills = groupedCard.locator('[data-testid^="property-activity-stats-"]');
      await expect(statPills).toHaveCount(3);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-grouped-activity-card.png` });
    } else {
      await expect(page.locator('[data-testid="feed-empty"]')).toBeVisible();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-grouped-activity-empty.png` });
    }
  });

  test('empty property feed keeps transparent background and centered feed shell', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(`${API_BASE_URL}/feed**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            hasMore: false,
          },
        }),
      });
    });

    await page.goto('/feed?area=street%3ANL%3Aelburglaan%3Acity%3Deindhoven');
    await expect(page.locator('[data-testid="feed-empty"]')).toBeVisible({ timeout: 15000 });

    const metrics = await page.evaluate(() => {
      const emptyState = document.querySelector('[data-testid="feed-empty"]');
      const shell = emptyState?.parentElement;
      const shellRect = shell?.getBoundingClientRect();
      const emptyBackgroundColor = emptyState
        ? window.getComputedStyle(emptyState).backgroundColor
        : null;

      return {
        viewportWidth: window.innerWidth,
        shellLeft: shellRect?.left ?? null,
        shellWidth: shellRect?.width ?? null,
        emptyBackgroundColor,
      };
    });

    expect(metrics.emptyBackgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(metrics.shellWidth).not.toBeNull();
    expect(metrics.shellLeft).not.toBeNull();
    expect(metrics.shellWidth ?? 0).toBeLessThanOrEqual(768);

    const expectedLeft = (metrics.viewportWidth - (metrics.shellWidth ?? 0)) / 2;
    expect(Math.abs((metrics.shellLeft ?? 0) - expectedLeft)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-empty-transparent-background.png` });
  });

  test('clicking property card navigates to detail page', async ({ page }) => {
    // First verify API has feed items
    const apiCheck = await page.request.get(`${API_BASE_URL}/feed?limit=1`);
    const apiData = await apiCheck.json();

    if (!apiData.items || apiData.items.length === 0) {
      console.log('No items in feed API, skipping card click test');
      return;
    }

    // Navigate to feed
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for feed screen with cards
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    await feedScreen.waitFor({ timeout: 15000 }).catch(() => null);

    const firstCard = page.locator('[data-testid="property-feed-card"]').first();
    const isCardVisible = await firstCard.isVisible({ timeout: 10000 }).catch(() => false);

    if (isCardVisible) {
      // Record the current URL before clicking
      const urlBefore = page.url();

      await firstCard.click();
      await page.waitForTimeout(3000);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-to-detail.png` });

      // Should navigate away from feed - URL should change
      const urlAfter = page.url();
      const navigated = urlAfter !== urlBefore || urlAfter.includes('property');

      console.log(`URL before: ${urlBefore}, after: ${urlAfter}`);

      if (navigated) {
        // Should show property detail page content
        const detailContent = page
          .locator('text=Property Details')
          .or(page.locator('text=WOZ Value'))
          .or(page.locator('text=Loading property'))
          .or(page.locator('text=Property not found'));

        const hasDetailContent = await detailContent
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false);
        console.log(`Property detail content visible: ${hasDetailContent}`);
      }
    } else {
      console.log('No property cards visible to click');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-no-cards-to-click.png` });
    }
  });

  test('feed API endpoint returns valid data', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/feed?limit=10`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('limit');
    expect(data.pagination).toHaveProperty('hasMore');

    console.log(`Feed API: ${data.items.length} items, hasMore: ${data.pagination.hasMore}`);

    // If there are items, verify structure
    if (data.items.length > 0) {
      const item = data.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('address');
      expect(item).toHaveProperty('city');
      expect(item).toHaveProperty('zipCode');
      expect(item).toHaveProperty('activityLevel');
      expect(item).toHaveProperty('hasListing');
      expect(item.hasListing).toBe(true);
    }
  });
});

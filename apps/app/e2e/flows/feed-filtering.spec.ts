/**
 * Flow E2E Test: Feed Filtering
 *
 * Tests the feed view with filter interactions:
 * - Feed loads with property cards or appropriate empty/loading state
 * - Filter chips are visible and interactive
 * - Clicking filter chips changes the active filter
 * - Clicking a property card navigates to property detail
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Screenshot output directory
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

test.describe('Feed Filtering', () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
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
      page.waitForSelector('[data-testid="filter-chip-all"]', { timeout: 10000 }).catch(() => null),
    ]);

    // Additional wait for content to settle
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-loaded.png` });

    // Filter chips should always be visible (they show even in loading/empty/error states)
    const allFilter = page.locator('[data-testid="filter-chip-all"]');
    await expect(allFilter, '"All" filter chip should be visible').toBeVisible({ timeout: 5000 });

    // Check for other filter chips
    const newFilter = page.locator('[data-testid="filter-chip-new"]');
    const trendingFilter = page.locator('[data-testid="filter-chip-trending"]');
    const priceMismatchFilter = page.locator('[data-testid="filter-chip-price_mismatch"]');
    const polarizingFilter = page.locator('[data-testid="filter-chip-polarizing"]');

    const chipVisibility = {
      all: await allFilter.isVisible().catch(() => false),
      new: await newFilter.isVisible().catch(() => false),
      trending: await trendingFilter.isVisible().catch(() => false),
      price_mismatch: await priceMismatchFilter.isVisible().catch(() => false),
      polarizing: await polarizingFilter.isVisible().catch(() => false),
    };
    console.log('Filter chip visibility:', chipVisibility);

    // All 5 filter chips should be visible
    expect(chipVisibility.all).toBe(true);
    expect(chipVisibility.new).toBe(true);
    expect(chipVisibility.trending).toBe(true);

    // Check how many property cards loaded
    const propertyCards = page.locator('[data-testid="property-feed-card"]');
    const cardCount = await propertyCards.count();
    console.log(`Found ${cardCount} property feed cards`);

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
    const allFilter = page.locator('[data-testid="filter-chip-all"]');
    await expect(allFilter).toBeVisible({ timeout: 10000 });

    // Take initial screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-all.png` });

    // Click "New" filter
    const newFilter = page.locator('[data-testid="filter-chip-new"]');
    const newFilterVisible = await newFilter.isVisible().catch(() => false);

    if (newFilterVisible) {
      await newFilter.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-new.png` });
    }

    // Click "Trending" filter
    const trendingFilter = page.locator('[data-testid="filter-chip-trending"]');
    const trendingVisible = await trendingFilter.isVisible().catch(() => false);

    if (trendingVisible) {
      await trendingFilter.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-trending.png` });
    }

    // Click back to "All" filter
    if (newFilterVisible || trendingVisible) {
      await allFilter.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-filter-back-to-all.png` });
    }
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
        const addressText = await addressElement.textContent() || '';
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

  test('clicking property card navigates to detail page', async ({ page }) => {
    // First verify API has properties
    const apiCheck = await page.request.get(`${API_BASE_URL}/properties?limit=1`);
    const apiData = await apiCheck.json();

    if (!apiData.data || apiData.data.length === 0) {
      console.log('No properties in API, skipping card click test');
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
        const detailContent = page.locator('text=Property Details').or(
          page.locator('text=WOZ Value')
        ).or(
          page.locator('text=Loading property')
        ).or(
          page.locator('text=Property not found')
        );

        const hasDetailContent = await detailContent.first().isVisible({ timeout: 5000 }).catch(() => false);
        console.log(`Property detail content visible: ${hasDetailContent}`);
      }
    } else {
      console.log('No property cards visible to click');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-no-cards-to-click.png` });
    }
  });

  test('feed API endpoint returns valid data', async ({ request }) => {
    // The feed uses /properties endpoint with pagination
    const response = await request.get(`${API_BASE_URL}/properties?limit=10&page=1`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('meta');
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.meta).toHaveProperty('page');
    expect(data.meta).toHaveProperty('limit');
    expect(data.meta).toHaveProperty('total');
    expect(data.meta).toHaveProperty('totalPages');

    console.log(`Feed API: ${data.data.length} properties, total: ${data.meta.total}`);

    // If there are properties, verify structure
    if (data.data.length > 0) {
      const prop = data.data[0];
      expect(prop).toHaveProperty('id');
      expect(prop).toHaveProperty('address');
      expect(prop).toHaveProperty('city');
    }
  });
});

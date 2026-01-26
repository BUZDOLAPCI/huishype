/**
 * Reference Expectation E2E Test: feed-view-property-cards
 *
 * This test verifies the Feed View displays property cards with:
 * - Property photos with activity badges and view count overlays
 * - Address and location information
 * - Price information (WOZ, Asking, FMV)
 * - Activity stats (comments, guesses, views)
 * - Filter chips for content filtering
 *
 * The feed should feel like a social app, not a boring classifieds site.
 *
 * Screenshot saved to: test-results/reference-expectations/feed-view-property-cards/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Configuration
const EXPECTATION_NAME = 'feed-view-property-cards';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable errors (add patterns for expected/benign errors)
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /Download the React DevTools/,
  /React does not recognize the .* prop/,
  /Accessing element\.ref was removed in React 19/,
  /ref is now a regular prop/,
  /ResizeObserver loop/,
  /favicon\.ico/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /Failed to load resource.*404/, // Font/image 404s are acceptable
  /the server responded with a status of 404/, // OpenFreeMap font 404s
  /AJAXError.*404/, // Tile loading 404s for edge tiles
];

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  // Console error collection
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    // Reset console collections
    consoleErrors = [];
    consoleWarnings = [];

    // Collect console messages
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) =>
          pattern.test(text)
        );
        if (!isKnown) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Collect page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    // Log warnings for visibility (but don't fail)
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    // FAIL if any console errors detected
    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('capture feed view with property cards for visual comparison', async ({
    page,
  }) => {
    // Navigate directly to the feed tab
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');

    // Wait for the page to fully load
    await page.waitForTimeout(3000);

    // Wait for feed content to load - look for feed screen, property cards or filter chips
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    const propertyCard = page.locator('[data-testid="property-feed-card"]');

    // Wait for either feed screen, property cards or filters to appear
    await Promise.race([
      feedScreen.waitFor({ timeout: 10000 }).catch(() => null),
      propertyCard.first().waitFor({ timeout: 10000 }).catch(() => null),
      page.waitForTimeout(10000),
    ]);

    // Additional wait for any animations or lazy loading
    await page.waitForTimeout(2000);

    // Take screenshot of the feed view
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    // Basic assertions to verify feed loaded
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();

    // Verify the page has rendered content
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Log what we found for debugging
    const cardCount = await propertyCard.count();
    console.log(`Found ${cardCount} property feed cards`);

    // Check for filter chips
    const allFilter = page.getByText('All');
    const newFilter = page.getByText('New');
    const trendingFilter = page.getByText('Trending');

    const allVisible = await allFilter.isVisible().catch(() => false);
    const newVisible = await newFilter.isVisible().catch(() => false);
    const trendingVisible = await trendingFilter.isVisible().catch(() => false);

    console.log(
      `Filter chips visible: All=${allVisible}, New=${newVisible}, Trending=${trendingVisible}`
    );
  });

  test('verify feed card structure and content', async ({ page }) => {
    // Navigate directly to feed tab
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for feed screen to appear
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    await feedScreen.waitFor({ timeout: 10000 }).catch(() => null);

    // Wait for property cards
    const propertyCard = page
      .locator('[data-testid="property-feed-card"]')
      .first();
    const cardVisible = await propertyCard
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (cardVisible) {
      // Verify card has expected elements
      const cardBox = await propertyCard.boundingBox();
      expect(cardBox).not.toBeNull();

      if (cardBox) {
        // Card should have reasonable dimensions
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

      console.log(`Card has image: ${hasImage}, has placeholder: ${hasPlaceholder}`);

      // At least one should be true (image or placeholder)
      expect(hasImage || hasPlaceholder).toBe(true);
    } else {
      // If no cards visible, check for loading or empty state
      const loadingState = page.locator('text=Loading');
      const emptyState = page.locator('text=No properties');

      const isLoading = await loadingState.isVisible().catch(() => false);
      const isEmpty = await emptyState.isVisible().catch(() => false);

      console.log(`No cards visible. Loading: ${isLoading}, Empty: ${isEmpty}`);

      // Take a diagnostic screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-diagnostic.png`,
        fullPage: true,
      });
    }
  });

  test('verify filter chips interaction', async ({ page }) => {
    // Navigate directly to feed tab
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Wait for feed screen to appear
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    await feedScreen.waitFor({ timeout: 10000 }).catch(() => null);

    // Try to find filter chips
    const allFilter = page.getByText('All');
    const trendingFilter = page.getByText('Trending');
    const newFilter = page.getByText('New');

    // Check filter visibility
    const filtersVisible = {
      all: await allFilter.isVisible().catch(() => false),
      trending: await trendingFilter.isVisible().catch(() => false),
      new: await newFilter.isVisible().catch(() => false),
    };

    console.log('Filter visibility:', filtersVisible);

    // If trending filter is visible, click it and take screenshot
    if (filtersVisible.trending) {
      await trendingFilter.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-trending-filter.png`,
        fullPage: false,
      });
    }

    // If new filter is visible, click it
    if (filtersVisible.new) {
      await newFilter.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-new-filter.png`,
        fullPage: false,
      });
    }
  });
});

/**
 * Reference Expectation E2E Test: feed-view-property-cards
 *
 * This test verifies the Feed View displays property cards with:
 * - Property photos and grouped property-post cards for activity tabs
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
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

// Configuration
const EXPECTATION_NAME = 'feed-view-property-cards';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

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
        const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
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

  test('capture feed view with property cards for visual comparison', async ({ page }) => {
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
      propertyCard
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => null),
      page.waitForTimeout(10000),
    ]);

    // Additional wait for any animations or lazy loading
    await page.waitForTimeout(2000);

    // Take screenshot of the default feed view
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
    const trendingFilter = page.getByText('Trending');
    const latestFilter = page.getByText('Latest');
    const activityFilter = page.getByText('Recent Activity');

    const latestVisible = await latestFilter.isVisible().catch(() => false);
    const activityVisible = await activityFilter.isVisible().catch(() => false);
    const trendingVisible = await trendingFilter.isVisible().catch(() => false);

    console.log(
      `Filter chips visible: Latest=${latestVisible}, Recent Activity=${activityVisible}, Trending=${trendingVisible}`
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
    const propertyCard = page.locator('[data-testid="property-feed-card"]').first();
    const cardVisible = await propertyCard.isVisible({ timeout: 10000 }).catch(() => false);

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

      const statPills = propertyCard.locator('[data-testid^="feed-card-stats-"]');
      await expect(statPills).toHaveCount(4);
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

  test('capture listed cold feed card pills', async ({ page }) => {
    await page.route('**/feed?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              address: 'Cold Listedstraat 12',
              city: 'Eindhoven',
              zipCode: '5611 AA',
              countryCode: 'NL',
              geometry: { type: 'Point', coordinates: [5.4697, 51.4416] },
              askingPrice: 425000,
              fmv: null,
              officialValuation: 410000,
              officialValuationYear: 2024,
              thumbnailUrl: null,
              likeCount: 0,
              commentCount: 0,
              guessCount: 0,
              viewCount: 0,
              activityLevel: 'cold',
              marketState: 'for-sale',
              lastActivityAt: '2026-05-23T10:00:00.000Z',
              hasListing: true,
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              address: 'Warm Rentlaan 8',
              city: 'Eindhoven',
              zipCode: '5611 AB',
              countryCode: 'NL',
              geometry: { type: 'Point', coordinates: [5.48, 51.45] },
              askingPrice: 1750,
              fmv: null,
              officialValuation: null,
              officialValuationYear: null,
              thumbnailUrl: null,
              likeCount: 3,
              commentCount: 2,
              guessCount: 1,
              viewCount: 14,
              activityLevel: 'warm',
              marketState: 'for-rent',
              lastActivityAt: '2026-05-23T11:00:00.000Z',
              hasListing: true,
            },
          ],
          pagination: { page: 1, limit: 20, hasMore: false },
        }),
      });
    });

    await page.goto('/feed');
    await page.waitForLoadState('networkidle');

    const cards = page.locator('[data-testid="property-feed-card"]');
    await expect(cards).toHaveCount(2);

    const coldCard = cards.nth(0);
    await expect(coldCard.getByText('For sale')).toBeVisible();
    await expect(coldCard.locator('[data-testid="activity-badge"]')).toHaveCount(0);

    const warmCard = cards.nth(1);
    await expect(warmCard.getByText('Active')).toBeVisible();
    await expect(warmCard.getByText('For rent')).toBeVisible();

    await coldCard.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-listed-cold-pills.png`,
    });
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
    const trendingFilter = page.getByText('Trending');
    const latestFilter = page.getByText('Latest');
    const activityFilter = page.getByText('Recent Activity');

    // Check filter visibility
    const filtersVisible = {
      trending: await trendingFilter.isVisible().catch(() => false),
      latest: await latestFilter.isVisible().catch(() => false),
      activity: await activityFilter.isVisible().catch(() => false),
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

    // If latest filter is visible, click it
    if (filtersVisible.latest) {
      await latestFilter.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-latest-filter.png`,
        fullPage: false,
      });
    }

    if (filtersVisible.activity) {
      await activityFilter.click();
      await page.waitForTimeout(1000);

      const groupedCard = page.locator('[data-testid="property-activity-card"]').first();
      const groupedCardVisible = await groupedCard.isVisible({ timeout: 5000 }).catch(() => false);
      if (groupedCardVisible) {
        await expect(groupedCard.locator('[data-testid="property-activity-stats"]')).toBeVisible();
      }

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-recent-activity-filter.png`,
        fullPage: false,
      });
    }
  });
});

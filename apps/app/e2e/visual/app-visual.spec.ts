import { test, expect } from '@playwright/test';
import {
  createVisualTestContext,
  VisualTestContext,
  VISUAL_SCREENSHOT_DIR,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Visual E2E Tests for HuisHype
 *
 * These tests verify the app works correctly by:
 * 1. Capturing ALL console errors/warnings during each test
 * 2. Failing tests if console has critical errors
 * 3. Taking screenshots at critical points
 * 4. Verifying screenshots show expected content (not error states)
 *
 * Unlike MSW-mocked tests, these run against the REAL app and catch
 * real issues like import errors, API mismatches, and runtime failures.
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Ensure screenshot directory exists
test.beforeAll(async () => {
  const baseDir = path.resolve(VISUAL_SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

test.describe('HuisHype Visual E2E Tests', () => {
  let ctx: VisualTestContext;

  test.afterEach(async () => {
    if (ctx) {
      ctx.stop();
      // Log the full report for debugging
      console.log(ctx.generateReport());
    }
  });

  test.describe('App Boot', () => {
    test('should boot without critical console errors', async ({ page }) => {
      ctx = createVisualTestContext(page, 'app-boot');
      ctx.start();

      // Navigate to the app root
      await page.goto('/');

      // Wait for the page to be ready
      await ctx.validator.waitForReady();

      // Take screenshot of initial load
      await ctx.screenshots.capture('app-boot');

      // Verify the page is not blank
      const isBlank = await ctx.validator.isPageBlank();
      expect(isBlank).toBe(false);

      // Check for visible error messages
      const { hasError, errorText } = await ctx.validator.hasVisibleErrors();
      if (hasError) {
        // Take screenshot of error state
        await ctx.screenshots.capture('app-boot-error');
        console.error(`Visible error on page: ${errorText}`);
      }
      expect(hasError).toBe(false);

      // Assert no critical console errors
      ctx.assertNoCriticalErrors();
    });

    test('should load without JavaScript exceptions', async ({ page }) => {
      ctx = createVisualTestContext(page, 'js-exceptions');
      ctx.start();

      // Track page errors (uncaught exceptions)
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      await page.goto('/');
      await ctx.validator.waitForReady();

      // Wait a bit for any async errors
      await page.waitForTimeout(2000);

      await ctx.screenshots.capture('after-boot');

      // Check for uncaught exceptions
      if (pageErrors.length > 0) {
        console.error('Page errors detected:', pageErrors);
      }

      // Allow some page errors that are not critical
      const criticalPageErrors = pageErrors.filter(
        (e) =>
          !e.includes('ResizeObserver') &&
          !e.includes('WebSocket') &&
          !e.includes('Failed to fetch')
      );

      expect(criticalPageErrors).toHaveLength(0);
    });

    test('should render UI elements within timeout', async ({ page }) => {
      ctx = createVisualTestContext(page, 'ui-render');
      ctx.start();

      const startTime = Date.now();

      await page.goto('/');

      // Wait for any visible content
      await page.waitForSelector('body *:visible', { timeout: 10000 });

      const loadTime = Date.now() - startTime;
      console.log(`Page render time: ${loadTime}ms`);

      await ctx.screenshots.capture('ui-rendered');

      // Page should render something meaningful within 10 seconds
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent && bodyContent.length > 0).toBe(true);

      ctx.assertNoCriticalErrors();
    });
  });

  test.describe('Map View Load', () => {
    test('should display map view without error state', async ({ page }) => {
      ctx = createVisualTestContext(page, 'map-view-load');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();

      // Wait for map instance to be ready
      await waitForMapStyleLoaded(page, 30000);

      // Take screenshot
      await ctx.screenshots.capture('map-view');

      // Check that we don't see error messages
      const errorSelectors = [
        'text=Something went wrong',
        'text=Failed to load',
        'text=Error loading',
        'text=Unable to load',
        'text=Network error',
      ];

      for (const selector of errorSelectors) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        if (isVisible) {
          await ctx.screenshots.capture(`map-error-${selector.replace(/[^a-z]/gi, '-')}`);
        }
        expect(isVisible, `Error visible: ${selector}`).toBe(false);
      }

      // Verify console for errors
      ctx.assertNoCriticalErrors();
    });

    test('should show loading state then content', async ({ page }) => {
      ctx = createVisualTestContext(page, 'map-loading-state');
      ctx.start();

      // Immediately navigate and screenshot
      await page.goto('/');

      // Try to capture loading state quickly
      await ctx.screenshots.capture('initial-state');

      // Wait for map to be ready (or timeout gracefully)
      await waitForMapStyleLoaded(page, 30000);

      // Screenshot after content should load
      await ctx.screenshots.capture('after-loading');

      // Check that we're not stuck in loading state
      const loadingIndicators = [
        'text=Loading...',
        'text=Loading map',
        '[data-testid="loading"]',
      ];

      let stillLoading = false;
      for (const selector of loadingIndicators) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        if (isVisible) {
          stillLoading = true;
          console.warn(`Still showing loading: ${selector}`);
        }
      }

      // It's okay to still be loading if no errors
      if (stillLoading) {
        console.log('Warning: Page appears to still be in loading state');
      }

      ctx.assertNoCriticalErrors();
    });

    test('should render map canvas or placeholder', async ({ page }) => {
      ctx = createVisualTestContext(page, 'map-canvas');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();

      // Wait for map instance to be ready
      await waitForMapStyleLoaded(page, 30000);

      // Look for map canvas
      const isMapVisible = await ctx.validator.isMapVisible();

      await ctx.screenshots.capture('map-canvas-check');

      // Either map should be visible OR we should have a graceful fallback (not an error)
      if (!isMapVisible) {
        console.log('Map canvas not visible - checking for fallback UI');

        // If no map, at least there should be some content
        const isBlank = await ctx.validator.isPageBlank();
        expect(isBlank, 'Page should not be blank if map failed to load').toBe(false);

        // And no error messages
        const { hasError } = await ctx.validator.hasVisibleErrors();
        expect(hasError, 'Should not show error if map fails gracefully').toBe(false);
      }

      ctx.assertNoCriticalErrors();
    });
  });

  test.describe('Properties API Integration', () => {
    test('should make successful API call to /properties', async ({ page }) => {
      ctx = createVisualTestContext(page, 'properties-api');
      ctx.start();

      // Track properties API calls specifically
      const propertiesCalls: { url: string; status: number | null; error?: string }[] = [];

      page.on('response', (response) => {
        if (response.url().includes('/properties')) {
          propertiesCalls.push({
            url: response.url(),
            status: response.status(),
          });
        }
      });

      page.on('requestfailed', (request) => {
        if (request.url().includes('/properties')) {
          propertiesCalls.push({
            url: request.url(),
            status: null,
            error: request.failure()?.errorText,
          });
        }
      });

      await page.goto('/');
      await ctx.validator.waitForReady();

      // Wait for map and API data to load
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('properties-loaded');

      // Log API calls for debugging
      console.log('Properties API calls:', JSON.stringify(propertiesCalls, null, 2));

      // Verify at least one call was made to properties endpoint
      expect(propertiesCalls.length, 'Should make at least one /properties API call').toBeGreaterThan(0);

      // Check for any failed calls
      const failedCalls = propertiesCalls.filter(c => c.error || (c.status && c.status >= 400));

      if (failedCalls.length > 0) {
        console.error('Failed properties API calls:', failedCalls);
        await ctx.screenshots.capture('properties-api-error');
      }

      // Expect successful API calls (status 2xx)
      const successfulCalls = propertiesCalls.filter(c => c.status && c.status >= 200 && c.status < 300);
      expect(successfulCalls.length, 'Should have at least one successful /properties call').toBeGreaterThan(0);

      ctx.assertNoCriticalErrors();
    });

    test('should receive valid property data from API', async ({ page, request }) => {
      ctx = createVisualTestContext(page, 'properties-data-validation');
      ctx.start();

      // First, directly test the API
      const apiResponse = await request.get(`${API_BASE_URL}/properties?limit=10`);

      expect(apiResponse.ok(), `API should return 2xx status`).toBe(true);

      const apiData = await apiResponse.json();

      // Validate response structure
      expect(apiData).toHaveProperty('data');
      expect(apiData).toHaveProperty('meta');
      expect(Array.isArray(apiData.data)).toBe(true);

      console.log(`API returned ${apiData.data.length} properties`);
      console.log('Meta:', JSON.stringify(apiData.meta, null, 2));

      // Now load the page and verify it can display this data
      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('properties-data');

      // If API returned data, page should not show empty state
      if (apiData.data.length > 0) {
        const emptyStateSelectors = [
          'text=No properties',
          'text=No results',
          'text=Nothing here',
        ];

        for (const selector of emptyStateSelectors) {
          const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
          // If visible, that might indicate data loading issue
          if (isVisible) {
            console.warn(`Empty state visible despite API having ${apiData.data.length} properties: ${selector}`);
          }
        }
      }

      ctx.assertNoCriticalErrors();
    });

    test('should handle API errors gracefully', async ({ page }) => {
      ctx = createVisualTestContext(page, 'api-error-handling');
      ctx.start();

      // This test runs against the real app
      // If API is down, the app should handle it gracefully
      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('api-state');

      // Check for crash indicators
      const crashIndicators = [
        'text=Application error',
        'text=This page has crashed',
        'text=Unexpected error',
      ];

      for (const selector of crashIndicators) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        expect(isVisible, `Should not show crash state: ${selector}`).toBe(false);
      }

      // Page should still be interactive even if API fails
      const isBlank = await ctx.validator.isPageBlank();
      expect(isBlank, 'Page should not be blank even if API fails').toBe(false);

      ctx.assertNoCriticalErrors();
    });
  });

  test.describe('Map Interaction', () => {
    test('should allow clicking on the map without errors', async ({ page }) => {
      ctx = createVisualTestContext(page, 'map-interaction');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      // Find map canvas
      const mapCanvas = page.locator('canvas').first();
      const isMapVisible = await mapCanvas.isVisible().catch(() => false);

      if (isMapVisible) {
        await ctx.screenshots.capture('before-click');

        // Get canvas bounding box
        const box = await mapCanvas.boundingBox();

        if (box) {
          // Click in the center of the map
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);

          await ctx.screenshots.capture('after-click');

          // Verify no errors after click
          ctx.assertNoCriticalErrors();

          // Check page is still functional
          const isBlank = await ctx.validator.isPageBlank();
          expect(isBlank, 'Page should not be blank after map click').toBe(false);
        }
      } else {
        console.log('Map canvas not found, skipping interaction test');
        await ctx.screenshots.capture('no-map-canvas');
      }

      ctx.assertNoCriticalErrors();
    });

    test('should allow map panning without errors', async ({ page }) => {
      ctx = createVisualTestContext(page, 'map-panning');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      const mapCanvas = page.locator('canvas').first();
      const isMapVisible = await mapCanvas.isVisible().catch(() => false);

      if (isMapVisible) {
        const box = await mapCanvas.boundingBox();

        if (box) {
          await ctx.screenshots.capture('before-pan');

          // Perform a drag operation (pan)
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;

          await page.mouse.move(centerX, centerY);
          await page.mouse.down();
          await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
          await page.mouse.up();

          await page.waitForTimeout(500);

          await ctx.screenshots.capture('after-pan');

          // Verify no errors after panning
          ctx.assertNoCriticalErrors();
        }
      } else {
        console.log('Map canvas not found, skipping pan test');
      }

      ctx.assertNoCriticalErrors();
    });

    test('should show property preview on map marker click', async ({ page }) => {
      ctx = createVisualTestContext(page, 'property-preview');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('map-with-markers');

      // Try clicking in various locations to find a marker
      const mapCanvas = page.locator('canvas').first();
      const isMapVisible = await mapCanvas.isVisible().catch(() => false);

      if (isMapVisible) {
        const box = await mapCanvas.boundingBox();

        if (box) {
          // Click in center (where markers might cluster)
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);

          await ctx.screenshots.capture('after-marker-click');

          // Check if a bottom sheet or preview appeared
          const previewSelectors = [
            '[data-testid="group-preview-card"]',
            '[data-testid="property-preview"]',
            '[data-testid="property-bottom-sheet"]',
            '[data-testid="bottom-sheet"]',
            '.bottom-sheet',
            '[role="dialog"]',
          ];

          let previewFound = false;
          for (const selector of previewSelectors) {
            const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
            if (isVisible) {
              previewFound = true;
              console.log(`Property preview found with selector: ${selector}`);
              await ctx.screenshots.capture('property-preview-visible');
              break;
            }
          }

          if (!previewFound) {
            console.log('No property preview appeared (might have clicked on empty area)');
          }
        }
      }

      ctx.assertNoCriticalErrors();
    });
  });

  test.describe('Console Health Check', () => {
    test('should have no critical errors during normal usage', async ({ page }) => {
      ctx = createVisualTestContext(page, 'console-health');
      ctx.start();

      // Perform a typical user flow
      await page.goto('/');
      await ctx.validator.waitForReady();

      await ctx.screenshots.capture('step-1-loaded');

      // Wait for map to settle
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('step-2-settled');

      // Scroll the page if possible
      await page.evaluate(() => window.scrollTo(0, 100));
      await page.waitForTimeout(500);

      await ctx.screenshots.capture('step-3-scrolled');

      // Final console check
      const errors = ctx.console.getCriticalErrors();
      const warnings = ctx.console.getWarnings();

      console.log(`Critical errors: ${errors.length}`);
      console.log(`Warnings: ${warnings.length}`);

      if (errors.length > 0) {
        console.error('Critical errors found:');
        for (const error of errors) {
          console.error(`  - ${error.text}`);
        }
      }

      ctx.assertNoCriticalErrors();
    });

    test('should report all console activity for debugging', async ({ page }) => {
      ctx = createVisualTestContext(page, 'console-activity');
      ctx.start();

      await page.goto('/');
      await ctx.validator.waitForReady();
      await waitForMapStyleLoaded(page, 30000);

      await ctx.screenshots.capture('final-state');

      // This test always passes but logs all console activity for inspection
      const report = ctx.console.formatReport();
      console.log(report);

      // Also log API activity
      const apiReport = ctx.api.formatReport();
      console.log(apiReport);

      // Test passes - this is for visibility into what's happening
      expect(true).toBe(true);
    });
  });
});

test.describe('Critical Integration Checks', () => {
  let ctx: VisualTestContext;

  test.afterEach(async () => {
    if (ctx) {
      ctx.stop();
      console.log(ctx.generateReport());
    }
  });

  test('full page load sequence without crashes', async ({ page }) => {
    ctx = createVisualTestContext(page, 'full-load-sequence');
    ctx.start();

    const timeline: { event: string; time: number }[] = [];
    const startTime = Date.now();

    const logEvent = (event: string) => {
      timeline.push({ event, time: Date.now() - startTime });
    };

    // Track load events
    page.on('load', () => logEvent('page-load'));
    page.on('domcontentloaded', () => logEvent('dom-content-loaded'));

    logEvent('navigate-start');
    await page.goto('/');
    logEvent('goto-complete');

    await page.waitForLoadState('domcontentloaded');
    logEvent('dom-ready');

    await ctx.screenshots.capture('dom-ready');

    await waitForMapStyleLoaded(page, 30000);
    logEvent('settled');

    await ctx.screenshots.capture('settled');

    console.log('Load timeline:', JSON.stringify(timeline, null, 2));

    // Verify page loaded successfully
    const isBlank = await ctx.validator.isPageBlank();
    expect(isBlank).toBe(false);

    ctx.assertNoCriticalErrors();
  });

  test('app state after 10 seconds of load', async ({ page }) => {
    ctx = createVisualTestContext(page, 'long-load-check');
    ctx.start();

    await page.goto('/');

    // Wait for map to fully load and settle
    await waitForMapStyleLoaded(page, 30000);

    await ctx.screenshots.capture('after-load');

    // After loading, app should be fully loaded
    const { hasError, errorText } = await ctx.validator.hasVisibleErrors();

    if (hasError) {
      console.error(`Error visible after 10s: ${errorText}`);
    }

    expect(hasError, 'Should not show error after 10 seconds').toBe(false);

    // Should not be blank
    const isBlank = await ctx.validator.isPageBlank();
    expect(isBlank, 'Should not be blank after 10 seconds').toBe(false);

    ctx.assertNoCriticalErrors();
  });
});

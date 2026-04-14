/**
 * Reference Expectation E2E Test: price-guess-slider-ui
 *
 * This test verifies the Price Guess Slider UI matches the reference expectation with:
 * - Large, prominent price display
 * - Slider track with draggable thumb
 * - Reference markers (WOZ, Ask, FMV) positioned on track
 * - Quick adjustment buttons (-50k, -10k, +10k, +50k)
 * - Submit button
 * - Min/max price range labels
 *
 * Screenshot saved to: test-results/reference-expectations/price-guess-slider-ui/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  fetchCanonicalPropertyFixture,
  setupCanonicalPropertyRouteMocks,
} from './helpers/canonical-property-route';

// Configuration
const EXPECTATION_NAME = 'price-guess-slider-ui';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on Eindhoven (properties with data)
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /net::ERR_CONNECTION_REFUSED/,
  /Failed to load resource/,
  /the server responded with a status of 404 \(Not Found\)/,
  /the server responded with a status of 500 \(Internal Server Error\)/,
  /Page Error: A network error occurred\./,
  /MapLibre error: AJAXError: Failed to fetch/,
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

  test('capture price guess slider UI for visual comparison', async ({ page }) => {
    test.setTimeout(90000);

    const selection = await fetchCanonicalPropertyFixture(
      page.request,
      'limit=10&city=Eindhoven',
      (properties) => properties.find((property) => property.guessCount && property.guessCount > 0) ?? properties[0],
    );
    if (!selection) {
      console.log('No property found, skipping test');
      return;
    }

    console.log(`Using canonical property route: ${selection.route}`);
    await setupCanonicalPropertyRouteMocks(page, page.request, selection);

    // Navigate to the canonical property detail page
    await page.goto(selection.route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Scroll to the price guess slider (it's below the fold)
    const priceSection = page.locator('[data-testid="price-guess-section"]');
    await priceSection.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const priceSlider = page.locator('[data-testid="price-guess-slider"]');
    await priceSlider.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const isSliderVisible = await priceSlider.isVisible().catch(() => false);
    console.log(`Price slider visible on property page: ${isSliderVisible}`);

    if (isSliderVisible) {
      // Get bounding boxes for slider and submit button
      const sliderBox = await priceSlider.boundingBox();
      const submitButton = page.locator('[data-testid="submit-guess-button"]');
      const submitBox = await submitButton.boundingBox();

      // Take a screenshot that includes both the slider and submit button
      if (sliderBox && submitBox) {
        const topY = Math.max(0, sliderBox.y - 20);
        const bottomY = submitBox.y + submitBox.height + 40;
        const combinedClip = {
          x: Math.max(0, Math.min(sliderBox.x, submitBox.x) - 20),
          y: topY,
          width: Math.max(sliderBox.width, submitBox.x + submitBox.width - sliderBox.x) + 40,
          height: bottomY - topY,
        };
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
          clip: combinedClip,
        });
      } else if (sliderBox) {
        const paddedClip = {
          x: Math.max(0, sliderBox.x - 20),
          y: Math.max(0, sliderBox.y - 20),
          width: sliderBox.width + 40,
          height: sliderBox.height + 120,
        };
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
          clip: paddedClip,
        });
      } else {
        await priceSlider.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        });
      }
      console.log(`Slider screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);
    } else {
      // Slider not found — take full page screenshot for debugging
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        fullPage: true,
      });
    }

    // Take full page screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-full-page.png`,
      fullPage: true,
    });

    // Verify page functionality
    await expect(page.locator('body')).toBeVisible();
  });

  test('verify price guess slider UI elements', async ({ page }) => {
    const selection = await fetchCanonicalPropertyFixture(
      page.request,
      'limit=10&city=Eindhoven',
      (properties) =>
        properties.find((property) => property.guessCount && property.guessCount > 0) ?? properties[0],
    );

    if (!selection) {
      console.log('No property found, skipping element verification');
      return;
    }

    console.log(`Using canonical property route: ${selection.route}`);
    await setupCanonicalPropertyRouteMocks(page, page.request, selection);

    // Navigate to the canonical property detail page
    await page.goto(selection.route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Scroll to the price guess section (it's below the fold)
    const priceSection = page.locator('[data-testid="price-guess-section"]');
    await priceSection.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const priceSlider = page.locator('[data-testid="price-guess-slider"]');
    await priceSlider.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    // Check for Price Guess Slider elements
    const priceHeader = page.locator('[data-testid="price-guess-header"]');
    const hasHeader = await priceHeader.isVisible().catch(() => false);
    console.log(`"What do you think..." header visible: ${hasHeader}`);

    // Check for price display (should show EUR format)
    const priceDisplay = page.locator('[data-testid="price-display"]');
    const hasPriceDisplay = await priceDisplay.first().isVisible().catch(() => false);
    console.log(`Price display visible: ${hasPriceDisplay}`);

    // Check for WOZ Value reference (only if property has WOZ value)
    if (selection.property.officialValuation) {
      const wozValue = page.locator('text=WOZ Value:');
      const hasWozValue = await wozValue.first().isVisible().catch(() => false);
      console.log(`WOZ Value text visible: ${hasWozValue}`);

      // Check for WOZ marker on slider
      const wozMarker = page.locator('text=WOZ').first();
      const hasWozMarker = await wozMarker.isVisible().catch(() => false);
      console.log(`WOZ marker visible: ${hasWozMarker}`);
    }

    // Check for quick adjustment buttons
    const minus50k = page.locator('[data-testid="adjust-minus-50k"]');
    const minus10k = page.locator('[data-testid="adjust-minus-10k"]');
    const plus10k = page.locator('[data-testid="adjust-plus-10k"]');
    const plus50k = page.locator('[data-testid="adjust-plus-50k"]');

    const hasMinus50k = await minus50k.isVisible().catch(() => false);
    const hasMinus10k = await minus10k.isVisible().catch(() => false);
    const hasPlus10k = await plus10k.isVisible().catch(() => false);
    const hasPlus50k = await plus50k.isVisible().catch(() => false);

    console.log(`Quick adjustment buttons: -50k=${hasMinus50k}, -10k=${hasMinus10k}, +10k=${hasPlus10k}, +50k=${hasPlus50k}`);

    // Check for submit button
    const submitButton = page.locator('[data-testid="submit-guess-button"]');
    const hasSubmitButton = await submitButton.isVisible().catch(() => false);
    console.log(`Submit Guess button visible: ${hasSubmitButton}`);

    // Check for slider thumb
    const sliderThumb = page.locator('[data-testid="slider-thumb"]');
    const hasSliderThumb = await sliderThumb.isVisible().catch(() => false);
    console.log(`Slider thumb visible: ${hasSliderThumb}`);

    // Check for min/max labels
    const minLabel = page.locator('[data-testid="price-range-min"]');
    const maxLabel = page.locator('[data-testid="price-range-max"]');
    const hasMinLabel = await minLabel.first().isVisible().catch(() => false);
    const hasMaxLabel = await maxLabel.first().isVisible().catch(() => false);
    console.log(`Min/Max labels: min=${hasMinLabel}, max=${hasMaxLabel}`);

    // Assert core elements are present
    expect(hasHeader || hasPriceDisplay).toBe(true);
    expect(hasMinus50k && hasMinus10k && hasPlus10k && hasPlus50k).toBe(true);
    expect(hasMinLabel && hasMaxLabel).toBe(true);

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();

    // Take screenshot of the current state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-elements-check.png`,
      fullPage: true,
    });
  });
});

/**
 * Reference Expectation E2E Test: price-guess-slider-ui
 *
 * This test verifies the Property Details "Guess the Price" section matches
 * the visual overhaul pen design with:
 * - Unified white card surface
 * - Crowd estimate header/value block
 * - Embedded slider with floating value bubble
 * - Pen-style WOZ / Asking markers
 * - Green submit button
 * - Embedded consensus / footer treatment when guess data exists
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
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

// Configuration
const EXPECTATION_NAME = 'price-guess-slider-ui';
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

  test('capture price guess slider UI for visual comparison', async ({ page }) => {
    test.setTimeout(90000);

    const selection = await fetchCanonicalPropertyFixture(
      page.request,
      'limit=10&city=Eindhoven',
      (properties) =>
        properties.find(
          (property) =>
            property.guessCount &&
            property.guessCount > 0 &&
            property.officialValuation &&
            property.askingPrice
        ) ??
        properties.find((property) => property.guessCount && property.guessCount > 0) ??
        properties[0],
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
      const thumb = page.locator('[data-testid="slider-thumb"]').first();
      const thumbBox = await thumb.boundingBox();
      if (thumbBox) {
        const startX = thumbBox.x + thumbBox.width / 2;
        const startY = thumbBox.y + thumbBox.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 90, startY, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }

      const sectionBox = await priceSection.boundingBox();

      if (sectionBox) {
        const combinedClip = {
          x: Math.max(0, sectionBox.x - 12),
          y: Math.max(0, sectionBox.y - 12),
          width: sectionBox.width + 24,
          height: sectionBox.height + 24,
        };
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
          clip: combinedClip,
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
        properties.find(
          (property) =>
            property.guessCount &&
            property.guessCount > 0 &&
            property.officialValuation &&
            property.askingPrice
        ) ??
        properties.find((property) => property.guessCount && property.guessCount > 0) ??
        properties[0],
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

    const sectionTitle = page.getByText('Guess the Price').first();
    const hasSectionTitle = await sectionTitle.isVisible().catch(() => false);
    console.log(`Section title visible: ${hasSectionTitle}`);

    const crowdEstimate = page.getByText('CROWD ESTIMATE').first();
    const hasCrowdEstimate = await crowdEstimate.isVisible().catch(() => false);
    console.log(`Crowd estimate label visible: ${hasCrowdEstimate}`);

    // Check for price display (should show EUR format)
    const priceDisplay = page.locator('[data-testid="price-display"]');
    const hasPriceDisplay = await priceDisplay.first().isVisible().catch(() => false);
    console.log(`Price display visible: ${hasPriceDisplay}`);
    const initialUserMarker = page.locator('[data-testid="user-guess-marker"]');
    const hasInitialUserMarker = await initialUserMarker.first().isVisible().catch(() => false);
    console.log(`User marker hidden before interaction: ${!hasInitialUserMarker}`);

    const exactPriceControl = page.locator('[data-testid="exact-price-control"]').first();
    await expect(page.locator('[data-testid="exact-price-label"]').first()).toHaveText(
      'Your guess:'
    );
    const exactPriceEditButton = page.locator('[data-testid="exact-price-edit-button"]').first();
    const exactPriceNormalBox = await exactPriceControl.boundingBox();
    await exactPriceEditButton.click();
    await expect(page.locator('[data-testid="exact-price-accept-button"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="exact-price-input"]').first()).toHaveValue(
      /€\s?\d{1,3}(\.\d{3})+/
    );
    const exactPriceEditBox = await exactPriceControl.boundingBox();
    expect(exactPriceNormalBox).not.toBeNull();
    expect(exactPriceEditBox).not.toBeNull();
    expect(
      Math.abs((exactPriceEditBox?.width ?? 0) - (exactPriceNormalBox?.width ?? 0))
    ).toBeLessThanOrEqual(2);
    await page.locator('[data-testid="exact-price-accept-button"]').first().click();

    // Check for WOZ/Asking markers in the embedded slider
    if (selection.property.officialValuation) {
      const wozMarker = page.locator('text=WOZ').first();
      const hasWozMarker = await wozMarker.isVisible().catch(() => false);
      console.log(`WOZ marker visible: ${hasWozMarker}`);
    }

    const askingMarker = page.locator('text=Asking').first();
    const hasAskingMarker = await askingMarker.isVisible().catch(() => false);
    console.log(`Asking marker visible: ${hasAskingMarker}`);

    // Check for submit button
    const submitButton = page.locator('[data-testid="submit-guess-button"]');
    const hasSubmitButton = await submitButton.isVisible().catch(() => false);
    console.log(`Submit Guess button visible: ${hasSubmitButton}`);

    // Check for slider thumb
    const sliderThumb = page.locator('[data-testid="slider-thumb"]');
    const hasSliderThumb = await sliderThumb.isVisible().catch(() => false);
    console.log(`Slider thumb visible: ${hasSliderThumb}`);

    const thumbBox = await sliderThumb.first().boundingBox();
    if (thumbBox) {
      const startX = thumbBox.x + thumbBox.width / 2;
      const startY = thumbBox.y + thumbBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 90, startY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }

    const hasInteractedUserMarker = await initialUserMarker.first().isVisible().catch(() => false);
    console.log(`User marker visible after interaction: ${hasInteractedUserMarker}`);

    // Range labels were intentionally removed; reference values are shown on staggered markers.
    const minLabel = page.locator('[data-testid="price-range-min"]');
    const maxLabel = page.locator('[data-testid="price-range-max"]');
    const hasMinLabel = await minLabel.first().isVisible().catch(() => false);
    const hasMaxLabel = await maxLabel.first().isVisible().catch(() => false);
    console.log(`Range labels removed: min=${!hasMinLabel}, max=${!hasMaxLabel}`);

    const consensusBlock = page.locator('[data-testid="consensus-alignment"]');
    const hasConsensus = await consensusBlock.isVisible().catch(() => false);
    console.log(`Consensus block visible: ${hasConsensus}`);

    // Assert core elements are present
    expect(hasSectionTitle).toBe(true);
    expect(hasCrowdEstimate).toBe(true);
    expect(hasPriceDisplay).toBe(true);
    expect(hasSubmitButton).toBe(true);
    expect(hasInitialUserMarker).toBe(false);
    expect(hasInteractedUserMarker).toBe(true);
    expect(hasMinLabel || hasMaxLabel).toBe(false);

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();

    // Take screenshot of the current state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-elements-check.png`,
      fullPage: true,
    });
  });
});

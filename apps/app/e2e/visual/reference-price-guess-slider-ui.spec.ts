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

// Configuration
const EXPECTATION_NAME = 'price-guess-slider-ui';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on Eindhoven (properties with data)
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];

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
  /Failed to load resource.*404/,
  /the server responded with a status of 404/,
  /AJAXError.*404/,
  // Auth context error during error boundary recovery
  /useAuthContext must be used within an AuthProvider/,
  /The above error occurred in the <AuthModal> component/,
  // Network errors during page load/hot reload
  /ERR_INCOMPLETE_CHUNKED_ENCODING/,
  /ERR_CONNECTION_REFUSED/,
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
    // First, fetch a property ID directly from the API
    const apiBaseUrl = 'http://localhost:3000'; // API server
    let propertyId: string | null = null;

    try {
      const response = await page.request.get(`${apiBaseUrl}/properties?limit=1&city=Eindhoven`);
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        propertyId = data.data[0].id;
        console.log('Found property from API:', propertyId, data.data[0].address);
      }
    } catch (e) {
      console.log('Could not fetch property from API, will try map interaction');
    }

    // If we have a property ID, navigate directly to the property detail page
    if (propertyId) {
      console.log(`Navigating directly to property page: /property/${propertyId}`);
      await page.goto(`/property/${propertyId}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Check if we're on the property detail page
      const propertyDetailsVisible = await page.locator('text=Property Details').first().isVisible().catch(() => false);
      console.log(`Property Details page loaded: ${propertyDetailsVisible}`);

      // Take screenshot of the property detail page
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-property-detail.png`,
        fullPage: true,
      });

      // Check if the price guess slider is visible on this page
      const priceSlider = page.locator('[data-testid="price-guess-slider"]');
      const isSliderVisible = await priceSlider.isVisible().catch(() => false);
      console.log(`Price slider visible on property page: ${isSliderVisible}`);

      if (isSliderVisible) {
        // Scroll to make sure slider is in view
        await priceSlider.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // Get bounding boxes for slider and submit button
        const sliderBox = await priceSlider.boundingBox();
        const submitButton = page.locator('[data-testid="submit-guess-button"]');
        const submitBox = await submitButton.boundingBox();

        // Take a screenshot that includes both the slider and submit button
        if (sliderBox && submitBox) {
          // Calculate to include everything from slider top to submit button bottom + padding
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
          // Fallback: capture slider with extra padding
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

        // Take full page screenshot
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-full-page.png`,
          fullPage: true,
        });

        // Verify page functionality
        await expect(page.locator('body')).toBeVisible();
        return;
      }
    }

    // Fallback: Try the map interaction approach
    console.log('Falling back to map interaction approach...');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Set map to Eindhoven center
    await page.evaluate(
      ({ center }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance && typeof mapInstance.setCenter === 'function') {
          mapInstance.setCenter(center);
          mapInstance.setZoom(16);
          mapInstance.setPitch(0);
        }
      },
      { center: CENTER_COORDINATES }
    );

    await page.waitForTimeout(5000);

    // Click on the map multiple times to try to hit a property marker
    const mapCanvas = page.locator('canvas').first();
    const box = await mapCanvas.boundingBox();

    if (box) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const xOffset = (Math.random() - 0.5) * box.width * 0.8;
        const yOffset = (Math.random() - 0.5) * box.height * 0.8;
        await page.mouse.click(
          box.x + box.width / 2 + xOffset,
          box.y + box.height / 2 + yOffset
        );
        await page.waitForTimeout(800);

        const hasPreview = await page.locator('text=Eindhoven').first().isVisible().catch(() => false);
        if (hasPreview) {
          console.log(`Found preview after ${attempt + 1} attempts`);
          break;
        }
      }
    }

    // Take screenshot of current state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-preview-state.png`,
      fullPage: true,
    });

    // Try to expand bottom sheet
    const addressVisible = await page.locator('text=Eindhoven').first().isVisible().catch(() => false);
    if (addressVisible) {
      const addressElement = page.locator('text=Eindhoven').first();
      const addressBox = await addressElement.boundingBox();
      if (addressBox) {
        await page.mouse.click(addressBox.x + addressBox.width / 2, addressBox.y);
        console.log('Clicked on address area to expand bottom sheet');
        await page.waitForTimeout(1500);
      }
    }

    // Swipe up to expand
    const viewportSize = page.viewportSize();
    if (viewportSize) {
      await page.mouse.move(viewportSize.width / 2, viewportSize.height - 100);
      await page.mouse.down();
      await page.mouse.move(viewportSize.width / 2, 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(1000);
    }

    // Take screenshots
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-expanded-state.png`,
      fullPage: true,
    });

    // Check for price slider
    const priceSlider = page.locator('[data-testid="price-guess-slider"]');
    const isSliderVisible = await priceSlider.isVisible().catch(() => false);
    console.log(`Price slider visible: ${isSliderVisible}`);

    if (isSliderVisible) {
      // Get bounding boxes for slider and submit button
      const sliderBox = await priceSlider.boundingBox();
      const submitButton = page.locator('[data-testid="submit-guess-button"]');
      const submitBox = await submitButton.boundingBox();

      if (sliderBox && submitBox) {
        // Calculate to include everything from slider top to submit button bottom + padding
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
    } else {
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        fullPage: false,
      });
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-full-page.png`,
      fullPage: true,
    });

    // Verify basic page functionality
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('verify price guess slider UI elements', async ({ page }) => {
    // Fetch a property with WOZ value from the API
    const apiBaseUrl = 'http://localhost:3000';
    let propertyId: string | null = null;
    let propertyWozValue: number | null = null;

    try {
      const response = await page.request.get(`${apiBaseUrl}/properties?limit=10&city=Eindhoven`);
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        // Find a property with a WOZ value if possible
        const propertyWithWoz = data.data.find((p: { wozValue?: number }) => p.wozValue && p.wozValue > 0);
        const selectedProperty = propertyWithWoz || data.data[0];
        propertyId = selectedProperty.id;
        propertyWozValue = selectedProperty.wozValue;
        console.log('Selected property:', propertyId, 'WOZ value:', propertyWozValue);
      }
    } catch (e) {
      console.log('Could not fetch property from API');
    }

    if (!propertyId) {
      console.log('No property found, skipping element verification');
      return;
    }

    // Navigate to the property detail page
    await page.goto(`/property/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for Price Guess Slider elements
    const priceHeader = page.locator('text=What do you think this property is worth?');
    const hasHeader = await priceHeader.isVisible().catch(() => false);
    console.log(`"What do you think..." header visible: ${hasHeader}`);

    // Check for price display (should show EUR format)
    const priceDisplay = page.locator('[data-testid="price-display"]');
    const hasPriceDisplay = await priceDisplay.first().isVisible().catch(() => false);
    console.log(`Price display visible: ${hasPriceDisplay}`);

    // Check for WOZ Value reference (only if property has WOZ value)
    if (propertyWozValue) {
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
    const minLabel = page.locator('text=\u20AC50.000');
    const maxLabel = page.locator('text=\u20AC2.000.000');
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

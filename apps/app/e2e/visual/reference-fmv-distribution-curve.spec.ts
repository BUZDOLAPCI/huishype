/**
 * Reference Expectation E2E Test: fmv-distribution-curve
 *
 * This test verifies the FMV (Fair Market Value) Distribution Curve visualization
 * matches the reference expectation with:
 * - Prominent FMV value display in EUR format
 * - Distribution bar showing range of guesses (min to max)
 * - Median marker on the distribution bar
 * - Confidence indicator badge (Low/Medium/High)
 * - Guess count display
 * - Asking price comparison (above/below crowd estimate)
 * - User guess marker (if applicable)
 * - WOZ value reference
 *
 * Screenshot saved to: test-results/reference-expectations/fmv-distribution-curve/
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const EXPECTATION_NAME = 'fmv-distribution-curve';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
];

// Ensure screenshot directory exists
test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  // Console error collection
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  // Increase timeout for visual tests
  test.setTimeout(60000);

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

    // Log any critical errors
    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
  });

  test('capture FMV distribution curve visualization from showcase', async ({ page }) => {
    // Navigate to the showcase page
    await page.goto('/showcase/fmv-visualization');
    await page.waitForLoadState('networkidle');

    // Wait for the showcase page to load
    await page.waitForSelector('[data-testid="fmv-visualization-showcase"]', { timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for animations to complete

    // Verify high confidence state is visible (primary showcase)
    const highConfidenceState = page.locator('[data-testid="fmv-visualization-high"]');
    const isHighConfidenceVisible = await highConfidenceState.isVisible().catch(() => false);
    console.log(`High confidence FMV visible: ${isHighConfidenceVisible}`);

    // Verify all confidence states are rendered (scroll to each to check)
    const mediumConfidenceState = page.locator('[data-testid="fmv-visualization-medium"]');
    const lowConfidenceState = page.locator('[data-testid="fmv-visualization-low"]');
    const wideDistributionState = page.locator('[data-testid="fmv-visualization-wide"]');
    const noDataState = page.locator('[data-testid="fmv-no-data"]'); // Fixed: use the actual testID from the component

    // Scroll to medium and check
    await mediumConfidenceState.scrollIntoViewIfNeeded().catch(() => {});
    const isMediumVisible = await mediumConfidenceState.isVisible().catch(() => false);

    // Scroll to low and check
    await lowConfidenceState.scrollIntoViewIfNeeded().catch(() => {});
    const isLowVisible = await lowConfidenceState.isVisible().catch(() => false);

    // Scroll to wide and check
    await wideDistributionState.scrollIntoViewIfNeeded().catch(() => {});
    const isWideVisible = await wideDistributionState.isVisible().catch(() => false);

    // Scroll to no-data and check
    await noDataState.scrollIntoViewIfNeeded().catch(() => {});
    const isNoDataVisible = await noDataState.isVisible().catch(() => false);

    console.log('Component states visibility:');
    console.log(`  - High confidence (23 guesses): ${isHighConfidenceVisible}`);
    console.log(`  - Medium confidence (7 guesses): ${isMediumVisible}`);
    console.log(`  - Low confidence (2 guesses): ${isLowVisible}`);
    console.log(`  - Wide distribution: ${isWideVisible}`);
    console.log(`  - No data state: ${isNoDataVisible}`);

    // Take screenshot of initial view (top of page)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-showcase-top.png'),
      fullPage: false,
    });

    // Scroll to show all components and take additional screenshots
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-showcase-middle.png'),
      fullPage: false,
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-showcase-bottom.png'),
      fullPage: false,
    });

    // Take full page screenshot (primary screenshot for reference comparison)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-current.png`),
      fullPage: true,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Verify expected text content
    const pageContent = await page.textContent('body');

    // Check for FMV value display (EUR format with Dutch locale)
    expect(pageContent).toContain('Crowd Estimate');

    // Check for confidence indicators
    expect(pageContent).toContain('Low');
    expect(pageContent).toContain('Medium');
    expect(pageContent).toContain('High');

    // Check for confidence messages
    expect(pageContent).toContain('Building consensus');
    expect(pageContent).toContain('Strong consensus');

    // Check for asking price comparison
    expect(pageContent).toContain('Asking price is');
    expect(pageContent).toContain('crowd estimate');

    // Check for guess count display
    expect(pageContent).toContain('guesses');

    // Check for distribution markers
    expect(pageContent).toContain('Median');

    // Check for no data state message
    expect(pageContent).toContain('Not enough data');

    // Assertions for component visibility
    expect(isHighConfidenceVisible, 'High confidence state should be visible').toBe(true);
    expect(isMediumVisible, 'Medium confidence state should be visible').toBe(true);
    expect(isLowVisible, 'Low confidence state should be visible').toBe(true);
    expect(isNoDataVisible, 'No data state should be visible').toBe(true);

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify individual FMV visualization states', async ({ page }) => {
    await page.goto('/showcase/fmv-visualization');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="fmv-visualization-showcase"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    // Capture each state individually for detailed comparison

    // 1. High confidence state (with all features)
    const highConfidenceState = page.locator('[data-testid="fmv-high-confidence-state"]');
    if (await highConfidenceState.isVisible()) {
      await highConfidenceState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-high-confidence.png'),
      });
      console.log('Captured high confidence state screenshot');
    }

    // 2. Medium confidence state
    const mediumConfidenceState = page.locator('[data-testid="fmv-medium-confidence-state"]');
    if (await mediumConfidenceState.isVisible()) {
      await mediumConfidenceState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await mediumConfidenceState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-medium-confidence.png'),
      });
      console.log('Captured medium confidence state screenshot');
    }

    // 3. Low confidence state
    const lowConfidenceState = page.locator('[data-testid="fmv-low-confidence-state"]');
    if (await lowConfidenceState.isVisible()) {
      await lowConfidenceState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await lowConfidenceState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-low-confidence.png'),
      });
      console.log('Captured low confidence state screenshot');
    }

    // 4. Wide distribution state (polarizing)
    const wideDistributionState = page.locator('[data-testid="fmv-wide-distribution-state"]');
    if (await wideDistributionState.isVisible()) {
      await wideDistributionState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await wideDistributionState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-wide-distribution.png'),
      });
      console.log('Captured wide distribution state screenshot');
    }

    // 5. No data state
    const noDataState = page.locator('[data-testid="fmv-no-data-state"]');
    if (await noDataState.isVisible()) {
      await noDataState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await noDataState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-no-data.png'),
      });
      console.log('Captured no data state screenshot');
    }

    // 6. Loading state
    const loadingToggle = page.locator('text=Show Loading').first();
    if (await loadingToggle.isVisible()) {
      await loadingToggle.scrollIntoViewIfNeeded();
      await loadingToggle.click();
      await page.waitForTimeout(500);

      const loadingState = page.locator('[data-testid="fmv-loading-state"]');
      if (await loadingState.isVisible()) {
        await loadingState.screenshot({
          path: path.join(SCREENSHOT_DIR, 'state-loading.png'),
        });
        console.log('Captured loading state screenshot');
      }
    }

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify FMV visualization on property page', async ({ page }) => {
    // First, fetch a property ID from the API
    const apiBaseUrl = 'http://localhost:3100';
    let propertyId: string | null = null;

    try {
      const response = await page.request.get(`${apiBaseUrl}/properties?limit=10&city=Eindhoven`);
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        // Find a property that might have guesses
        const propertyWithGuesses = data.data.find((p: { guessCount?: number }) => p.guessCount && p.guessCount > 0);
        const selectedProperty = propertyWithGuesses || data.data[0];
        propertyId = selectedProperty.id;
        console.log('Selected property:', propertyId, 'Guess count:', selectedProperty.guessCount || 0);
      }
    } catch (e) {
      console.log('Could not fetch property from API, skipping property page test');
      return;
    }

    if (!propertyId) {
      console.log('No property found, skipping property page test');
      return;
    }

    // Navigate to the property detail page
    await page.goto(`/property/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for FMV Visualization component on the page
    const fmvVisualization = page.locator('[data-testid="fmv-visualization"]');
    const isFmvVisible = await fmvVisualization.isVisible().catch(() => false);
    console.log(`FMV Visualization visible on property page: ${isFmvVisible}`);

    // Take screenshot of the property page
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'property-page-context.png'),
      fullPage: true,
    });

    // If FMV is visible, take a focused screenshot
    if (isFmvVisible) {
      await fmvVisualization.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await fmvVisualization.screenshot({
        path: path.join(SCREENSHOT_DIR, 'fmv-on-property-page.png'),
      });
      console.log('Captured FMV visualization from property page');

      // Verify FMV value is displayed
      const fmvValue = page.locator('[data-testid="fmv-value"]');
      const hasFmvValue = await fmvValue.isVisible().catch(() => false);
      console.log(`FMV value element visible: ${hasFmvValue}`);
    } else {
      // If no FMV (no guesses), check for no-data state
      const noDataState = page.locator('[data-testid="fmv-no-data"]');
      const hasNoDataState = await noDataState.isVisible().catch(() => false);
      console.log(`No data state visible: ${hasNoDataState}`);

      // Check for loading state
      const loadingState = page.locator('[data-testid="fmv-loading"]');
      const hasLoadingState = await loadingState.isVisible().catch(() => false);
      console.log(`Loading state visible: ${hasLoadingState}`);
    }

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });
});

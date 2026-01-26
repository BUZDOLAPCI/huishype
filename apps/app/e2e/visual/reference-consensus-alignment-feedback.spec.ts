/**
 * Reference Expectation E2E Test: consensus-alignment-feedback
 *
 * This test verifies the Consensus Alignment Feedback feature as described in the spec:
 * - Shows users immediately if their guess aligns with crowd consensus
 * - Example: "You agree with 90% of top predictors"
 * - Provides a small dopamine hit without revealing right/wrong prematurely
 * - Provokes users with outlier positions to comment and defend their view
 *
 * The test navigates to a showcase page that displays all three states of the
 * ConsensusAlignment component:
 * - Aligned (green): Within 5% of crowd estimate
 * - Close (blue): Within 5-15% of crowd estimate
 * - Different (amber): More than 15% different from crowd estimate
 *
 * Screenshot saved to: test-results/reference-expectations/consensus-alignment-feedback/
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const EXPECTATION_NAME = 'consensus-alignment-feedback';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable errors
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
];

// Disable trace and video to avoid timeout issues
test.use({ trace: 'off', video: 'off' });

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

  test('capture consensus alignment feedback visualization', async ({ page }) => {
    // Navigate to the showcase page
    await page.goto('/showcase/consensus-alignment');
    await page.waitForLoadState('networkidle');

    // Wait for the showcase page to load
    await page.waitForSelector('[data-testid="consensus-alignment-showcase"]', { timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for animations to complete

    // Verify all three states are visible
    const alignedState = page.locator('[data-testid="consensus-alignment-aligned"]');
    const closeState = page.locator('[data-testid="consensus-alignment-close"]');
    const differentState = page.locator('[data-testid="consensus-alignment-different"]');
    const differentBelowState = page.locator('[data-testid="consensus-alignment-different-below"]');

    // Check visibility of all states
    const isAlignedVisible = await alignedState.isVisible().catch(() => false);
    const isCloseVisible = await closeState.isVisible().catch(() => false);
    const isDifferentVisible = await differentState.isVisible().catch(() => false);
    const isDifferentBelowVisible = await differentBelowState.isVisible().catch(() => false);

    console.log('Component states visibility:');
    console.log(`  - Aligned (green): ${isAlignedVisible}`);
    console.log(`  - Close (blue): ${isCloseVisible}`);
    console.log(`  - Different above (amber): ${isDifferentVisible}`);
    console.log(`  - Different below (amber): ${isDifferentBelowVisible}`);

    // Take screenshot of initial view
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-showcase-top.png'),
      fullPage: false,
    });

    // Scroll to show all components and take full page screenshot
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-showcase-bottom.png'),
      fullPage: false,
    });

    // Take full page screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-current.png`),
      fullPage: true,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Verify expected text content
    const pageContent = await page.textContent('body');

    // Check for aligned state message
    expect(pageContent).toContain('You agree with');
    expect(pageContent).toContain('of top predictors');

    // Check for close state message
    expect(pageContent).toContain('close to the crowd consensus');

    // Check for different state - should show percentage above/below
    expect(pageContent).toContain('above the crowd estimate');
    expect(pageContent).toContain('below the crowd estimate');

    // Check for guess count display
    expect(pageContent).toContain('guesses');

    // Check for percentile rank display
    expect(pageContent).toContain('higher than');
    expect(pageContent).toContain('of predictions');

    // Assertions for component visibility
    expect(isAlignedVisible, 'Aligned state should be visible').toBe(true);
    expect(isCloseVisible, 'Close state should be visible').toBe(true);
    expect(isDifferentVisible, 'Different above state should be visible').toBe(true);
    expect(isDifferentBelowVisible, 'Different below state should be visible').toBe(true);

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify individual component states', async ({ page }) => {
    await page.goto('/showcase/consensus-alignment');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="consensus-alignment-showcase"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    // Capture each state individually for detailed comparison

    // 1. Aligned state
    const alignedState = page.locator('[data-testid="consensus-aligned-state"]');
    if (await alignedState.isVisible()) {
      await alignedState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-aligned.png'),
      });
      console.log('Captured aligned state screenshot');
    }

    // 2. Close state
    const closeState = page.locator('[data-testid="consensus-close-state"]');
    if (await closeState.isVisible()) {
      await closeState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await closeState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-close.png'),
      });
      console.log('Captured close state screenshot');
    }

    // 3. Different state (above)
    const differentState = page.locator('[data-testid="consensus-different-state"]');
    if (await differentState.isVisible()) {
      await differentState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await differentState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-different-above.png'),
      });
      console.log('Captured different (above) state screenshot');
    }

    // 4. Different state (below)
    const differentBelowState = page.locator('[data-testid="consensus-different-below-state"]');
    if (await differentBelowState.isVisible()) {
      await differentBelowState.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await differentBelowState.screenshot({
        path: path.join(SCREENSHOT_DIR, 'state-different-below.png'),
      });
      console.log('Captured different (below) state screenshot');
    }

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });
});

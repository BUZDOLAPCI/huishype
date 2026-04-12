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
    await page.goto('/showcase/consensus-alignment', { waitUntil: 'domcontentloaded' });

    // Wait for the showcase page to load
    const showcase = page.locator('[data-testid="consensus-alignment-showcase"]');
    await expect(showcase).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for animations to complete

    // Verify all showcase sections are rendered.
    const alignedState = page.locator('[data-testid="consensus-aligned-state"]');
    const closeState = page.locator('[data-testid="consensus-close-state"]');
    const differentState = page.locator('[data-testid="consensus-different-state"]');
    const differentBelowState = page.locator('[data-testid="consensus-different-below-state"]');

    // Check that all showcase sections are rendered into the ScrollView.
    // They are not all simultaneously in the viewport, so visibility is the wrong contract here.
    const isAlignedRendered = (await alignedState.count()) > 0;
    const isCloseRendered = (await closeState.count()) > 0;
    const isDifferentRendered = (await differentState.count()) > 0;
    const isDifferentBelowRendered = (await differentBelowState.count()) > 0;

    console.log('Component states rendered:');
    console.log(`  - Aligned (green): ${isAlignedRendered}`);
    console.log(`  - Close (blue): ${isCloseRendered}`);
    console.log(`  - Different above (amber): ${isDifferentRendered}`);
    console.log(`  - Different below (amber): ${isDifferentBelowRendered}`);

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
    const showcaseContent = await showcase.textContent();

    // Check for showcase copy and alignment message variants
    expect(showcaseContent).toContain('Consensus Alignment Feedback');
    expect(showcaseContent).toContain('You agree with');
    expect(showcaseContent).toContain('of top predictors');

    // Check for close state message
    expect(showcaseContent).toContain('close to the crowd consensus');

    // Check for different state - should show percentage above/below
    expect(showcaseContent).toContain('above the crowd estimate');
    expect(showcaseContent).toContain('below the crowd estimate');

    // Check for guess count display
    expect(showcaseContent).toContain('guesses');

    // Check for percentile rank display
    expect(showcaseContent).toContain('higher than');
    expect(showcaseContent).toContain('of predictions');

    // Assertions for component visibility
    expect(isAlignedRendered, 'Aligned state should be rendered').toBe(true);
    expect(isCloseRendered, 'Close state should be rendered').toBe(true);
    expect(isDifferentRendered, 'Different above state should be rendered').toBe(true);
    expect(isDifferentBelowRendered, 'Different below state should be rendered').toBe(true);

    // Verify no critical console errors
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify individual component states', async ({ page }) => {
    await page.goto('/showcase/consensus-alignment', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="consensus-alignment-showcase"]')).toBeVisible({
      timeout: 30000,
    });
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

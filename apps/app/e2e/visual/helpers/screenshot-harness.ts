/**
 * Screenshot capture harness for visual overhaul verification.
 *
 * Provides helpers to capture screenshots at standardized viewports
 * for both mobile-web and wide-web layouts. All captures run the
 * console-error guard so a test automatically fails if any critical
 * console error fires during the capture window.
 *
 * Viewport conventions:
 *   mobile-web  : 390 x 844  (iPhone 14 Pro dimensions)
 *   wide-web    : 1440 x 900 (standard desktop)
 *
 * Output convention:
 *   test-results/visual-overhaul/<surface>/web/<viewport>-<name>.png
 */

import { Page, test as base } from '@playwright/test';
import * as path from 'path';
import { ConsoleCollector, KNOWN_ACCEPTABLE_ERRORS } from './visual-test-helpers.js';

// ============================================
// Viewport presets
// ============================================

export const VIEWPORTS = {
  /** iPhone 14 Pro — primary acceptance viewport (matches pen exports) */
  mobile: { width: 390, height: 844 },
  /** Standard desktop — carry-over quality check */
  wide: { width: 1440, height: 900 },
  /** iPad portrait — optional landscape check */
  tablet: { width: 820, height: 1180 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

// ============================================
// Output directory
// ============================================

/** Root directory for visual overhaul screenshots */
export const VISUAL_OVERHAUL_DIR = 'test-results/visual-overhaul';

/** Build the output path for a screenshot */
export function screenshotPath(
  surface: string,
  viewport: ViewportName,
  name: string,
): string {
  return path.join(VISUAL_OVERHAUL_DIR, surface, 'web', `${viewport}-${name}.png`);
}

// ============================================
// Capture helpers
// ============================================

export interface CaptureOptions {
  /** Wait this many ms after navigation before capturing (default: 1000) */
  settleMs?: number;
  /** Take a full-page screenshot (default: false — viewport only) */
  fullPage?: boolean;
  /** Fail the test if critical console errors fire during capture (default: true) */
  failOnConsoleErrors?: boolean;
}

/**
 * Capture a screenshot at the given viewport.
 *
 * Sets the viewport, optionally waits for the page to settle, takes the
 * screenshot, then restores the original viewport if it was changed.
 *
 * Returns the path to the saved screenshot.
 */
export async function captureScreenshot(
  page: Page,
  surface: string,
  viewport: ViewportName,
  name: string,
  opts: CaptureOptions = {},
): Promise<string> {
  const {
    settleMs = 1000,
    fullPage = false,
    failOnConsoleErrors = true,
  } = opts;

  const collector = new ConsoleCollector();
  if (failOnConsoleErrors) {
    collector.attach(page);
  }

  // Set viewport
  const vp = VIEWPORTS[viewport];
  await page.setViewportSize(vp);

  // Let the layout settle
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }

  // Take screenshot
  const outPath = screenshotPath(surface, viewport, name);
  await page.screenshot({ path: outPath, fullPage });

  // Check for critical console errors
  if (failOnConsoleErrors) {
    collector.detach();
    const criticalErrors = collector.getCriticalErrors();
    if (criticalErrors.length > 0) {
      const msgs = criticalErrors.map((e) => e.text).join('\n  - ');
      throw new Error(
        `Critical console errors during screenshot capture ` +
        `(surface=${surface}, viewport=${viewport}, name=${name}):\n  - ${msgs}`
      );
    }
  }

  return outPath;
}

/**
 * Capture a screenshot at both mobile and wide viewports.
 *
 * Convenience wrapper that calls `captureScreenshot` twice.
 * Returns an object with both paths.
 */
export async function captureDualViewport(
  page: Page,
  surface: string,
  name: string,
  opts: CaptureOptions = {},
): Promise<{ mobile: string; wide: string }> {
  const mobilePath = await captureScreenshot(page, surface, 'mobile', name, opts);
  const widePath = await captureScreenshot(page, surface, 'wide', name, opts);
  return { mobile: mobilePath, wide: widePath };
}

/**
 * Android screenshot conventions.
 *
 * Android screenshots are captured via the rn-debugger MCP or adb.
 * This helper documents the expected output paths and naming
 * so that the visual review protocol can find them.
 *
 * Typical flow:
 *   1. Navigate to the target state on the physical device
 *   2. adb exec-out screencap -p > test-results/visual-overhaul/<surface>/android/<name>.png
 *
 * Or via rn-debugger MCP:
 *   android_screenshot → save to the same path
 */
export function androidScreenshotPath(surface: string, name: string): string {
  return path.join(VISUAL_OVERHAUL_DIR, surface, 'android', `${name}.png`);
}

// ============================================
// Extended Playwright test fixture
// ============================================

/**
 * Extended test type that provides a ConsoleCollector as a fixture.
 *
 * Usage:
 *   import { test } from './helpers/screenshot-harness';
 *
 *   test('my visual test', async ({ page, consoleCollector }) => {
 *     consoleCollector.attach(page);
 *     await page.goto('/');
 *     // ... interact ...
 *     consoleCollector.assertNoCriticalErrors();
 *   });
 */
export const test = base.extend<{
  consoleCollector: ConsoleCollector & { assertNoCriticalErrors: () => void };
}>({
  consoleCollector: async ({}, use) => {
    const collector = new ConsoleCollector();
    const extended = Object.assign(collector, {
      assertNoCriticalErrors() {
        const errors = collector.getCriticalErrors();
        if (errors.length > 0) {
          const msgs = errors.map((e) => e.text).join('\n  - ');
          throw new Error(`Critical console errors:\n  - ${msgs}`);
        }
      },
    });
    await use(extended);
    collector.detach();
  },
});

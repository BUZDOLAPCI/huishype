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
 *   test-results/visual-overhaul/<surface>/android/<name>.png
 *   test-results/visual-overhaul/<surface>/notes.md
 */

import type { Locator, Page } from '@playwright/test';
import { test as base } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConsoleCollector, KNOWN_ACCEPTABLE_ERRORS } from './visual-test-helpers';

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

const HARNESS_DIR = __dirname;
const REPO_ROOT = path.resolve(HARNESS_DIR, '../../../../../');

/** Root directory for visual overhaul screenshots */
export const VISUAL_OVERHAUL_DIR = path.join(REPO_ROOT, 'test-results', 'visual-overhaul');

export type SurfacePlatform = 'web' | 'android';

export interface SurfaceNoteOptions {
  platform: SurfacePlatform;
  files?: string[];
  title?: string;
  note?: string | string[];
}

function asArray(value?: string | string[]): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value.filter(Boolean)
    : [value];
}

function toRelativeArtifactPath(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

export function surfacePath(surface: string): string {
  return path.join(VISUAL_OVERHAUL_DIR, surface);
}

export function platformPath(surface: string, platform: SurfacePlatform): string {
  return path.join(surfacePath(surface), platform);
}

export function notesPath(surface: string): string {
  return path.join(surfacePath(surface), 'notes.md');
}

export async function ensureVisualOverhaulSurface(surface: string): Promise<void> {
  await Promise.all([
    fs.mkdir(platformPath(surface, 'web'), { recursive: true }),
    fs.mkdir(platformPath(surface, 'android'), { recursive: true }),
  ]);

  const surfaceNotesPath = notesPath(surface);
  try {
    await fs.access(surfaceNotesPath);
  } catch {
    const title = `# ${surface}\n\n`;
    const intro =
      'Visual overhaul evidence log for this surface.\n\n' +
      'Each entry records generated or imported artifacts under this directory.\n';
    await fs.writeFile(surfaceNotesPath, title + intro, 'utf8');
  }
}

export async function appendSurfaceNote(
  surface: string,
  options: SurfaceNoteOptions,
): Promise<void> {
  await ensureVisualOverhaulSurface(surface);

  const fileLines = (options.files ?? [])
    .map((file) => `- Artifact: \`${toRelativeArtifactPath(file)}\``);
  const noteLines = asArray(options.note).map((line) => `- ${line}`);
  const title = options.title ?? `${options.platform.toUpperCase()} capture`;

  const lines = [
    '',
    `## ${new Date().toISOString()} - ${title}`,
    `- Platform: \`${options.platform}\``,
    ...fileLines,
    ...noteLines,
  ];

  await fs.appendFile(notesPath(surface), `${lines.join('\n')}\n`, 'utf8');
}

/** Build the output path for a screenshot */
export function screenshotPath(
  surface: string,
  viewport: ViewportName,
  name: string,
): string {
  return path.join(platformPath(surface, 'web'), `${viewport}-${name}.png`);
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
  /** Additional lines to append to the surface notes log */
  note?: string | string[];
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
    note,
  } = opts;

  await ensureVisualOverhaulSurface(surface);

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

  await appendSurfaceNote(surface, {
    platform: 'web',
    title: `WEB ${viewport} capture`,
    files: [outPath],
    note: [
      `Viewport: \`${viewport}\` (${vp.width}x${vp.height})`,
      ...(failOnConsoleErrors
        ? ['Console guard: enabled']
        : ['Console guard: disabled']),
      ...asArray(note),
    ],
  });

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
  return path.join(platformPath(surface, 'android'), `${name}.png`);
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

// ============================================
// Map interaction helpers
// ============================================

export interface ClickOnPropertyMarkerResult {
  success: boolean;
  featureCount: number;
  screenX?: number;
  screenY?: number;
  propertyId?: string;
  pointCount?: number;
  reason?: string;
}

/**
 * Find and click on a property marker on the MapLibre map.
 *
 * Uses queryRenderedFeatures to locate an on-screen marker near the center of
 * the viewport, then performs a real Playwright mouse click at that position.
 *
 * @param page  Playwright Page with a loaded MapLibre map instance on window.__mapInstance
 * @returns     Result indicating success, feature count, and screen coordinates
 */
export async function clickOnPropertyMarker(page: Page): Promise<ClickOnPropertyMarkerResult> {
  const result = await page.evaluate(() => {
    const mapInstance = (window as any).__mapInstance;
    if (!mapInstance || !mapInstance.isStyleLoaded()) {
      return { success: false, featureCount: 0, reason: 'Map not ready' };
    }

    const canvas = mapInstance.getCanvas();
    if (!canvas) {
      return { success: false, featureCount: 0, reason: 'No canvas' };
    }

    const layerNames = ['single-active-points', 'active-nodes', 'ghost-nodes'];
    let allFeatures: any[] = [];

    for (const layerName of layerNames) {
      try {
        if (mapInstance.getLayer(layerName)) {
          const features = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: [layerName] }
          ) || [];
          allFeatures = allFeatures.concat(features);
        }
      } catch (e) { /* ignore */ }
    }

    if (allFeatures.length === 0) {
      return { success: false, featureCount: 0, reason: 'No features found' };
    }

    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    const edgeMargin = 40;

    const candidates = allFeatures
      .filter((feature: any) =>
        feature.geometry?.type === 'Point' &&
        (!feature.properties?.point_count || feature.properties.point_count === 1)
      )
      .map((feature: any) => {
        const coordinates = feature.geometry.coordinates;
        const point = mapInstance.project(coordinates);
        const inBounds =
          point.x >= edgeMargin &&
          point.x <= canvas.width - edgeMargin &&
          point.y >= edgeMargin &&
          point.y <= canvas.height - edgeMargin;

        return {
          feature,
          coordinates,
          point,
          inBounds,
          distanceToCenter:
            Math.hypot(point.x - canvasCenterX, point.y - canvasCenterY),
        };
      })
      .filter((candidate: any) => candidate.inBounds)
      .sort((a: any, b: any) => a.distanceToCenter - b.distanceToCenter);

    const candidate = candidates[0];
    if (!candidate) {
      return { success: false, featureCount: allFeatures.length, reason: 'No non-cluster point feature found' };
    }

    const rect = canvas.getBoundingClientRect();

    return {
      success: true,
      featureCount: allFeatures.length,
      screenX: rect.left + candidate.point.x,
      screenY: rect.top + candidate.point.y,
      propertyId: candidate.feature.properties?.id,
    };
  });

  console.log(`Click result: ${JSON.stringify(result)}`);

  if (result.success) {
    if (result.screenX !== undefined && result.screenY !== undefined) {
      await page.mouse.move(result.screenX, result.screenY);
      await page.mouse.click(result.screenX, result.screenY);
    }
    await page.waitForTimeout(500);
  }

  return {
    success: result.success,
    featureCount: result.featureCount,
    screenX: result.screenX,
    screenY: result.screenY,
    propertyId: result.propertyId,
    reason: result.reason,
  };
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ force: true });
      await page.waitForTimeout(250);
      return true;
    }
  }

  return false;
}

export async function dismissPreviewCard(page: Page): Promise<boolean> {
  return clickFirstVisible(page, [
    '[data-testid="property-preview-close-button"]',
    '[data-testid="group-preview-close-button"]',
    '[data-testid="group-preview-close-hitzone"]',
  ]);
}

export async function clickPreviewAction(
  page: Page,
  action: 'like' | 'comment' | 'guess'
): Promise<boolean> {
  return clickFirstVisible(page, [
    `[data-testid="group-preview-${action}-button"]`,
    `[data-testid="group-preview-${action}-hitzone"]`,
  ]);
}

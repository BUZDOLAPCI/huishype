/**
 * Reference Expectation E2E Test: pdok-aerial-imagery
 *
 * This test verifies the PDOK aerial imagery integration:
 * - Utility generates valid URLs for the PDOK WMS service
 * - URLs return successful 200 responses with actual imagery
 * - AerialImageCard component displays with marker overlay
 * - Console remains error-free during execution
 *
 * Screenshot saved to: test-results/reference-expectations/pdok-aerial-imagery/
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = 'pdok-aerial-imagery';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

async function getAerialImageSrc(page: Page, testId: string) {
  const image = page.locator(`[data-testid="${testId}-image"]`);
  const directSrc = await image.getAttribute('src').catch(() => null);
  if (directSrc) {
    return directSrc;
  }

  const card = page.locator(`[data-testid="${testId}"]`);
  const fallbackSrc = await card.locator('img').first().getAttribute('src').catch(() => null);
  if (fallbackSrc) {
    return fallbackSrc;
  }

  return await page.evaluate((cardTestId) => {
    const card = document.querySelector(`[data-testid="${cardTestId}"]`);
    if (!card) return null;

    const img = card.querySelector('img');
    if (img?.src) {
      return img.src;
    }

    const allElements = Array.from(card.querySelectorAll('*'));
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const bgImg = style.backgroundImage;
      if (bgImg && bgImg.includes('pdok')) {
        const match = bgImg.match(/url\(["']?([^"')]+)["']?\)/);
        return match ? match[1] : null;
      }
    }

    return null;
  }, testId);
}

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

  test('verify PDOK URL returns valid image (200 OK)', async ({ request }) => {
    // Manually construct the URL using the same logic as the utility
    // This is to test the URL format independently of the React app
    // Using Tegenbosch 16, Eindhoven - BAG / Woningstats reference location
    // RD New coordinates from BAG / Woningstats
    const rdX = 157189.018;
    const rdY = 385806.139;

    const width = 800;
    const height = 600;
    const halfHeight = 40;  // 80m / 2
    const halfWidth = halfHeight * (width / height);  // Adjusted for aspect ratio

    const bbox = `${rdX - halfWidth},${rdY - halfHeight},${rdX + halfWidth},${rdY + halfHeight}`;

    const params = new URLSearchParams({
      service: 'WMS',
      request: 'GetMap',
      layers: 'Actueel_orthoHR',
      styles: '',
      format: 'image/png',
      transparent: 'true',
      version: '1.1.1',
      width: width.toString(),
      height: height.toString(),
      srs: 'EPSG:28992',
      BBOX: bbox,
    });

    const pdokUrl = `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?${params.toString()}`;

    console.log(`Testing PDOK URL: ${pdokUrl}`);

    // Fetch the URL and verify response
    const response = await request.get(pdokUrl);

    expect(response.status(), 'PDOK URL should return 200 OK').toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType, 'Response should be an image').toContain('image');

    // Verify response has content (not empty)
    const body = await response.body();
    expect(body.length, 'Image should have content').toBeGreaterThan(1000);

    console.log(`PDOK response: ${response.status()}, Content-Type: ${contentType}, Size: ${body.length} bytes`);
  });

  test('capture aerial imagery showcase for visual comparison', async ({ page }) => {
    // Navigate to the showcase page
    await page.goto('/showcase/pdok-aerial-imagery', { waitUntil: 'domcontentloaded' });

    // Wait for the showcase page to render
    await expect(page.locator('[data-testid="pdok-aerial-imagery-showcase"]')).toBeVisible({
      timeout: 30000,
    });

    // Verify aerial image components are present - focus on Tegenbosch (reference expectation)
    const tegenboschCard = page.locator('[data-testid="aerial-tegenbosch"]');
    await expect(tegenboschCard).toBeVisible();
    await expect
      .poll(() => getAerialImageSrc(page, 'aerial-tegenbosch'), { timeout: 30000 })
      .toContain('service.pdok.nl');

    // Verify marker is visible on the Tegenbosch card
    const marker = page.locator('[data-testid="aerial-tegenbosch-marker"]');
    await expect(marker).toBeVisible();

    // Verify address bar is visible
    const addressBar = page.locator('[data-testid="aerial-tegenbosch-address"]');
    await expect(addressBar).toBeVisible();

    await tegenboschCard.scrollIntoViewIfNeeded();
    await tegenboschCard.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Verify page title contains expected text
    const pageTitle = page.locator('[data-testid="pdok-aerial-imagery-showcase"]');
    await expect(pageTitle).toBeVisible();
  });

  test('verify aerial image cards render correctly', async ({ page }) => {
    // Navigate to the showcase page
    await page.goto('/showcase/pdok-aerial-imagery', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="pdok-aerial-imagery-showcase"]')).toBeVisible({
      timeout: 30000,
    });

    // Check that all three test location cards are rendered
    const locations = ['aerial-tegenbosch', 'aerial-dom-tower', 'aerial-deflectiespoelstraat'];

    for (const location of locations) {
      const card = page.locator(`[data-testid="${location}"]`);
      const isVisible = await card.isVisible().catch(() => false);
      console.log(`${location} visible: ${isVisible}`);
      expect(isVisible, `Card ${location} should be visible`).toBe(true);

      const image = page.locator(`[data-testid="${location}-image"]`);
      await expect(image, `${location} should render its aerial image`).toBeVisible();
    }

    const src = await getAerialImageSrc(page, 'aerial-tegenbosch');

    console.log(`Image source: ${src?.substring(0, 100)}...`);

    // URL should be a PDOK URL
    expect(src, 'Image should have PDOK URL').toBeTruthy();
    expect(src, 'Image src should be a PDOK URL').toContain('service.pdok.nl');
    expect(src, 'Image src should contain correct layer').toContain('Actueel_orthoHR');
    // URL-encoded EPSG:28992 becomes EPSG%3A28992
    expect(src, 'Image src should use RD New projection').toMatch(/EPSG(%3A|:)28992/);

    // Verify address bars show correct text for Tegenbosch
    const tegenboschAddress = page.locator('[data-testid="aerial-tegenbosch-address"]');
    await expect(tegenboschAddress).toContainText('Eindhoven');
  });

  test('verify URL utility generates correct format', async ({ page }) => {
    // Navigate to the showcase page which imports and uses the utility
    await page.goto('/showcase/pdok-aerial-imagery', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="pdok-aerial-imagery-showcase"]')).toBeVisible({
      timeout: 30000,
    });
    const src = await getAerialImageSrc(page, 'aerial-tegenbosch');

    console.log(`Found image src: ${src?.substring(0, 100)}...`);

    // Parse and validate URL structure
    expect(src, 'Should find PDOK URL in rendered component').toBeTruthy();
    const url = new URL(src!);

    // Verify base URL
    expect(url.origin).toBe('https://service.pdok.nl');
    expect(url.pathname).toBe('/hwh/luchtfotorgb/wms/v1_0');

    // Verify required WMS parameters
    expect(url.searchParams.get('service')).toBe('WMS');
    expect(url.searchParams.get('request')).toBe('GetMap');
    expect(url.searchParams.get('layers')).toBe('Actueel_orthoHR');
    expect(url.searchParams.get('format')).toBe('image/png');
    expect(url.searchParams.get('srs')).toBe('EPSG:28992');
    expect(url.searchParams.get('width')).toBe('800');
    expect(url.searchParams.get('height')).toBe('600');

    // Verify BBOX is present and has 4 coordinates
    const bbox = url.searchParams.get('BBOX');
    expect(bbox).toBeTruthy();
    const bboxParts = bbox!.split(',');
    expect(bboxParts.length).toBe(4);

    // All BBOX coordinates should be valid numbers (in RD New format ~100000-300000 range)
    bboxParts.forEach((coord, _index) => {
      const num = parseFloat(coord);
      expect(isNaN(num)).toBe(false);
      // RD coordinates for Netherlands are typically in range 0-300000
      expect(num).toBeGreaterThan(0);
      expect(num).toBeLessThan(500000);
    });

    console.log(`URL validation passed: ${url.toString().substring(0, 100)}...`);
    console.log(`BBOX: ${bbox}`);
  });
});

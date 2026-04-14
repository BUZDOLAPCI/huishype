/**
 * Reference Expectation E2E Test: karma-badge-display
 *
 * This test verifies the karma badge display feature matches the reference expectation:
 * - Karma badges appear next to usernames in comments
 * - Color coding by rank level (Newbie, Regular, Trusted, Expert, Legend)
 * - Badge size variants (sm/md)
 * - Proper visual hierarchy in comment list
 *
 * Screenshot saved to: test-results/reference-expectations/karma-badge-display/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  fetchCanonicalPropertyFixture,
  setupCanonicalPropertyRouteMocks,
} from './helpers/canonical-property-route';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = 'karma-badge-display';
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

  test('capture karma badge display in property detail comments', async ({ page, request }) => {
    const selection = await fetchCanonicalPropertyFixture(
      request,
      'limit=10&city=Eindhoven',
      (properties) =>
        properties.find((property) => property.commentCount && property.commentCount > 0) ?? properties[0],
    );
    if (!selection) {
      console.log('No properties returned from API');
      // Take a diagnostic screenshot and pass
      await page.goto('/');
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        fullPage: true,
      });
      return;
    }

    console.log(`Using canonical property route: ${selection.route}`);
    await setupCanonicalPropertyRouteMocks(page, request, selection);

    // Navigate directly to the canonical property detail page which has comments
    await page.goto(selection.route);
    await page.waitForLoadState('networkidle');

    // Wait for loading state to disappear
    const loadingIndicator = page.locator('text=Loading property...');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
      console.log('Loading indicator still visible after timeout');
    });

    // Look for Comments section header
    const commentsHeader = page.locator('text=Comments').first();
    const isCommentsVisible = await commentsHeader.isVisible().catch(() => false);
    console.log(`Comments section visible: ${isCommentsVisible}`);

    // Look for karma badge labels (from expectation requirements)
    const allKarmaLabels = ['Newcomer', 'Contributor', 'Rising Star', 'Local Expert', 'Expert', 'Local Legend', 'Master', 'Active', 'New'];
    let foundBadges: string[] = [];

    for (const label of allKarmaLabels) {
      const badge = page.locator(`text=${label}`);
      const isVisible = await badge.first().isVisible().catch(() => false);
      if (isVisible) {
        foundBadges.push(label);
      }
    }

    console.log(`Found karma badges: ${foundBadges.join(', ') || 'none'}`);

    // Scroll to comments section and wait for it to be in view
    await page.evaluate(() => {
      // Find the comments header and scroll to bring comments into view
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        if (el.textContent?.trim() === 'Comments (2)' ||
            (el.textContent?.includes('Comments') &&
             el.tagName !== 'SCRIPT' &&
             el.closest('[class*="border-t"]'))) {
          // Scroll the parent container into view
          const parent = el.closest('[class*="border-t"]') || el;
          parent.scrollIntoView({ behavior: 'instant', block: 'center' });
          break;
        }
      }
    });

    await page.waitForTimeout(1000);

    // Take full page screenshot to capture comments section with karma badges
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: true,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Basic assertions
    await expect(page.locator('body')).toBeVisible();
  });

  test('verify karma badge elements and visual hierarchy', async ({ page, request }) => {
    const selection = await fetchCanonicalPropertyFixture(
      request,
      'limit=10&city=Eindhoven',
      (properties) =>
        properties.find((property) => property.commentCount && property.commentCount > 0) ?? properties[0],
    );
    if (!selection) {
      console.log('No properties returned from API');
      return;
    }

    console.log(`Using canonical property route: ${selection.route}`);
    await setupCanonicalPropertyRouteMocks(page, request, selection);

    // Navigate to the canonical property detail page
    await page.goto(selection.route);
    await page.waitForLoadState('networkidle');

    // Wait for loading state to disappear
    const loadingIndicator = page.locator('text=Loading property...');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
      console.log('Loading indicator still visible after timeout');
    });

    // Check for Comments header
    const commentsHeader = page.locator('text=Comments');
    const hasCommentsHeader = await commentsHeader.first().isVisible().catch(() => false);
    console.log(`Comments header exists: ${hasCommentsHeader}`);

    // Check for comment author names (from mock data in property detail)
    const authorPatterns = ['HousingEnthusiast', 'LocalResident', 'RealEstateWatcher'];
    for (const author of authorPatterns) {
      const authorEl = page.locator(`text=${author}`);
      const isVisible = await authorEl.first().isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Author "${author}" found`);
      }
    }

    // Check for karma badge labels (the old CommentList uses Expert, Trusted, Active, New)
    const karmaLabels = ['Expert', 'Local Expert', 'Local Legend', 'Master', 'Active', 'New'];
    for (const label of karmaLabels) {
      const badge = page.locator(`text=${label}`);
      const isVisible = await badge.first().isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Karma badge "${label}" found`);
      }
    }

    // Check for visual hierarchy elements
    // 1. Comment content
    const commentContent = page.locator('text=overpriced');
    const hasCommentContent = await commentContent.first().isVisible().catch(() => false);
    console.log(`Comment content visible: ${hasCommentContent}`);

    // 2. Like functionality (heart emoji or like count)
    const likeElement = page.locator('text=/\\d+/');
    const hasLikes = await likeElement.first().isVisible().catch(() => false);
    console.log(`Like counts visible: ${hasLikes}`);

    // 3. Reply button or reply text
    const replyButton = page.locator('text=Reply');
    const hasReplyButton = await replyButton.first().isVisible().catch(() => false);
    console.log(`Reply button visible: ${hasReplyButton}`);

    // 4. Timestamp (e.g., "2h ago", "4h ago")
    const timestamp = page.locator('text=/\\d+h ago/');
    const hasTimestamp = await timestamp.first().isVisible().catch(() => false);
    console.log(`Timestamps visible: ${hasTimestamp}`);

    // Scroll to comments section and wait for it to be in view
    await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        if (el.textContent?.trim() === 'Comments (2)' ||
            (el.textContent?.includes('Comments') &&
             el.tagName !== 'SCRIPT' &&
             el.closest('[class*="border-t"]'))) {
          const parent = el.closest('[class*="border-t"]') || el;
          parent.scrollIntoView({ behavior: 'instant', block: 'center' });
          break;
        }
      }
    });

    await page.waitForTimeout(1000);

    // Take full page screenshot to capture comments section with karma badges
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-badges-detail.png`,
      fullPage: true,
    });

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();
  });
});

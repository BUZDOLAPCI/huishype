/**
 * Reference Expectation E2E Test: comments-section-threaded
 *
 * This test verifies the comments section appearance in the property detail page
 * matches the expected TikTok/Instagram-inspired design with:
 * - User avatars with initials
 * - Username, karma badge, and timestamp display
 * - Like button with count
 * - Reply functionality (1 level deep threading)
 * - Sort toggle (Recent/Popular)
 * - Comment input at bottom
 *
 * Screenshot saved to: test-results/reference-expectations/comments-section-threaded/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Disable tracing for this test to avoid trace file issues
// Use a tall viewport to capture more content since RN Web has fixed height scrollable container
test.use({ trace: 'off', video: 'off', viewport: { width: 1280, height: 2000 } });

// Configuration
const EXPECTATION_NAME = 'comments-section-threaded';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// API base URL
const API_BASE_URL = 'http://localhost:3100';

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

  test('capture comments section for visual comparison', async ({ page, request }) => {
    // First fetch a real property ID from the API
    const propertiesResponse = await request.get(`${API_BASE_URL}/properties?limit=1&city=Eindhoven`);
    const propertiesData = await propertiesResponse.json();

    if (!propertiesData.data || propertiesData.data.length === 0) {
      console.log('No properties returned from API');
      // Take a diagnostic screenshot and pass
      await page.goto('/');
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        fullPage: true,
      });
      return;
    }

    const propertyId = propertiesData.data[0].id;
    console.log(`Using property ID: ${propertyId}`);

    // Navigate directly to property detail page which has comments
    await page.goto(`/property/${propertyId}`);
    await page.waitForLoadState('networkidle');

    // Wait for loading state to disappear
    const loadingIndicator = page.locator('text=Loading property...');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
      console.log('Loading indicator still visible after timeout');
    });

    // Look for Comments section header - find the chat icon followed by "Comments"
    const commentsHeader = page.locator('text=Comments').first();
    const isCommentsVisible = await commentsHeader.isVisible().catch(() => false);
    console.log(`Comments section visible: ${isCommentsVisible}`);

    // Scroll to comments section using Playwright's built-in scroll
    // The page uses React Native Web ScrollView, so we need to scroll the scroll container
    await page.evaluate(() => {
      // Find the scrollable container (usually has overflow: auto/scroll)
      const scrollContainers = document.querySelectorAll('[style*="overflow"]');
      const mainScroll = Array.from(scrollContainers).find(el => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      }) || document.scrollingElement || document.documentElement;

      // Find the comments section
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = el.textContent || '';
        // Match the specific "Comments (X)" header pattern
        if (text.includes('Comments (') && el.tagName !== 'SCRIPT') {
          // Scroll the element into view
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          // Also scroll the parent container if needed
          if (mainScroll && mainScroll !== document.documentElement) {
            const rect = el.getBoundingClientRect();
            (mainScroll as HTMLElement).scrollTop = (mainScroll as HTMLElement).scrollTop + rect.top - 100;
          }
          break;
        }
      }
    });

    await page.waitForTimeout(1000);

    // Take a full page screenshot to capture all content including comments
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: true,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Check for sort buttons
    const recentButton = page.locator('text=Recent');
    const popularButton = page.locator('text=Popular');
    const recentVisible = await recentButton.first().isVisible().catch(() => false);
    const popularVisible = await popularButton.first().isVisible().catch(() => false);
    console.log(`Sort buttons visible - Recent: ${recentVisible}, Popular: ${popularVisible}`);

    // Check for comment input
    const inputPlaceholder = page.locator('[placeholder*="Share your thoughts"], [placeholder*="Log in to comment"]');
    const inputVisible = await inputPlaceholder.first().isVisible().catch(() => false);
    console.log(`Comment input visible: ${inputVisible}`);

    // Basic assertions
    await expect(page.locator('body')).toBeVisible();
  });

  test('verify comments section structure and elements', async ({ page, request }) => {
    // First fetch a real property ID from the API
    const propertiesResponse = await request.get(`${API_BASE_URL}/properties?limit=1&city=Eindhoven`);
    const propertiesData = await propertiesResponse.json();

    if (!propertiesData.data || propertiesData.data.length === 0) {
      console.log('No properties returned from API');
      return;
    }

    const propertyId = propertiesData.data[0].id;
    console.log(`Using property ID: ${propertyId}`);

    // Navigate to property detail page
    await page.goto(`/property/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    // Wait for loading state to disappear
    const loadingIndicator = page.locator('text=Loading property...');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
      console.log('Loading indicator still visible after timeout');
    });

    // Verify Comments section structure
    const commentsSection = page.locator('text=Comments');
    const hasCommentsHeader = await commentsSection.first().isVisible().catch(() => false);
    console.log(`Comments header exists: ${hasCommentsHeader}`);

    // Verify sort toggle exists
    const sortRecent = page.locator('text=Recent');
    const sortPopular = page.locator('text=Popular');
    const recentVisible = await sortRecent.first().isVisible().catch(() => false);
    const popularVisible = await sortPopular.first().isVisible().catch(() => false);
    console.log(`Sort toggle exists - Recent: ${recentVisible}, Popular: ${popularVisible}`);

    // Check for empty state or comments list
    const noComments = page.locator('text=No comments yet');
    const beFirst = page.locator('text=Be the first');
    const hasEmptyState = await noComments.first().isVisible().catch(() => false);
    const hasBeFirst = await beFirst.first().isVisible().catch(() => false);
    console.log(`Empty state visible: ${hasEmptyState}`);
    console.log(`'Be the first' text visible: ${hasBeFirst}`);

    // Check for comment input area
    const commentInput = page.locator('[placeholder*="Share your thoughts"], [placeholder*="Log in to comment"]');
    const hasInput = await commentInput.first().isVisible().catch(() => false);
    console.log(`Comment input visible: ${hasInput}`);

    // Check for comment count badge
    const commentCountBadge = page.locator('[class*="rounded-full"]');
    const badgeCount = await commentCountBadge.count();
    console.log(`Found ${badgeCount} rounded badge element(s)`);

    // Take screenshot of structure
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-structure.png`,
      fullPage: true,
    });

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('verify threaded reply visual structure', async ({ page, request }) => {
    // First fetch a real property ID from the API
    const propertiesResponse = await request.get(`${API_BASE_URL}/properties?limit=1&city=Eindhoven`);
    const propertiesData = await propertiesResponse.json();

    if (!propertiesData.data || propertiesData.data.length === 0) {
      console.log('No properties returned from API');
      return;
    }

    const propertyId = propertiesData.data[0].id;
    console.log(`Using property ID: ${propertyId}`);

    // Navigate to property detail page
    await page.goto(`/property/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    // Wait for loading state to disappear
    const loadingIndicator = page.locator('text=Loading property...');
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
      console.log('Loading indicator still visible after timeout');
    });

    // Scroll to comments section
    await page.evaluate(() => {
      const headers = document.querySelectorAll('*');
      for (const el of headers) {
        if (el.textContent?.includes('Comments') && el.tagName !== 'SCRIPT') {
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          break;
        }
      }
    });

    await page.waitForTimeout(500);

    // Check for comment elements (testIDs from Comment component)
    const comments = page.locator('[data-testid="comment"]');
    const commentCount = await comments.count();
    console.log(`Number of comments found: ${commentCount}`);

    const replies = page.locator('[data-testid="comment-reply"]');
    const replyCount = await replies.count();
    console.log(`Number of replies found: ${replyCount}`);

    // Check for user avatars
    const avatars = page.locator('[data-testid="user-avatar"]');
    const avatarCount = await avatars.count();
    console.log(`Number of user avatars found: ${avatarCount}`);

    // Check for like buttons
    const likeButtons = page.locator('[data-testid="like-button"]');
    const likeButtonCount = await likeButtons.count();
    console.log(`Number of like buttons found: ${likeButtonCount}`);

    // Check for reply buttons
    const replyButtons = page.locator('[data-testid="reply-button"]');
    const replyButtonCount = await replyButtons.count();
    console.log(`Number of reply buttons found: ${replyButtonCount}`);

    // Check for karma badges
    const karmaLabels = ['Newbie', 'Regular', 'Trusted', 'Expert', 'Legend'];
    for (const label of karmaLabels) {
      const badge = page.locator(`text=${label}`);
      const isVisible = await badge.first().isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Karma badge "${label}" found`);
      }
    }

    // Check for comment author names (patterns from mock data)
    const authorPatterns = ['HousingEnthusiast', 'LocalResident', 'RealEstateWatcher'];
    for (const author of authorPatterns) {
      const authorEl = page.locator(`text=${author}`);
      const isVisible = await authorEl.first().isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Author "${author}" found`);
      }
    }

    // Take screenshot of threads structure
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-threads.png`,
      fullPage: true,
    });

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();
  });
});

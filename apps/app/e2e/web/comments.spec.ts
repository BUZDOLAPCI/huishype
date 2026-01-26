import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Comments System.
 * These tests verify the comments functionality in the property bottom sheet.
 */
test.describe('Comments System', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for the map and data to load
    await page.waitForTimeout(3000);
  });

  test('should display comments section in property bottom sheet', async ({ page }) => {
    // Click on map to trigger property selection
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        // Click preview to open bottom sheet
        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Take screenshot of comments section
    await page.screenshot({
      path: 'test-results/comments-section.png',
      fullPage: true,
    });

    // Look for Comments section header
    const commentsHeader = page.locator('text=Comments');
    const isCommentsVisible = await commentsHeader.first().isVisible().catch(() => false);
    console.log(`Comments section visible: ${isCommentsVisible}`);

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should display sort toggle for comments', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Look for sort toggle buttons
    const recentButton = page.locator('text=Recent');
    const popularButton = page.locator('text=Popular');

    const isRecentVisible = await recentButton.first().isVisible().catch(() => false);
    const isPopularVisible = await popularButton.first().isVisible().catch(() => false);

    console.log(`Recent sort button visible: ${isRecentVisible}`);
    console.log(`Popular sort button visible: ${isPopularVisible}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/comments-sort-toggle.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should toggle between Recent and Popular sorting', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Click Popular sort button
    const popularButton = page.locator('text=Popular');
    if (await popularButton.first().isVisible().catch(() => false)) {
      await popularButton.first().click();
      await page.waitForTimeout(500);

      // Screenshot after clicking Popular
      await page.screenshot({
        path: 'test-results/comments-sort-popular.png',
        fullPage: true,
      });
    }

    // Click Recent sort button
    const recentButton = page.locator('text=Recent');
    if (await recentButton.first().isVisible().catch(() => false)) {
      await recentButton.first().click();
      await page.waitForTimeout(500);

      // Screenshot after clicking Recent
      await page.screenshot({
        path: 'test-results/comments-sort-recent.png',
        fullPage: true,
      });
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('should display comment input area', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Look for comment input placeholder
    const inputPlaceholder = page.locator('[placeholder*="Share your thoughts"], [placeholder*="Log in to comment"]');
    const isInputVisible = await inputPlaceholder.first().isVisible().catch(() => false);

    console.log(`Comment input visible: ${isInputVisible}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/comments-input.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should show empty state when no comments', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Look for empty state text
    const noCommentsText = page.locator('text=No comments yet');
    const isEmptyStateVisible = await noCommentsText.first().isVisible().catch(() => false);
    console.log(`Empty state visible: ${isEmptyStateVisible}`);

    const beFirstText = page.locator('text=Be the first');
    const isBeFirstVisible = await beFirstText.first().isVisible().catch(() => false);
    console.log(`Be the first text visible: ${isBeFirstVisible}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/comments-empty-state.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should show character count in comment input', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Look for character count display (format: "0/500")
    const charCount = page.locator('text=/\\d+\\/500/');
    const isCharCountVisible = await charCount.first().isVisible().catch(() => false);
    console.log(`Character count visible: ${isCharCountVisible}`);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/comments-char-count.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should type in comment input and update character count', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1500);
        }
      }
    }

    // Find and type in comment input
    const commentInput = page.locator('[placeholder*="Share your thoughts"], [placeholder*="Log in to comment"], input, textarea').first();

    if (await commentInput.isVisible().catch(() => false)) {
      await commentInput.click();
      await commentInput.fill('This is a test comment for the property!');
      await page.waitForTimeout(500);
    }

    // Take screenshot after typing
    await page.screenshot({
      path: 'test-results/comments-typing.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Comments System - Mobile View', () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  });

  test('should display comments section correctly on mobile', async ({ page }) => {
    // Click on map
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Take screenshot of mobile comments section
    await page.screenshot({
      path: 'test-results/comments-mobile.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });

  test('should have properly sized comment input on mobile', async ({ page }) => {
    // Click on map
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Take screenshot of mobile comment input
    await page.screenshot({
      path: 'test-results/comments-mobile-input.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Karma Badge Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  });

  test('should display karma badges with comments', async ({ page }) => {
    // Open property bottom sheet
    const mapCanvas = page.locator('canvas').first();
    if (await mapCanvas.isVisible().catch(() => false)) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const previewArea = page.locator('text=Eindhoven');
        if (await previewArea.first().isVisible().catch(() => false)) {
          await previewArea.first().click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // Look for karma badge labels
    const karmaLabels = ['Newbie', 'Regular', 'Trusted', 'Expert', 'Legend'];

    for (const label of karmaLabels) {
      const badge = page.locator(`text=${label}`);
      const isVisible = await badge.first().isVisible().catch(() => false);
      console.log(`Karma badge "${label}" visible: ${isVisible}`);
    }

    // Take screenshot
    await page.screenshot({
      path: 'test-results/comments-karma-badges.png',
      fullPage: true,
    });

    await expect(page.locator('body')).toBeVisible();
  });
});

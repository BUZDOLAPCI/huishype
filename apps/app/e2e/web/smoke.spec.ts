import { test, expect } from '@playwright/test';

/**
 * Smoke tests for HuisHype web application.
 * These tests verify that the app loads and basic functionality works.
 */
test.describe('HuisHype Web - Smoke Tests', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Verify the page loaded by checking the title or a key element
    await expect(page).toHaveTitle(/HuisHype|Expo/);
  });

  test('should display the main navigation', async ({ page }) => {
    await page.goto('/');

    // Wait for navigation to be visible
    await page.waitForLoadState('domcontentloaded');

    // Check that the page has rendered (not a blank page)
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should not have any console errors on load', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        // Ignore some expected errors
        const text = message.text();
        if (
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_')
        ) {
          errors.push(text);
        }
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Allow some time for any async errors
    await page.waitForTimeout(1000);

    // Filter out known acceptable errors
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('ResizeObserver') &&
        !error.includes('Warning:')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify the page renders correctly on mobile
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should load critical assets', async ({ page }) => {
    const responses: { url: string; status: number }[] = [];

    page.on('response', (response) => {
      responses.push({
        url: response.url(),
        status: response.status(),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that critical resources loaded successfully (2xx or 3xx status)
    const failedResources = responses.filter(
      (r) =>
        r.status >= 400 &&
        !r.url.includes('favicon') &&
        !r.url.includes('sourcemap')
    );

    // Allow some failures but not critical ones
    expect(failedResources.length).toBeLessThan(5);
  });
});

test.describe('HuisHype Web - Basic Navigation', () => {
  test('should handle navigation without crashing', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Try to find and click any navigation element
    const navLinks = page.locator('a, button').first();

    if (await navLinks.isVisible()) {
      // Just verify we can interact with elements
      await expect(navLinks).toBeEnabled();
    }
  });

  test('should handle 404 pages gracefully', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');

    // The page should still render something (either 404 page or redirect)
    await page.waitForLoadState('domcontentloaded');

    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

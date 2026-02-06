import { test, expect } from '@playwright/test';

/**
 * Smoke tests for HuisHype web application.
 * These tests verify that the app loads and renders its core structural elements.
 *
 * Note: Expo dev server does NOT set document.title, so we assert on DOM content only.
 */
test.describe('HuisHype Web - Smoke Tests', () => {
  test('should load the homepage with app shell', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The map container with data-testid="map-view" must be present
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView).toBeVisible();

    // The MapLibre canvas should be rendered inside the map container
    const mapCanvas = mapView.locator('canvas');
    await expect(mapCanvas).toBeVisible();
  });

  test('should display the tab navigation with Map and Feed tabs', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Tab bar should contain "Map" and "Feed" tab labels
    await expect(page.getByRole('link', { name: /Map/i }).or(page.getByText('Map'))).toBeVisible();
    await expect(page.getByRole('link', { name: /Feed/i }).or(page.getByText('Feed'))).toBeVisible();
  });

  test('should display the HuisHype header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The header title "HuisHype" should be visible (set via headerTitle in _layout.tsx)
    await expect(page.getByText('HuisHype')).toBeVisible();
  });

  test('should show the zoom level indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The zoom indicator shows "Zoom: <number>" and is always rendered
    await expect(page.getByText(/Zoom:\s*\d/)).toBeVisible();
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
    await page.waitForLoadState('networkidle');

    // Map view and canvas should still render on mobile
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView).toBeVisible();
    await expect(mapView.locator('canvas')).toBeVisible();

    // Tab navigation should still be accessible on mobile
    await expect(page.getByText('Map')).toBeVisible();
    await expect(page.getByText('Feed')).toBeVisible();
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
  test('should navigate to Feed tab and back', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify we start on the Map tab (map canvas visible)
    await expect(page.locator('[data-testid="map-view"]')).toBeVisible();

    // Click the Feed tab
    const feedTab = page.getByRole('link', { name: /Feed/i }).or(page.getByText('Feed'));
    await feedTab.click();
    await page.waitForLoadState('networkidle');

    // Feed header should now be visible
    await expect(page.getByText('Feed')).toBeVisible();

    // Navigate back to Map
    const mapTab = page.getByRole('link', { name: /Map/i }).or(page.getByText('Map'));
    await mapTab.click();
    await page.waitForLoadState('networkidle');

    // Map canvas should be visible again
    await expect(page.locator('[data-testid="map-view"]')).toBeVisible();
  });

  test('should handle 404 pages gracefully', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');

    // The page should still render something (either 404 page or redirect)
    await page.waitForLoadState('domcontentloaded');

    // At minimum the body should have content (not a blank white page)
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const bodyText = await body.textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
  });
});

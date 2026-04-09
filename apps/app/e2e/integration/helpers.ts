import { expect, type Page } from '@playwright/test';

export async function waitForMapReady(page: Page, timeout = 30_000): Promise<void> {
  const mapView = page.locator('[data-testid="map-view"]');

  await expect(mapView.first()).toBeVisible({ timeout });
  await expect(mapView.locator('canvas').first()).toBeVisible({ timeout });
  await page.locator('text=Loading map...').waitFor({ state: 'hidden', timeout }).catch(() => {});
}

export async function waitForFeedLoaded(page: Page, timeout = 30_000): Promise<void> {
  const loading = page.getByTestId('feed-loading');
  const firstCard = page.getByTestId('property-feed-card').first();

  await loading.waitFor({ state: 'hidden', timeout }).catch(() => {});
  await expect(firstCard).toBeVisible({ timeout });
}

export async function waitForPropertyDetailReady(
  page: Page,
  address: string,
  timeout = 30_000,
): Promise<void> {
  await expect(page.locator('[data-testid="property-header-carousel"]')).toBeVisible({ timeout });
  await expect(page.getByText(address, { exact: true })).toBeVisible({ timeout });
}

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

  const [addressTitle, locality] = address.split(',').map((part) => part.trim());
  await expect(page.getByText(addressTitle ?? address, { exact: true })).toBeVisible({ timeout });

  for (const token of locality?.split(/\s+/).filter(Boolean) ?? []) {
    await expect(page.locator('body')).toContainText(token, { timeout });
  }
}

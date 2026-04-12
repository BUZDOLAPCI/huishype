import { expect, type Page } from '@playwright/test';

export async function waitForMapReady(page: Page, timeout = 30_000): Promise<void> {
  const mapRegion = page.getByRole('region', { name: 'Map' });

  await expect(mapRegion).toBeVisible({ timeout });
  await page.locator('text=Loading map...').waitFor({ state: 'hidden', timeout }).catch(() => {});
}

export async function waitForFeedLoaded(page: Page, timeout = 60_000): Promise<void> {
  const loading = page.getByTestId('feed-loading');
  const firstCard = page.getByTestId('property-feed-card').first();

  await loading.waitFor({ state: 'hidden', timeout }).catch(() => {});
  await expect(firstCard).toBeVisible({ timeout });
}

export async function waitForPropertyDetailReady(
  page: Page,
  address: string,
  timeout = 60_000,
): Promise<void> {
  await expect(page.getByTestId('property-back-button').last()).toBeVisible({ timeout });
  await expect(page.getByText(address, { exact: true }).last()).toBeVisible({ timeout });
}

export async function clickTabBarItem(
  page: Page,
  tabName: 'index' | 'feed' | 'saved' | 'profile',
  timeout = 15_000,
): Promise<void> {
  const tabBar = page.getByTestId('custom-tab-bar').last();
  await expect(tabBar).toBeVisible({ timeout });
  const tab = tabBar.getByTestId(`tab-${tabName}`).last();
  await expect(tab).toBeVisible({ timeout });
  await tab.click({ force: true });
}

export async function navigateClientSide(page: Page, path: string): Promise<void> {
  await page.evaluate((targetPath) => {
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

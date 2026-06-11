import { expect, test } from '@playwright/test';

import { attachConsoleErrorCollector, expectNoConsoleErrors } from '../helpers/console';

test.use({ trace: 'off' });

test.describe('Static settings routing', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = attachConsoleErrorCollector(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('huishype_analytics_consent', 'denied');
    });
  });

  test.afterEach(async () => {
    expectNoConsoleErrors(consoleErrors);
  });

  test('uses explicit parent routes for page back buttons on direct entry', async ({ page }) => {
    await page.goto('/settings/language', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('settings-language-subview')).toBeVisible();

    await page.getByTestId('profile-settings-back').click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();

    await page.goto('/terms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('terms-screen')).toBeVisible();

    await page.getByTestId('static-page-back').click();

    await expect(page).toHaveURL(/\/settings\/legal$/);
    await expect(page.getByTestId('settings-legal-submenu')).toBeVisible();
  });

  test('keeps browser back history for normal static page navigation', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();

    await page.getByTestId('settings-language-row').click();
    await expect(page).toHaveURL(/\/settings\/language$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();
  });
});

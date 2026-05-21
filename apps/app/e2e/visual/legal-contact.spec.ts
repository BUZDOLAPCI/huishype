import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

import { attachConsoleErrorCollector, expectNoConsoleErrors } from '../helpers/console';

const EXPECTATION_NAME = 'static-support';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

test.use({ trace: 'off', video: 'off' });

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = attachConsoleErrorCollector(page);
  });

  test.afterEach(async () => {
    expectNoConsoleErrors(consoleErrors);
  });

  test('captures help, glossary, legal submenu, and contact pages', async ({ page }) => {
    await page.goto('/profile-settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();
    await expect(page.getByTestId('settings-help-row')).toBeVisible();
    await expect(page.getByTestId('settings-contact-row')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/settings-main-current.png`,
      fullPage: false,
    });

    await page.getByTestId('settings-help-row').click();
    await expect(page.getByTestId('help-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/help-hub-current.png`,
      fullPage: false,
    });

    await page.getByTestId('help-category-prices-and-valuations').click();
    await expect(page.getByTestId('help-category-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prices and valuations' })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/help-category-current.png`,
      fullPage: false,
    });

    await page.getByTestId('category-article-price-guesses').click();
    await expect(page.getByTestId('help-article-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How do price guesses work?' })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/help-article-current.png`,
      fullPage: false,
    });

    await page.goto('/glossary', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('glossary-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Glossary' })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/glossary-current.png`,
      fullPage: false,
    });

    await page.getByTestId('glossary-term-woz-value').click();
    await expect(page.getByTestId('glossary-term-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'WOZ value' })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/glossary-term-current.png`,
      fullPage: false,
    });

    await page.goto('/profile-settings', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('settings-legal-row').click();
    await expect(page.getByTestId('settings-legal-submenu')).toBeVisible();
    await expect(page.getByTestId('settings-cookies-row')).toBeVisible();
    await expect(page.getByTestId('settings-data-privacy-row')).toBeVisible();
    await expect(page.getByTestId('settings-sharing-permissions-row')).toBeVisible();
    await expect(page.getByTestId('settings-open-source-licenses-row')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/settings-legal-current.png`,
      fullPage: false,
    });

    await page.getByTestId('settings-open-source-licenses-row').click();
    await expect(page.getByTestId('settings-open-source-licenses-subview')).toBeVisible();
    await expect(page.getByText('@maplibre/maplibre-react-native')).toBeVisible();
    await expect(page.getByText('maplibre-gl', { exact: true })).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/open-source-licenses-current.png`,
      fullPage: false,
    });
    const licensePagePromise = page.waitForEvent('popup');
    await page.getByLabel('Open BSD-3-Clause license').first().click();
    const licensePage = await licensePagePromise;
    await expect.poll(() => licensePage.url()).toBe('https://spdx.org/licenses/BSD-3-Clause.html');
    await licensePage.close();
    const sourcePagePromise = page.waitForEvent('popup');
    await page.getByLabel('Open source link for maplibre-gl').click();
    const sourcePage = await sourcePagePromise;
    await expect.poll(() => sourcePage.url()).toBe('https://maplibre.org/');
    await sourcePage.close();
    await page.getByTestId('profile-settings-back').click();
    await expect(page.getByTestId('settings-terms-row')).toBeVisible();

    await page.getByTestId('settings-terms-row').click();
    await expect(page.getByTestId('terms-screen')).toBeVisible();
    await expect(page.getByText('Last updated: May 21, 2026')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/terms-current.png`,
      fullPage: false,
    });

    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('privacy-screen')).toBeVisible();
    await expect(page.getByText('Privacy Policy')).toBeVisible();
    await expect(page.getByText(/including in the EU/)).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/privacy-current.png`,
      fullPage: false,
    });

    await page.goto('/cookies', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('cookies-screen')).toBeVisible();
    await expect(page.getByText('Cookie Policy')).toBeVisible();
    await expectProfileTabVisuallySelected(page);

    await page.goto('/data-privacy', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('data-privacy-screen')).toBeVisible();
    await expect(page.getByText('Data and Privacy Choices')).toBeVisible();
    await expectProfileTabVisuallySelected(page);

    await page.goto('/sharing-permissions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sharing-permissions-screen')).toBeVisible();
    await expect(page.getByText('Sharing Permissions')).toBeVisible();
    await expectProfileTabVisuallySelected(page);

    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('contact-screen')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.route('**/contact', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Message received.' }),
      });
    });
    await page.getByTestId('contact-name-input').fill('Visual Tester');
    await page.getByTestId('contact-email-input').fill('visual@example.com');
    await page.getByTestId('contact-message-input').fill('Please check a HuisHype contact flow.');
    await page.getByTestId('contact-submit-button').click();
    await expect(page.getByTestId('contact-success-message')).toBeVisible();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-current.png`,
      fullPage: false,
    });
  });
});

async function expectProfileTabVisuallySelected(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('tab-profile')).toBeVisible();
  await expect
    .poll(async () => {
      return await page.getByTestId('tab-profile').evaluate((node) => {
        return window.getComputedStyle(node).backgroundColor;
      });
    })
    .not.toBe('rgba(0, 0, 0, 0)');
}

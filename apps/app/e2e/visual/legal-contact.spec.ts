import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

import {
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
} from '../helpers/console';

const EXPECTATION_NAME = 'legal-contact';
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

  test('captures settings legal submenu and direct legal/contact pages', async ({ page }) => {
    await page.goto('/profile-settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();
    await page.getByTestId('settings-legal-row').click();
    await expect(page.getByTestId('settings-legal-submenu')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/settings-legal-current.png`,
      fullPage: false,
    });

    await page.getByTestId('settings-terms-row').click();
    await expect(page.getByTestId('terms-screen')).toBeVisible();
    await expect(page.getByText('Last updated: May 20, 2026')).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/terms-current.png`,
      fullPage: false,
    });

    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('privacy-screen')).toBeVisible();
    await expect(page.getByText('Privacy Policy')).toBeVisible();
    await expect(page.getByText(/EU or UK data protection law/)).toBeVisible();
    await expectProfileTabVisuallySelected(page);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/privacy-current.png`,
      fullPage: false,
    });

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
  await expect.poll(async () => {
    return await page.getByTestId('tab-profile').evaluate((node) => {
      return window.getComputedStyle(node).backgroundColor;
    });
  }).not.toBe('rgba(0, 0, 0, 0)');
}

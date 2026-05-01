/**
 * Visual coverage for the first-run HuisHype welcome modal on the map screen.
 *
 * Screenshot saved to: test-results/reference-expectations/welcome-modal/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const EXPECTATION_NAME = 'welcome-modal';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    await page.addInitScript((storageKey) => {
      const sessionKey = `${storageKey}:test-cleared`;
      if (!window.sessionStorage.getItem(sessionKey)) {
        window.localStorage.removeItem(storageKey);
        window.sessionStorage.setItem(sessionKey, '1');
      }
    }, WELCOME_MODAL_DISMISSED_KEY);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((warning) => console.log(`  - ${warning}`));
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('shows once, persists dismissal, and reopens from the map info button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    await expect(page.getByTestId('welcome-modal-card')).toBeVisible();
    await expect(page.getByText('Welcome to HuisHype')).toBeVisible();
    await expect(page.getByText('Browse the map')).toBeVisible();
    await expect(page.getByText("Guess what it's worth")).toBeVisible();
    await expect(page.getByText('See what people notice')).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: true,
    });

    await page.getByTestId('welcome-modal-dismiss-button').click();
    await expect(page.getByTestId('welcome-modal-card')).toBeHidden();

    await page.reload();
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await expect(page.getByTestId('welcome-modal-card')).toBeHidden();

    await page.getByTestId('map-welcome-info-button').click();
    await expect(page.getByTestId('welcome-modal-card')).toBeVisible();
  });
});

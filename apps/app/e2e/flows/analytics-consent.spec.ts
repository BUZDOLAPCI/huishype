import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    dataLayer?: unknown[];
    __HUISHYPE_GA4_SCRIPT_LOADED__?: boolean;
  }
}

const GA4_MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID;
const CONSENT_KEY = 'huishype_analytics_consent';
const WELCOME_KEY = 'huishype_welcome_modal_dismissed_v1';

test.describe('Analytics consent', () => {
  test.skip(!GA4_MEASUREMENT_ID, 'EXPO_PUBLIC_GA4_MEASUREMENT_ID is required for GA4 E2E checks');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ consentKey, welcomeKey }) => {
        window.localStorage.removeItem(consentKey);
        window.localStorage.setItem(welcomeKey, '1');
      },
      { consentKey: CONSENT_KEY, welcomeKey: WELCOME_KEY },
    );
  });

  test('decline prevents the GA4 script request', async ({ page }) => {
    const gaRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('googletagmanager.com/gtag/js')) {
        gaRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page.getByTestId('analytics-consent-prompt')).toBeVisible();
    await page.getByTestId('analytics-consent-decline').click();

    await expect(page.getByTestId('analytics-consent-prompt')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(gaRequests).toEqual([]);
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY))
      .toBe('denied');
  });

  test('accept loads GA4 and records page views on navigation', async ({ page }) => {
    await page.route('https://www.googletagmanager.com/gtag/js**', async (route) => {
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'window.__HUISHYPE_GA4_SCRIPT_LOADED__ = true;',
      });
    });

    const gaScriptRequest = page.waitForRequest(/googletagmanager\.com\/gtag\/js/);

    await page.goto('/');
    await expect(page.getByTestId('analytics-consent-prompt')).toBeVisible();
    await page.getByTestId('analytics-consent-accept').click();

    await gaScriptRequest;
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            window.dataLayer?.some(
              (entry) => Array.isArray(entry) && entry[0] === 'event' && entry[1] === 'page_view',
            ),
          ),
        ),
      )
      .toBe(true);

    const initialPageViews = await page.evaluate(() => {
      return (
        window.dataLayer?.filter(
          (entry) => Array.isArray(entry) && entry[0] === 'event' && entry[1] === 'page_view',
        ).length ?? 0
      );
    });

    await page.getByTestId('tab-profile').click();
    await page.getByTestId('profile-settings').click();
    await page.getByTestId('settings-open').click();
    await expect(page.getByTestId('profile-settings-screen')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const pageViews =
            window.dataLayer?.filter(
              (entry) => Array.isArray(entry) && entry[0] === 'event' && entry[1] === 'page_view',
            ) ?? [];
          return pageViews.length;
        }),
      )
      .toBeGreaterThan(initialPageViews);
  });
});

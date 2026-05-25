import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

import {
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
} from '../helpers/console';
import {
  fetchCanonicalPropertyFixture,
  setupCanonicalPropertyRouteMocks,
} from './helpers/canonical-property-route';

const EXPECTATION_NAME = 'woz-official-valuation-skeleton';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const EXPECTED_WOZ_YEAR = 2025;

test.use({ trace: 'off', video: 'off' });

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];
  let kadasterRequests: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
    kadasterRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('api.kadaster.nl')) {
        kadasterRequests.push(url);
      }
    });
  });

  test.afterEach(async () => {
    expectNoConsoleErrors(consoleErrors);
    expect(kadasterRequests, 'Expected no direct browser requests to Kadaster').toHaveLength(0);
  });

  test('captures the WOZ skeleton while backend hydration is pending', async ({ page }) => {
    const selection = await fetchCanonicalPropertyFixture(
      page.request,
      'limit=10&countryCode=NL',
      (properties) => properties.find((property) => property.countryCode === 'NL') ?? properties[0],
    );
    if (!selection) {
      test.skip(true, 'No canonical NL property was available for the WOZ skeleton visual test.');
      return;
    }

    await setupCanonicalPropertyRouteMocks(page, page.request, selection, {
      transformPropertyDetail: (detail) => ({
        ...(typeof detail === 'object' && detail !== null ? detail : selection.property),
        countryCode: 'NL',
        officialValuation: null,
        officialValuationYear: null,
        officialValuationSourceFetch: {
          source: 'woz',
          expectedValuationYear: EXPECTED_WOZ_YEAR,
          supportsClientFetch: {
            web: false,
            native: false,
          },
        },
      }),
    });

    await page.route(`**/properties/${selection.property.id}/official-valuations/hydrate`, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          propertyId: selection.property.id,
          source: 'woz',
          status: 'queued',
          valuationYear: EXPECTED_WOZ_YEAR,
          officialValuation: null,
          officialValuationYear: null,
          officialValuationVerified: false,
          job: {
            id: '00000000-0000-4000-8000-000000000001',
            state: 'queued',
            nextAttemptAt: null,
          },
        }),
      });
    });

    await page.route(
      `**/properties/${selection.property.id}/official-valuations/current**`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            propertyId: selection.property.id,
            source: 'woz',
            expectedValuationYear: EXPECTED_WOZ_YEAR,
            officialValuation: null,
            officialValuationYear: null,
            officialValuationVerified: false,
            job: {
              id: '00000000-0000-4000-8000-000000000001',
              state: 'queued',
              valuationYear: EXPECTED_WOZ_YEAR,
              attemptCount: 0,
              nextAttemptAt: null,
              lastAttemptAt: null,
              lastSuccessAt: null,
              lastError: null,
            },
            sourceState: null,
          }),
        });
      },
    );

    await page.goto(selection.route, { waitUntil: 'domcontentloaded' });

    const valuationCard = page.getByTestId('price-snapshot-valuation-card');
    const valuationSkeleton = page.getByTestId('price-snapshot-valuation-card-value-skeleton');

    await expect(valuationCard).toBeVisible();
    await expect(valuationSkeleton).toBeVisible();
    await valuationCard.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
    });
  });
});

import { expect, test } from '@playwright/test';
import type { ListingReadItem } from '@huishype/shared';
import { attachConsoleErrorCollector, expectNoConsoleErrors } from '../helpers/console';
import {
  fetchCanonicalPropertyFixture,
  setupCanonicalPropertyRouteMocks,
} from './helpers/canonical-property-route';

test.use({ trace: 'off', video: 'off' });

// The backend owns the grace deadline; these cases exercise its read contract
// without using the browser clock or inferring an outcome from observation age.
for (const activeEligible of [true, false]) {
  test(`listing availability ${activeEligible ? 'during grace' : 'after expiry'} preserves source history`, async ({ page }, testInfo) => {
    const consoleErrors = attachConsoleErrorCollector(page, []);
    const selection = await fetchCanonicalPropertyFixture(page.request, 'limit=1&countryCode=NL');
    expect(selection, 'The listing lifecycle test requires a canonical property fixture').not.toBeNull();
    if (!selection) throw new Error('Missing canonical property fixture');

    await page.addInitScript(() => {
      localStorage.setItem('huishype_welcome_modal_dismissed_v1', 'true');
    });
    await setupCanonicalPropertyRouteMocks(page, page.request, selection, {
      transformPropertyDetail: (detail) => ({
        ...(typeof detail === 'object' && detail !== null ? detail : selection.property),
        hasListing: true,
        hasActiveListing: activeEligible,
        latestListingStatus: 'active',
        marketState: activeEligible ? 'for-sale' : 'not-listed',
        askingPrice: activeEligible ? 425000 : null,
        officialValuationSourceFetch: null,
      }),
    });

    const listing: ListingReadItem = {
      id: '00000000-0000-4000-8000-000000000091',
      propertyId: selection.property.id,
      sourceName: 'funda',
      sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-123/',
      canonicalUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-123/',
      displayUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-123/',
      sourceListingId: '123',
      askingPrice: 425000,
      priceType: 'sale',
      currency: 'EUR',
      thumbnailUrl: null,
      ogTitle: null,
      livingAreaM2: null,
      numRooms: null,
      energyLabel: null,
      status: 'active',
      activeEligible,
      candidateHandoffState: null,
      verificationState: 'validation_failed',
      reasonCode: null,
      listedAt: '2026-08-01T12:00:00.000Z',
      soldAt: null,
      rentedAt: null,
      withdrawnAt: null,
      firstSeenAt: '2026-08-01T12:00:00.000Z',
      lastSeenAt: '2026-08-15T12:00:00.000Z',
      lifecycleDate: '2026-08-01T12:00:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
    };
    await page.route(`**/properties/${selection.property.id}/listings**`, async (route) => {
      await route.fulfill({ json: { data: [listing] } });
    });

    await page.goto(selection.route, { waitUntil: 'domcontentloaded' });
    const group = page.getByTestId(activeEligible ? 'current-listings' : 'past-listings');
    await group.scrollIntoViewIfNeeded();
    await expect(group).toBeVisible();
    await expect(group.getByRole('link', { name: 'View on Funda' })).toBeVisible();
    await expect(group.getByText(/^Listed /)).toBeVisible();
    await expect(group.getByText(/425/)).toBeVisible();
    await expect(group.getByText(/stale|checking|freshness|expired|validation/i)).toHaveCount(0);
    await expect(group.getByText(/^(Sold|Rented|Withdrawn)$/)).toHaveCount(0);

    if (activeEligible) {
      await expect(group.getByText('For sale', { exact: true })).toBeVisible();
      await expect(page.getByTestId('past-listings')).toHaveCount(0);
    } else {
      await expect(group.getByText('Past listings (1)', { exact: true })).toBeVisible();
      await expect(group.getByText(/^Asking price /)).toBeVisible();
      await expect(page.getByTestId('current-listings')).toHaveCount(0);
      await expect(group.getByText(/^(For sale|For rent)$/)).toHaveCount(0);
    }

    await group.screenshot({ path: testInfo.outputPath(`listing-${activeEligible ? 'grace' : 'past'}.png`) });
    expectNoConsoleErrors(consoleErrors);
  });
}

import { expect, test } from '@playwright/test';
import type { ListingReadItem } from '@huishype/shared';
import { attachConsoleErrorCollector, expectNoConsoleErrors } from '../helpers/console';
import { fetchCanonicalPropertyFixture, setupCanonicalPropertyRouteMocks } from './helpers/canonical-property-route';

test.use({ trace: 'off', video: 'off' });

test('listing links retain source price periods, area units and nonstandard conditions', async ({ page }, testInfo) => {
  const consoleErrors = attachConsoleErrorCollector(page, []);
  const selection = await fetchCanonicalPropertyFixture(page.request, 'limit=1&countryCode=NL');
  if (!selection) throw new Error('Missing canonical property fixture');
  await page.addInitScript(() => localStorage.setItem('huishype_welcome_modal_dismissed_v1', 'true'));
  await setupCanonicalPropertyRouteMocks(page, page.request, selection, {
    transformPropertyDetail: (detail) => ({
      ...(typeof detail === 'object' && detail !== null ? detail : selection.property),
      hasListing: true, hasActiveListing: true, latestListingStatus: 'active', marketState: 'for-rent',
      askingPrice: null, officialValuationSourceFetch: null,
    }),
  });
  const base: ListingReadItem = {
    id: 'weekly', propertyId: selection.property.id, sourceName: 'funda',
    sourceUrl: 'https://www.funda.nl/detail/huur/eindhoven/huis-123/',
    canonicalUrl: null, displayUrl: null, sourceListingId: '123',
    askingPrice: 500, priceType: 'rent', pricePeriod: 'week', priceUnit: 'listing', priceCondition: 'asking',
    currency: 'EUR', thumbnailUrl: null, ogTitle: null, livingAreaM2: null, numRooms: null, energyLabel: null,
    status: 'active', activeEligible: true, candidateHandoffState: null, verificationState: 'validated', reasonCode: null,
    listedAt: null, soldAt: null, rentedAt: null, withdrawnAt: null, firstSeenAt: null, lastSeenAt: null,
    lifecycleDate: null, createdAt: '2026-09-01T12:00:00Z',
  };
  const listings: ListingReadItem[] = [
    base,
    { ...base, id: 'monthly-area', askingPrice: 20, pricePeriod: 'month', priceUnit: 'm2' },
    { ...base, id: 'requested', askingPrice: null, priceCondition: 'on_request' },
    { ...base, id: 'auction', askingPrice: 250000, priceType: 'sale', pricePeriod: 'total', priceCondition: 'auction' },
  ];
  await page.route(`**/properties/${selection.property.id}/listings**`, (route) => route.fulfill({ json: { data: listings } }));
  await page.goto(selection.route, { waitUntil: 'domcontentloaded' });
  const group = page.getByTestId('current-listings');
  await group.scrollIntoViewIfNeeded();
  await expect(group.getByText(/500.*\/wk$/)).toBeVisible();
  await expect(group.getByText(/20.*\/m²\/mo$/)).toBeVisible();
  await expect(group.getByText('Price on request', { exact: true })).toBeVisible();
  await expect(group.getByText(/^Auction .*250/)).toBeVisible();
  await expect(group.getByText(/500.*\/mo$/)).toHaveCount(0);
  await group.screenshot({ path: testInfo.outputPath('listing-price-units.png') });
  expectNoConsoleErrors(consoleErrors);
});

import { doesMapSelectionMatchFilters } from '../mapFilterSelection';

describe('doesMapSelectionMatchFilters', () => {
  it('returns false when a selected property falls outside a sale price filter', () => {
    expect(
      doesMapSelectionMatchFilters({
        previewProperty: {
          id: 'property-1',
          address: 'Teststraat 12',
          city: 'Eindhoven',
          askingPrice: 325000,
        },
        selectedProperty: null,
        filters: {
          salePriceFrom: 500000,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: 'all',
        },
      }),
    ).toBe(false);
  });

  it('returns true when a selected property carries the canonical market state', () => {
    expect(
      doesMapSelectionMatchFilters({
        previewProperty: null,
        selectedProperty: {
          id: 'property-2',
          nationalId: null,
          countryCode: 'NL',
          address: 'Teststraat 20',
          city: 'Eindhoven',
          postalCode: '5611AA',
          geometry: null,
          yearBuilt: null,
          floorAreaM2: null,
          status: 'active',
          officialValuation: 410000,
          hasListing: false,
          hasActiveListing: false,
          marketState: 'not-listed',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          activityLevel: 'cold',
          commentCount: 0,
          guessCount: 0,
          viewCount: 0,
          uniqueViewers: 0,
          socialScore: 0,
          recentSocialScore: 0,
        },
        filters: {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['not-listed'],
          activity: 'all',
        },
      }),
    ).toBe(true);
  });

  it('uses the separate public activity facet instead of legacy activity-level guesses', () => {
    expect(
      doesMapSelectionMatchFilters({
        previewProperty: {
          id: 'property-3',
          address: 'Teststraat 30',
          city: 'Eindhoven',
          marketState: 'for-sale',
          socialScore: 10,
          recentSocialScore: 0,
        },
        selectedProperty: null,
        filters: {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale'],
          activity: 'recent',
        },
      }),
    ).toBe(false);
  });
});

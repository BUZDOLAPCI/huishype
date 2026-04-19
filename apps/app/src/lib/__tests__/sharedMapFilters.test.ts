import {
  doesMapFilterCandidateMatch,
  getMapPriceSuggestions,
  getMapVisiblePriceModes,
  isMapStatusPillActive,
  toggleMapStatusPill,
} from '../sharedMapFilters';

describe('sharedMapFilters price suggestions', () => {
  it('prepends a typed custom price and filters presets by digit prefix', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '125', {
      filterByPrefix: true,
    });

    expect(suggestions[0]).toMatchObject({
      value: '125',
      custom: true,
    });
    expect(suggestions[1]).toMatchObject({
      value: '125000',
      custom: false,
    });
    expect(suggestions[2]).toMatchObject({
      value: '1250000',
      custom: false,
    });
    expect(suggestions).toHaveLength(3);
  });

  it('skips the custom row when the typed digits exactly match a preset', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '600000', {
      filterByPrefix: true,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        value: '600000',
        custom: false,
      }),
    ]);
  });

  it('includes a no-max option for upper bounds', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '');

    expect(suggestions.at(-1)).toMatchObject({
      value: '',
      label: 'No max',
    });
  });

  it('omits the no-max option once upper-bound suggestions are filtered', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '12', {
      filterByPrefix: true,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        value: '12',
        custom: true,
      }),
      expect.objectContaining({
        value: '125000',
        custom: false,
      }),
      expect.objectContaining({
        value: '1250000',
        custom: false,
      }),
    ]);
  });

  it('shows the full list again when a populated field is reopened without typing', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '600000');

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '600000',
        custom: false,
      }),
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
        custom: false,
      }),
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '5000000',
        custom: false,
      }),
    );
  });

  it('keeps a reopened custom value as the first row before the full preset list', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '612345');

    expect(suggestions[0]).toMatchObject({
      value: '612345',
      custom: true,
    });
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
        custom: false,
      }),
    );
  });

  it('keeps no-max visible when a populated upper bound is reopened without typing', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '850000');

    expect(suggestions.at(-1)).toMatchObject({
      value: '',
      label: 'No max',
    });
  });

  it('does not prefix-filter a typed zero, matching funda reopen behavior', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '0', {
      filterByPrefix: true,
    });

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
      }),
    );
  });

  it('returns sale and rent modes from the current market-state selection', () => {
    expect(getMapVisiblePriceModes(['for-sale', 'for-rent'])).toEqual(['sale', 'rent']);
    expect(getMapVisiblePriceModes(['for-rent', 'rented'])).toEqual(['rent']);
    expect(getMapVisiblePriceModes(['for-sale', 'sold'])).toEqual(['sale']);
  });

  it('does not apply sale bounds to rent-state candidates', () => {
    expect(
      doesMapFilterCandidateMatch(
        {
          activeRentAskingPrice: 1800,
          marketState: 'for-rent',
        },
        {
          salePriceFrom: 500000,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: 2000,
          marketState: ['for-rent'],
          activity: 'all',
        },
      ),
    ).toBe(true);
  });

  it('applies the public activity facet independently of market state', () => {
    expect(
      doesMapFilterCandidateMatch(
        {
          marketState: 'for-sale',
          socialScore: 12,
          recentSocialScore: 0,
        },
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale'],
          activity: 'social',
        },
      ),
    ).toBe(true);

    expect(
      doesMapFilterCandidateMatch(
        {
          marketState: 'for-sale',
          socialScore: 12,
          recentSocialScore: 0,
        },
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale'],
          activity: 'recent',
        },
      ),
    ).toBe(false);
  });

  it('treats the default market-state set as no status pills selected', () => {
    expect(
      isMapStatusPillActive(
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: 'all',
        },
        'for-sale',
      ),
    ).toBe(false);
  });

  it('toggles status pills into explicit filtering and back to the default set', () => {
    const soldOnly = toggleMapStatusPill(
      {
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
        activity: 'all',
      },
      'sold',
    );
    expect(soldOnly.marketState).toEqual(['sold']);

    const reset = toggleMapStatusPill(soldOnly, 'sold');
    expect(reset.marketState).toEqual([
      'for-sale',
      'for-rent',
      'sold',
      'rented',
      'not-listed',
    ]);
    expect(reset.activity).toBe('all');
  });
});

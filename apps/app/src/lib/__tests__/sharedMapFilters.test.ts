import {
  doesMapFilterCandidateMatch,
  getMapPriceSuggestions,
  getMapVisiblePriceModes,
} from '../sharedMapFilters';

describe('sharedMapFilters price suggestions', () => {
  it('prepends a typed custom price and filters presets by digit prefix', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '125');

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
    const suggestions = getMapPriceSuggestions('sale', 'from', '600000');

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
    const suggestions = getMapPriceSuggestions('sale', 'to', '12');

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
        },
      ),
    ).toBe(true);
  });
});

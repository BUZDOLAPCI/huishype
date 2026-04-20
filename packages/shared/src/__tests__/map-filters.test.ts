import { describe, expect, it } from 'vitest';
import {
  MAP_FILTER_CATEGORIES,
  MAP_MARKET_STATES,
  areMapFiltersDefault,
  areMapFiltersEqual,
  buildFollowingNearbyGroupPath,
  buildFollowingPropertyTileTemplateUrl,
  createDefaultMapFilters,
  getCanonicalMapFilterSignature,
  getMapFilterPillSummary,
  getPropertyMarketFilterSearchString,
  getOrderedMapFilterCategories,
  getRentEffectivePrice,
  getSaleEffectivePrice,
  hasOnlyAllowedMapFilterQueryParams,
  isMapFilterCategoryActive,
  isMapFilterCategoryDefault,
  normalizeMapFilterQueryParams,
  normalizeMapFilters,
  parseMapFiltersFromSearchParams,
  resetMapFilterCategory,
  serializeMapFiltersToSearchParams,
  updateMapFilterSearchParams,
} from '../utils/index.js';

describe('map filter normalization', () => {
  it('creates canonical defaults', () => {
    expect(createDefaultMapFilters()).toEqual({
      salePriceFrom: null,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: [...MAP_MARKET_STATES],
      activity: 'all',
    });
    expect(MAP_FILTER_CATEGORIES).toEqual(['price', 'marketState', 'activity']);
  });

  it('normalizes ranges, invalid numbers, and market-state order', () => {
    expect(
      normalizeMapFilters({
        salePriceFrom: 700000,
        salePriceTo: 250000,
        rentPriceFrom: Number.NaN,
        rentPriceTo: -200,
        marketState: ['sold', 'for-sale', 'sold'],
      }),
    ).toEqual({
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'sold'],
      activity: 'all',
    });
  });

  it('treats an empty market-state selection as the default set', () => {
    expect(
      normalizeMapFilters({
        ...createDefaultMapFilters(),
        marketState: [],
      }),
    ).toEqual(createDefaultMapFilters());
  });
});

describe('map filter activity and reset helpers', () => {
  const activeFilters = {
    salePriceFrom: 350000,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: 1800,
    marketState: ['for-sale', 'not-listed'] as const,
    activity: 'all' as const,
  };

  it('detects default and active categories', () => {
    expect(areMapFiltersDefault(createDefaultMapFilters())).toBe(true);
    expect(isMapFilterCategoryDefault(createDefaultMapFilters(), 'price')).toBe(true);
    expect(isMapFilterCategoryActive(activeFilters, 'price')).toBe(true);
    expect(isMapFilterCategoryActive(activeFilters, 'marketState')).toBe(true);
  });

  it('orders active categories first while keeping stable category order', () => {
    expect(getOrderedMapFilterCategories(activeFilters)).toEqual([
      'price',
      'marketState',
      'activity',
    ]);

    expect(
      getOrderedMapFilterCategories({
        ...createDefaultMapFilters(),
        rentPriceTo: 1800,
      }),
    ).toEqual(['price', 'marketState', 'activity']);

    expect(
      getOrderedMapFilterCategories({
        ...createDefaultMapFilters(),
        activity: 'recent',
      }),
    ).toEqual(['activity', 'price', 'marketState']);
  });

  it('resets only the requested category', () => {
    expect(resetMapFilterCategory(activeFilters, 'price')).toEqual({
      salePriceFrom: null,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'not-listed'],
      activity: 'all',
    });

    expect(resetMapFilterCategory(activeFilters, 'marketState')).toEqual({
      salePriceFrom: 350000,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: 1800,
      marketState: [...MAP_MARKET_STATES],
      activity: 'all',
    });

    expect(
      resetMapFilterCategory(
        {
          ...activeFilters,
          activity: 'social',
        },
        'activity',
      ),
    ).toEqual({
      salePriceFrom: 350000,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: 1800,
      marketState: ['for-sale', 'not-listed'],
      activity: 'all',
    });
  });
});

describe('map filter summaries and signatures', () => {
  it('summarizes price and market-state badges', () => {
    const filters = normalizeMapFilters({
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: 2200,
      marketState: ['sold'],
      activity: 'recent',
    });

    expect(getMapFilterPillSummary('price', filters)).toBe('Sale € 250K - € 700K');
    expect(getMapFilterPillSummary('marketState', filters)).toBe('1 selected');
    expect(getMapFilterPillSummary('activity', filters)).toBe('Recently Active');
    expect(getMapFilterPillSummary('marketState', createDefaultMapFilters())).toBe(
      null,
    );
    expect(getMapFilterPillSummary('activity', createDefaultMapFilters())).toBe(null);
  });

  it('builds a canonical signature and equality across equivalent inputs', () => {
    const left = {
      salePriceFrom: 700000,
      salePriceTo: 250000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['not-listed', 'for-sale'] as const,
      activity: 'social' as const,
    };
    const right = {
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'not-listed'] as const,
      activity: 'social' as const,
    };

    expect(getCanonicalMapFilterSignature(left)).toBe(
      'salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=social',
    );
    expect(areMapFiltersEqual(left, right)).toBe(true);
  });
});

describe('map filter query param helpers', () => {
  it('serializes and parses canonical filter query params', () => {
    const filters = {
      salePriceFrom: null,
      salePriceTo: 700000,
      rentPriceFrom: 1200,
      rentPriceTo: null,
      marketState: ['not-listed', 'for-sale'] as const,
      activity: 'recent' as const,
    };

    const serialized = serializeMapFiltersToSearchParams(filters);
    expect(serialized.toString()).toBe(
      'salePriceTo=700000&rentPriceFrom=1200&marketState=for-sale%2Cnot-listed&activity=recent',
    );

    expect(parseMapFiltersFromSearchParams(serialized)).toEqual({
      salePriceFrom: null,
      salePriceTo: 700000,
      rentPriceFrom: 1200,
      rentPriceTo: null,
      marketState: ['for-sale', 'not-listed'],
      activity: 'recent',
    });
  });

  it('normalizes map filter params while rejecting unknown keys at the whitelist layer', () => {
    const params = new URLSearchParams(
      'marketState=not-listed,for-sale&salePriceFrom=700000&salePriceTo=250000&activity=social',
    );

    expect(hasOnlyAllowedMapFilterQueryParams(params)).toBe(true);
    expect(normalizeMapFilterQueryParams(params).toString()).toBe(
      'salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=social',
    );
    expect(
      hasOnlyAllowedMapFilterQueryParams(
        new URLSearchParams('salePriceTo=700000&foo=bar'),
      ),
    ).toBe(false);
  });

  it('updates existing search params without disturbing non-filter keys', () => {
    const updated = updateMapFilterSearchParams(
      new URLSearchParams('foo=bar&marketState=sold'),
      {
        ...createDefaultMapFilters(),
        rentPriceTo: 2400,
      },
    );

    expect(updated.toString()).toBe('foo=bar&rentPriceTo=2400');
  });

  it('builds Following tile and nearby URLs without serializing the public activity filter', () => {
    const filters = {
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['not-listed', 'for-sale'] as const,
      activity: 'recent' as const,
    };

    expect(getPropertyMarketFilterSearchString(filters)).toBe(
      '?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );
    expect(buildFollowingPropertyTileTemplateUrl('http://api.test', filters)).toBe(
      'http://api.test/tiles/following/properties/{z}/{x}/{y}.pbf?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );
    expect(buildFollowingNearbyGroupPath(5.47, 51.44, 14, filters)).toBe(
      '/properties/following-nearby?lon=5.47&lat=51.44&zoom=14&salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed',
    );
  });
});

describe('effective price helpers', () => {
  it('uses the locked sale effective-price fallback order', () => {
    expect(
      getSaleEffectivePrice({
        activeSaleAskingPrice: 600000,
        lastSoldPrice: 550000,
        canonicalFmv: 500000,
        officialValuation: 450000,
      }),
    ).toBe(600000);

    expect(
      getSaleEffectivePrice({
        activeSaleAskingPrice: null,
        lastSoldPrice: 550000,
        canonicalFmv: 500000,
        officialValuation: 450000,
      }),
    ).toBe(550000);

    expect(
      getSaleEffectivePrice({
        activeSaleAskingPrice: null,
        lastSoldPrice: null,
        canonicalFmv: 500000,
        officialValuation: 450000,
      }),
    ).toBe(500000);
  });

  it('keeps rent effective price separate from sale facts', () => {
    expect(
      getRentEffectivePrice({
        activeRentAskingPrice: null,
        lastRentedPrice: 1800,
      }),
    ).toBe(1800);
    expect(getRentEffectivePrice({})).toBeNull();
  });
});

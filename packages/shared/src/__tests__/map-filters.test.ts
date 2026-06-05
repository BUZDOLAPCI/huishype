import { describe, expect, it } from 'vitest';
import {
  MAP_FILTER_CATEGORIES,
  MAP_MARKET_STATES,
  areMapFiltersDefault,
  areMapFiltersEqual,
  buildFollowingNearbyGroupPath,
  buildFollowingPropertyTileTemplateUrl,
  buildNearbyGroupPath,
  buildPropertyTileTemplateUrl,
  buildResolveTapPath,
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
  parseLocationFilterToken,
  parseMapFiltersFromSearchParams,
  resetMapFilterCategory,
  serializeLocationFilterToken,
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
      areas: [],
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
      })
    ).toEqual({
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'sold'],
      activity: 'all',
      areas: [],
    });
  });

  it('treats an empty market-state selection as the default set', () => {
    expect(
      normalizeMapFilters({
        ...createDefaultMapFilters(),
        marketState: [],
      })
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
      })
    ).toEqual(['price', 'marketState', 'activity']);

    expect(
      getOrderedMapFilterCategories({
        ...createDefaultMapFilters(),
        activity: 'today',
      })
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
      areas: [],
    });

    expect(resetMapFilterCategory(activeFilters, 'marketState')).toEqual({
      salePriceFrom: 350000,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: 1800,
      marketState: [...MAP_MARKET_STATES],
      activity: 'all',
      areas: [],
    });

    expect(
      resetMapFilterCategory(
        {
          ...activeFilters,
          activity: 'all-time',
        },
        'activity'
      )
    ).toEqual({
      salePriceFrom: 350000,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: 1800,
      marketState: ['for-sale', 'not-listed'],
      activity: 'all',
      areas: [],
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
      activity: '10d',
    });

    expect(getMapFilterPillSummary('price', filters)).toBe('Sale € 250K - € 700K');
    expect(getMapFilterPillSummary('marketState', filters)).toBe('1 selected');
    expect(getMapFilterPillSummary('activity', filters)).toBe('10 Days');
    expect(getMapFilterPillSummary('marketState', createDefaultMapFilters())).toBe(null);
    expect(getMapFilterPillSummary('activity', createDefaultMapFilters())).toBe(null);
  });

  it('builds a canonical signature and equality across equivalent inputs', () => {
    const left = {
      salePriceFrom: 700000,
      salePriceTo: 250000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['not-listed', 'for-sale'] as const,
      activity: 'all-time' as const,
    };
    const right = {
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'not-listed'] as const,
      activity: 'all-time' as const,
    };

    expect(getCanonicalMapFilterSignature(left)).toBe(
      'salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=all-time'
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
      activity: 'today' as const,
    };

    const serialized = serializeMapFiltersToSearchParams(filters);
    expect(serialized.toString()).toBe(
      'salePriceTo=700000&rentPriceFrom=1200&marketState=for-sale%2Cnot-listed&activity=today'
    );

    expect(parseMapFiltersFromSearchParams(serialized)).toEqual({
      salePriceFrom: null,
      salePriceTo: 700000,
      rentPriceFrom: 1200,
      rentPriceTo: null,
      marketState: ['for-sale', 'not-listed'],
      activity: 'today',
      areas: [],
    });
  });

  it('serializes repeated readable area tokens through tile and nearby URL builders', () => {
    const filters = {
      ...createDefaultMapFilters(),
      areas: [
        { type: 'city' as const, countryCode: 'NL', value: 'eindhoven', label: 'Eindhoven' },
        { type: 'city' as const, countryCode: 'NL', value: 'waalre', label: 'Waalre' },
      ],
    };

    expect(serializeMapFiltersToSearchParams(filters).toString()).toBe(
      'area=city%3ANL%3Aeindhoven&area=city%3ANL%3Awaalre'
    );
    expect(buildPropertyTileTemplateUrl('http://api.test', filters)).toBe(
      'http://api.test/tiles/properties/{z}/{x}/{y}.pbf?area=city%3ANL%3Aeindhoven&area=city%3ANL%3Awaalre'
    );
    expect(buildNearbyGroupPath(5.47, 51.44, 14, filters)).toBe(
      '/properties/nearby?lon=5.47&lat=51.44&zoom=14&area=city%3ANL%3Aeindhoven&area=city%3ANL%3Awaalre'
    );
    expect(parseMapFiltersFromSearchParams(serializeMapFiltersToSearchParams(filters)).areas).toEqual([
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'eindhoven' }),
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'waalre' }),
    ]);
  });

  it('keeps street and postcode context readable in area URL tokens', () => {
    const streetToken = {
      type: 'street' as const,
      countryCode: 'NL',
      value: 'boschdijk',
      label: 'Boschdijk',
      city: 'Eindhoven',
      region: 'Noord-Brabant',
    };
    const postcodeToken = {
      type: 'postcode' as const,
      countryCode: 'NL',
      value: '5612-ma',
      label: '5612 MA',
      city: 'Eindhoven',
    };

    expect(serializeLocationFilterToken(streetToken)).toBe('street:NL:boschdijk:city=eindhoven');
    expect(parseLocationFilterToken('street:NL:boschdijk:city=eindhoven')).toEqual(
      expect.objectContaining({
        type: 'street',
        countryCode: 'NL',
        value: 'boschdijk',
        city: 'Eindhoven',
      })
    );
    expect(serializeLocationFilterToken(postcodeToken)).toBe('postcode:NL:5612ma:city=eindhoven');
    expect(serializeMapFiltersToSearchParams({ ...createDefaultMapFilters(), areas: [streetToken] }).toString()).toBe(
      'area=street%3ANL%3Aboschdijk%3Acity%3Deindhoven'
    );
  });

  it('canonicalizes compact, spaced, and dashed postcode tokens to one identity', () => {
    const dashedPostcodeToken = parseLocationFilterToken('postcode:NL:5651-ha');
    expect(dashedPostcodeToken).not.toBeNull();

    const filters = normalizeMapFilters({
      ...createDefaultMapFilters(),
      areas: [
        { type: 'postcode', countryCode: 'NL', value: '5651HA', label: '5651HA' },
        { type: 'postcode', countryCode: 'NL', value: '5651 HA', label: '5651 HA' },
        dashedPostcodeToken!,
      ],
    });

    expect(filters.areas).toHaveLength(1);
    expect(filters.areas?.[0]).toEqual(
      expect.objectContaining({
        type: 'postcode',
        countryCode: 'NL',
        value: '5651ha',
      })
    );
    expect(serializeMapFiltersToSearchParams(filters).toString()).toBe(
      'area=postcode%3ANL%3A5651ha'
    );
  });

  it('normalizes map filter params while rejecting unknown keys at the whitelist layer', () => {
    const params = new URLSearchParams(
      'marketState=not-listed,for-sale&salePriceFrom=700000&salePriceTo=250000&activity=30d'
    );

    expect(hasOnlyAllowedMapFilterQueryParams(params)).toBe(true);
    expect(normalizeMapFilterQueryParams(params).toString()).toBe(
      'salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=30d'
    );
    expect(
      hasOnlyAllowedMapFilterQueryParams(new URLSearchParams('salePriceTo=700000&foo=bar'))
    ).toBe(false);
  });

  it('updates existing search params without disturbing non-filter keys', () => {
    const updated = updateMapFilterSearchParams(new URLSearchParams('foo=bar&marketState=sold'), {
      ...createDefaultMapFilters(),
      rentPriceTo: 2400,
    });

    expect(updated.toString()).toBe('foo=bar&rentPriceTo=2400');
  });

  it('builds Following tile and nearby URLs without serializing the public activity filter', () => {
    const filters = {
      salePriceFrom: 250000,
      salePriceTo: 700000,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['not-listed', 'for-sale'] as const,
      activity: 'today' as const,
    };

    expect(getPropertyMarketFilterSearchString(filters)).toBe(
      '?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed'
    );
    expect(buildFollowingPropertyTileTemplateUrl('http://api.test', filters)).toBe(
      'http://api.test/tiles/following/properties/{z}/{x}/{y}.pbf?salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=today'
    );
    expect(buildFollowingNearbyGroupPath(5.47, 51.44, 14, filters)).toBe(
      '/properties/following-nearby?lon=5.47&lat=51.44&zoom=14&salePriceFrom=250000&salePriceTo=700000&marketState=for-sale%2Cnot-listed&activity=today'
    );
  });

  it('serializes exact pyramid node identity for public nearby lookup only as a pair', () => {
    expect(
      buildNearbyGroupPath(5.47, 51.44, 14, createDefaultMapFilters(), {
        pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
        pyramidNodeId: 'pyramid-node-9007199254740993999',
      })
    ).toBe(
      '/properties/nearby?lon=5.47&lat=51.44&zoom=14&pyramidVersionId=9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11&pyramidNodeId=pyramid-node-9007199254740993999'
    );

    expect(
      buildNearbyGroupPath(5.47, 51.44, 14, createDefaultMapFilters(), {
        pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
      })
    ).toBe('/properties/nearby?lon=5.47&lat=51.44&zoom=14');
  });

  it('serializes the physical tap resolver path without map filters', () => {
    expect(buildResolveTapPath(5.47, 51.44, 17.5)).toBe(
      '/properties/resolve-tap?lon=5.47&lat=51.44&zoom=17.5'
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
      })
    ).toBe(600000);

    expect(
      getSaleEffectivePrice({
        activeSaleAskingPrice: null,
        lastSoldPrice: 550000,
        canonicalFmv: 500000,
        officialValuation: 450000,
      })
    ).toBe(550000);

    expect(
      getSaleEffectivePrice({
        activeSaleAskingPrice: null,
        lastSoldPrice: null,
        canonicalFmv: 500000,
        officialValuation: 450000,
      })
    ).toBe(500000);
  });

  it('keeps rent effective price separate from sale facts', () => {
    expect(
      getRentEffectivePrice({
        activeRentAskingPrice: null,
        lastRentedPrice: 1800,
      })
    ).toBe(1800);
    expect(getRentEffectivePrice({})).toBeNull();
  });
});

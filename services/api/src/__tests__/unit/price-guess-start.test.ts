import { describe, expect, it } from '@jest/globals';
import {
  buildPriceGuessSummaryScopes,
  choosePriceGuessStart,
  isSaleMarketSummaryListingFact,
  normalizeListingPriceTypeForGuessStart,
  type PriceGuessMarketSummary,
  type PriceGuessPropertyFacts,
} from '../../services/price-guess-start.js';

const baseProperty: PriceGuessPropertyFacts = {
  id: '00000000-0000-0000-0000-000000000001',
  countryCode: 'NL',
  postalCode: '1234 AB',
  city: 'Eindhoven',
  region: 'Noord-Brabant',
  officialValuation: 300_000,
  floorAreaM2: 100,
};

function summary(overrides: Partial<PriceGuessMarketSummary> = {}): PriceGuessMarketSummary {
  return {
    countryCode: 'NL',
    scopeType: 'postal_prefix',
    scopeKey: '1234',
    medianAskingToOfficialRatio: 1.3,
    ratioSampleSize: 12,
    medianAskingPerM2: 4_500,
    perM2SampleSize: 12,
    refreshedAt: new Date('2026-04-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('price guess start chooser', () => {
  it('suppresses priceGuessStart when an active sale asking price exists', () => {
    expect(
      choosePriceGuessStart({
        property: baseProperty,
        activeListingAskingPrice: 425_000,
        summary: summary(),
      }),
    ).toBeUndefined();
  });

  it('uses adjusted official valuation with enough local ratio samples', () => {
    const start = choosePriceGuessStart({
      property: baseProperty,
      activeListingAskingPrice: null,
      summary: summary({ medianAskingToOfficialRatio: 1.3, ratioSampleSize: 20 }),
    });

    expect(start).toEqual({
      price: 345_000,
      source: 'official_valuation_adjusted',
      confidence: 'usable',
      sampleSize: 20,
    });
  });

  it('shrinks sparse ratios toward official valuation', () => {
    const start = choosePriceGuessStart({
      property: baseProperty,
      activeListingAskingPrice: null,
      summary: summary({ medianAskingToOfficialRatio: 1.5, ratioSampleSize: 8 }),
    });

    expect(start?.price).toBe(345_000);
  });

  it('falls back to comparable EUR/m2 when official valuation is missing', () => {
    const start = choosePriceGuessStart({
      property: { ...baseProperty, officialValuation: null, floorAreaM2: 80 },
      activeListingAskingPrice: null,
      summary: summary({ medianAskingPerM2: 5_000, perM2SampleSize: 8 }),
    });

    expect(start).toEqual({
      price: 400_000,
      source: 'local_comparable_price_per_m2',
      confidence: 'usable',
      sampleSize: 8,
    });
  });

  it('falls back to official valuation when comparable ratios are too sparse', () => {
    const start = choosePriceGuessStart({
      property: baseProperty,
      activeListingAskingPrice: null,
      summary: summary({ ratioSampleSize: 7, perM2SampleSize: 7 }),
    });

    expect(start).toEqual({
      price: 300_000,
      source: 'official_valuation',
      confidence: 'weak',
      sampleSize: 0,
    });
  });

  it('falls back to country default when no useful property data exists', () => {
    const start = choosePriceGuessStart({
      property: { ...baseProperty, officialValuation: null, floorAreaM2: null },
      activeListingAskingPrice: null,
      summary: null,
    });

    expect(start).toEqual({
      price: 350_000,
      source: 'country_default',
      confidence: 'weak',
      sampleSize: 0,
    });
  });

  it('does not cap high adjusted official valuation starts', () => {
    const start = choosePriceGuessStart({
      property: { ...baseProperty, officialValuation: 1_900_000 },
      activeListingAskingPrice: null,
      summary: summary({ medianAskingToOfficialRatio: 1.9, ratioSampleSize: 100 }),
    });

    expect(start?.price).toBe(2_565_000);
  });

  it('does not cap high official valuation fallback starts', () => {
    const start = choosePriceGuessStart({
      property: { ...baseProperty, officialValuation: 12_952_000 },
      activeListingAskingPrice: null,
      summary: null,
    });

    expect(start?.price).toBe(12_950_000);
  });

  it('does not cap high comparable EUR/m2 starts', () => {
    const start = choosePriceGuessStart({
      property: { ...baseProperty, officialValuation: null, floorAreaM2: 400 },
      activeListingAskingPrice: null,
      summary: summary({ medianAskingPerM2: 8_000, perM2SampleSize: 12 }),
    });

    expect(start?.price).toBe(3_200_000);
  });
});

describe('price guess listing compatibility helpers', () => {
  it('normalizes Funda buy to sale', () => {
    expect(normalizeListingPriceTypeForGuessStart('funda', 'buy')).toBe('sale');
  });

  it('does not normalize blank or missing price types to sale', () => {
    expect(normalizeListingPriceTypeForGuessStart('funda', '')).toBeNull();
    expect(normalizeListingPriceTypeForGuessStart('funda', null)).toBeNull();
  });

  it('excludes Pararius rent rows from sale summaries', () => {
    expect(
      isSaleMarketSummaryListingFact({
        sourceName: 'pararius',
        status: 'active',
        priceType: 'rent',
        askingPrice: 2_000,
      }),
    ).toBe(false);
  });

  it('accepts active Funda sale-compatible rows in the market-summary range', () => {
    expect(
      isSaleMarketSummaryListingFact({
        sourceName: 'funda',
        status: 'active',
        priceType: 'buy',
        askingPrice: 400_000,
      }),
    ).toBe(true);
  });

  it('excludes active Funda sale rows above the market-summary ceiling', () => {
    expect(
      isSaleMarketSummaryListingFact({
        sourceName: 'funda',
        status: 'active',
        priceType: 'buy',
        askingPrice: 2_500_000,
      }),
    ).toBe(false);
  });
});

describe('price guess summary scopes', () => {
  it('cascades NL postal prefix before city, region, and country', () => {
    expect(buildPriceGuessSummaryScopes(baseProperty)).toEqual([
      { scopeType: 'postal_prefix', scopeKey: '1234' },
      { scopeType: 'city', scopeKey: 'eindhoven' },
      { scopeType: 'region', scopeKey: 'noord-brabant' },
      { scopeType: 'country', scopeKey: 'NL' },
    ]);
  });

  it('skips postal scope for countries without an explicit price-guess postal rule', () => {
    expect(
      buildPriceGuessSummaryScopes({
        ...baseProperty,
        countryCode: 'DE',
        postalCode: '10115',
      })[0],
    ).toEqual({ scopeType: 'city', scopeKey: 'eindhoven' });
  });
});

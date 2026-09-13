import { describe, expect, it } from '@jest/globals';
import { getComparableAskingPrice } from './listing-price-units.js';

const sale = { askingPrice: 400_000, sourceName: 'funda', priceType: 'sale', pricePeriod: 'total', priceUnit: 'listing', priceCondition: 'asking' };
const rent = { ...sale, askingPrice: 1_500, priceType: 'rent', pricePeriod: 'month' };

describe('comparable listing price units', () => {
  it('uses total sale and monthly rental asking amounts without converting source values', () => {
    expect(getComparableAskingPrice(sale)).toBe(400_000);
    expect(getComparableAskingPrice({ ...sale, priceType: 'buy' })).toBe(400_000);
    expect(getComparableAskingPrice(rent)).toBe(1_500);
    expect(getComparableAskingPrice({ ...rent, sourceName: 'pararius', priceType: null })).toBe(1_500);
    expect(getComparableAskingPrice({ ...rent, sourceName: 'pararius', priceType: 'unknown' })).toBe(1_500);
  });

  it('excludes weekly/daily/yearly rent and per-area prices from standard price projections', () => {
    for (const pricePeriod of ['week', 'day', 'year', 'total', 'unknown', null]) {
      expect(getComparableAskingPrice({ ...rent, pricePeriod })).toBeNull();
    }
    for (const listing of [sale, rent]) {
      expect(getComparableAskingPrice({ ...listing, priceUnit: 'm2' })).toBeNull();
      expect(getComparableAskingPrice({ ...listing, priceUnit: null })).toBeNull();
    }
  });

  it('does not use auctions, requested prices, unknown conditions or missing transaction types', () => {
    for (const priceCondition of ['on_request', 'auction', 'unknown', null]) {
      expect(getComparableAskingPrice({ ...sale, priceCondition })).toBeNull();
    }
    expect(getComparableAskingPrice({ ...sale, priceType: null })).toBeNull();
    expect(getComparableAskingPrice({ ...sale, askingPrice: 0 })).toBeNull();
  });
});

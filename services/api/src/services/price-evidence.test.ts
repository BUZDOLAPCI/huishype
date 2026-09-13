import { describe, expect, it } from '@jest/globals';
import { classifySourcePriceKind, isAchievedSalePrice, priceHistoryEventForEvidence } from './price-evidence.js';

describe('price evidence', () => {
  it('never infers an achieved amount from sold/rented status or untyped history', () => {
    for (const event of ['sold', 'rented', 'status_change']) {
      expect(classifySourcePriceKind(event)).toBe('unknown');
      expect(classifySourcePriceKind(event, 'unknown')).toBe('unknown');
      expect(classifySourcePriceKind(event, 'asking')).toBe('asking');
    }
  });

  it('accepts explicit achieved evidence only for transaction events', () => {
    expect(classifySourcePriceKind('sold', 'achieved')).toBe('achieved');
    expect(classifySourcePriceKind('rented', 'achieved')).toBe('achieved');
    expect(classifySourcePriceKind('status_change', 'achieved')).toBe('unknown');
    for (const event of ['asking_price', 'price_change', 'initial', 'mirror_refresh', 'user_submission']) {
      expect(classifySourcePriceKind(event, 'achieved')).toBe('asking');
    }
  });

  it('projects an asking amount as asking history even if the listing was sold', () => {
    expect(priceHistoryEventForEvidence('sold', 'asking')).toBe('asking_price');
    expect(priceHistoryEventForEvidence('rented', 'asking')).toBe('asking_price');
    expect(priceHistoryEventForEvidence('price_change', 'asking')).toBe('price_change');
    expect(priceHistoryEventForEvidence('sold', 'unknown')).toBe('sold');
  });

  it('only resolves positive, finite and explicitly achieved sale amounts', () => {
    expect(isAchievedSalePrice({ eventType: 'sold', priceKind: 'achieved', price: 400_000 })).toBe(true);
    for (const priceKind of ['asking', 'unknown', null, undefined]) {
      expect(isAchievedSalePrice({ eventType: 'sold', priceKind, price: 400_000 })).toBe(false);
    }
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isAchievedSalePrice({ eventType: 'sold', priceKind: 'achieved', price })).toBe(false);
    }
    expect(isAchievedSalePrice({ eventType: 'rented', priceKind: 'achieved', price: 1_500 })).toBe(false);
  });
});

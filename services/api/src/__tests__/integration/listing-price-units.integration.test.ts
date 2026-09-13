import { describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { comparableAskingPriceSql, getComparableAskingPrice, type ListingPriceUnits } from '../../services/listing-price-units.js';

describe('bulk listing price unit projection', () => {
  it('matches the comparable-price policy without treating weekly rent or per-m2 amounts as total monthly/sale prices', async () => {
    const baseline: ListingPriceUnits = {
      sourceName: 'funda', priceType: 'sale', askingPrice: 400_000,
      pricePeriod: 'total', priceUnit: 'listing', priceCondition: 'asking',
    };
    const cases: ListingPriceUnits[] = [
      baseline,
      { ...baseline, sourceName: 'pararius', priceType: null, askingPrice: 1500, pricePeriod: 'month' },
      { ...baseline, sourceName: 'pararius', priceType: 'unknown', askingPrice: 1500, pricePeriod: 'month' },
      { ...baseline, priceType: 'buy' },
      { ...baseline, priceType: 'rent', askingPrice: 1500, pricePeriod: 'month' },
      { ...baseline, priceType: 'rent', askingPrice: 500, pricePeriod: 'week' },
      { ...baseline, priceType: 'rent', askingPrice: 18000, pricePeriod: 'year' },
      { ...baseline, priceType: 'rent', askingPrice: 70, pricePeriod: 'day' },
      { ...baseline, askingPrice: 4500, priceUnit: 'm2' },
      { ...baseline, priceCondition: 'on_request' },
      { ...baseline, priceCondition: 'auction' },
      { ...baseline, pricePeriod: null },
      { ...baseline, priceUnit: null },
      { ...baseline, priceCondition: null },
      { ...baseline, askingPrice: null },
    ];
    for (const value of cases) {
      const rows = await db.execute<{ projected: string | number | null }>(sql`
        SELECT ${comparableAskingPriceSql('cl')} AS projected
        FROM (VALUES (
          ${value.sourceName}::text, ${value.priceType}::text, ${value.askingPrice}::bigint,
          ${value.pricePeriod}::text, ${value.priceUnit}::text, ${value.priceCondition}::text
        )) cl(source_name, price_type, asking_price, price_period, price_unit, price_condition)
      `);
      const actual = rows[0].projected == null ? null : Number(rows[0].projected);
      expect({ input: value, price: actual }).toEqual({ input: value, price: getComparableAskingPrice(value) });
    }
  });
});

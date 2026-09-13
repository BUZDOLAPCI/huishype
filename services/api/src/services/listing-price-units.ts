import { sql, type SQL } from 'drizzle-orm';

export interface ListingPriceUnits {
  askingPrice?: number | null;
  sourceName?: string | null;
  priceType?: string | null;
  pricePeriod?: string | null;
  priceUnit?: string | null;
  priceCondition?: string | null;
}

/** Common total sale and monthly rental prices only; source amounts stay intact. */
export function getComparableAskingPrice(input: ListingPriceUnits): number | null {
  if (input.askingPrice == null || !Number.isFinite(input.askingPrice) || input.askingPrice <= 0
    || input.priceUnit !== 'listing' || input.priceCondition !== 'asking') return null;
  const priceType = input.priceType?.trim().toLowerCase();
  const sale = priceType === 'sale'
    || (priceType === 'buy' && input.sourceName?.trim().toLowerCase() === 'funda');
  const rent = priceType === 'rent'
    || (!sale && input.sourceName?.trim().toLowerCase() === 'pararius');
  return (sale && input.pricePeriod === 'total') || (rent && input.pricePeriod === 'month')
    ? input.askingPrice : null;
}

/** Same policy for bulk listing/map/filter queries that bypass the canonical view. */
export function comparableAskingPriceSql(alias = 'cl'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid listing SQL alias');
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`CASE WHEN ${column('asking_price')} > 0
    AND ${column('price_unit')} = 'listing'
    AND ${column('price_condition')} = 'asking'
    AND (
      (${column('price_period')} = 'total' AND (
        lower(btrim(${column('price_type')})) = 'sale'
        OR (lower(btrim(${column('source_name')})) = 'funda' AND lower(btrim(${column('price_type')})) = 'buy')
      ))
      OR (${column('price_period')} = 'month' AND (
        lower(btrim(${column('price_type')})) = 'rent'
        OR (lower(btrim(${column('source_name')})) = 'pararius' AND COALESCE(lower(btrim(${column('price_type')})), '') <> 'sale')
      ))
    ) THEN ${column('asking_price')} ELSE NULL END`;
}

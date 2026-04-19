import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { buildPropertyListingFactsJoin } from './property-queries.js';

export const MAP_MARKET_STATES = [
  'for-sale',
  'for-rent',
  'sold',
  'rented',
  'not-listed',
] as const;

const MAP_MARKET_STATE_SET = new Set<string>(MAP_MARKET_STATES);
const DEFAULT_MARKET_STATE_ORDER = [...MAP_MARKET_STATES];
const SALE_MARKET_STATES = ['for-sale', 'sold', 'not-listed'] as const;
const RENT_MARKET_STATES = ['for-rent', 'rented'] as const;

export type MapMarketState = (typeof MAP_MARKET_STATES)[number];

export interface MapFilters {
  salePriceFrom: number | null;
  salePriceTo: number | null;
  rentPriceFrom: number | null;
  rentPriceTo: number | null;
  marketState: MapMarketState[];
  activity: 'all' | 'social' | 'recent';
}

type MapFilterQueryInput = {
  salePriceFrom?: number;
  salePriceTo?: number;
  rentPriceFrom?: number;
  rentPriceTo?: number;
  marketState?: string | string[];
  activity?: 'all' | 'social' | 'recent';
};

export const mapFiltersQuerySchema = z.object({
  salePriceFrom: z.coerce.number().optional(),
  salePriceTo: z.coerce.number().optional(),
  rentPriceFrom: z.coerce.number().optional(),
  rentPriceTo: z.coerce.number().optional(),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
  activity: z.enum(['all', 'social', 'recent']).optional().default('all'),
});

export const propertyMarketFiltersQuerySchema = mapFiltersQuerySchema.omit({
  activity: true,
});

export type PropertyMarketFilterQuery = {
  filters: MapFilters;
  join: SQL;
  predicate: SQL;
};

export function createDefaultMapFilters(): MapFilters {
  return {
    salePriceFrom: null,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: [...DEFAULT_MARKET_STATE_ORDER],
    activity: 'all',
  };
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value > 0 ? Math.round(value) : null;
}

function stableUniqueMarketState(values: Iterable<MapMarketState>): MapMarketState[] {
  const set = new Set(values);
  return DEFAULT_MARKET_STATE_ORDER.filter((state) => set.has(state));
}

function parseMarketStateInput(input: string | string[] | undefined): MapMarketState[] {
  if (input == null) {
    return [...DEFAULT_MARKET_STATE_ORDER];
  }

  const joined = Array.isArray(input) ? input.join(',') : input;
  const values = joined
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is MapMarketState => MAP_MARKET_STATE_SET.has(value));

  return values.length > 0 ? stableUniqueMarketState(values) : [...DEFAULT_MARKET_STATE_ORDER];
}

export function normalizeMapFilters(filters: Partial<MapFilters>): MapFilters {
  const salePriceFrom = normalizePositiveInteger(filters.salePriceFrom);
  const salePriceTo = normalizePositiveInteger(filters.salePriceTo);
  const rentPriceFrom = normalizePositiveInteger(filters.rentPriceFrom);
  const rentPriceTo = normalizePositiveInteger(filters.rentPriceTo);
  const marketState = stableUniqueMarketState(filters.marketState ?? DEFAULT_MARKET_STATE_ORDER);

  return {
    salePriceFrom:
      salePriceFrom != null && salePriceTo != null && salePriceFrom > salePriceTo
        ? salePriceTo
        : salePriceFrom,
    salePriceTo:
      salePriceFrom != null && salePriceTo != null && salePriceFrom > salePriceTo
        ? salePriceFrom
        : salePriceTo,
    rentPriceFrom:
      rentPriceFrom != null && rentPriceTo != null && rentPriceFrom > rentPriceTo
        ? rentPriceTo
        : rentPriceFrom,
    rentPriceTo:
      rentPriceFrom != null && rentPriceTo != null && rentPriceFrom > rentPriceTo
        ? rentPriceFrom
        : rentPriceTo,
    marketState: marketState.length > 0 ? marketState : [...DEFAULT_MARKET_STATE_ORDER],
    activity:
      filters.activity === 'social' || filters.activity === 'recent'
        ? filters.activity
        : 'all',
  };
}

export function parseMapFiltersQuery(query: unknown): MapFilters {
  const parsed = mapFiltersQuerySchema.parse(query) as MapFilterQueryInput;

  return normalizeMapFilters({
    salePriceFrom: parsed.salePriceFrom ?? null,
    salePriceTo: parsed.salePriceTo ?? null,
    rentPriceFrom: parsed.rentPriceFrom ?? null,
    rentPriceTo: parsed.rentPriceTo ?? null,
    marketState: parseMarketStateInput(parsed.marketState),
    activity: parsed.activity ?? 'all',
  });
}

export function parsePropertyMarketFiltersQuery(query: unknown): MapFilters {
  const parsed = propertyMarketFiltersQuerySchema.parse(query) as Omit<
    MapFilterQueryInput,
    'activity'
  >;

  return normalizeMapFilters({
    salePriceFrom: parsed.salePriceFrom ?? null,
    salePriceTo: parsed.salePriceTo ?? null,
    rentPriceFrom: parsed.rentPriceFrom ?? null,
    rentPriceTo: parsed.rentPriceTo ?? null,
    marketState: parseMarketStateInput(parsed.marketState),
    activity: 'all',
  });
}

export function areMapFiltersDefault(filters: MapFilters): boolean {
  return (
    filters.salePriceFrom == null &&
    filters.salePriceTo == null &&
    filters.rentPriceFrom == null &&
    filters.rentPriceTo == null &&
    filters.activity === 'all' &&
    filters.marketState.length === DEFAULT_MARKET_STATE_ORDER.length &&
    filters.marketState.every((value, index) => value === DEFAULT_MARKET_STATE_ORDER[index])
  );
}

function applyMapFiltersToSearchParams(params: URLSearchParams, filters: MapFilters): URLSearchParams {
  const normalized = normalizeMapFilters(filters);
  const next = new URLSearchParams(params.toString());

  next.delete('salePriceFrom');
  next.delete('salePriceTo');
  next.delete('rentPriceFrom');
  next.delete('rentPriceTo');
  next.delete('marketState');
  next.delete('activity');

  if (normalized.salePriceFrom != null) {
    next.set('salePriceFrom', String(normalized.salePriceFrom));
  }
  if (normalized.salePriceTo != null) {
    next.set('salePriceTo', String(normalized.salePriceTo));
  }
  if (normalized.rentPriceFrom != null) {
    next.set('rentPriceFrom', String(normalized.rentPriceFrom));
  }
  if (normalized.rentPriceTo != null) {
    next.set('rentPriceTo', String(normalized.rentPriceTo));
  }
  if (normalized.marketState.length !== DEFAULT_MARKET_STATE_ORDER.length) {
    next.set('marketState', normalized.marketState.join(','));
  }
  if (normalized.activity !== 'all') {
    next.set('activity', normalized.activity);
  }

  return next;
}

export function serializeMapFilterQuery(filters: MapFilters): string {
  return applyMapFiltersToSearchParams(new URLSearchParams(), filters).toString();
}

export function getMapFilterSignature(filters: MapFilters): string {
  const serialized = serializeMapFilterQuery(filters);
  return serialized.length > 0 ? serialized : 'default';
}

export function buildPropertyTileTemplateUrl(baseUrl: string, filters: MapFilters): string {
  const query = serializeMapFilterQuery(filters);
  return `${baseUrl}/tiles/properties/{z}/{x}/{y}.pbf${query ? `?${query}` : ''}`;
}

function buildStateList(states: readonly MapMarketState[]): SQL {
  return sql`(${sql.join(states.map((state) => sql`${state}`), sql`, `)})`;
}

function buildScopedPricePredicate(
  marketStateColumn: SQL,
  effectivePriceColumn: SQL,
  impactedStates: readonly MapMarketState[],
  unaffectedStates: readonly MapMarketState[],
  operator: '>=' | '<=',
  value: number,
): SQL {
  return sql`(
    ${marketStateColumn} IN ${buildStateList(unaffectedStates)}
    OR (
      ${marketStateColumn} IN ${buildStateList(impactedStates)}
      AND ${effectivePriceColumn} ${sql.raw(operator)} ${value}
    )
  )`;
}

export function buildPropertyMarketFilterQuery(
  filters: MapFilters,
  propertyAlias = 'p',
): PropertyMarketFilterQuery {
  const normalized = normalizeMapFilters(filters);

  if (areMapFiltersDefault(normalized)) {
    return {
      filters: normalized,
      join: sql``,
      predicate: sql`TRUE`,
    };
  }

  const join = buildPropertyListingFactsJoin(propertyAlias, 'lf', { includeEffectivePrices: true });

  const predicates: SQL[] = [];
  const marketStateColumn = sql.raw('lf.market_state');
  const saleEffectivePriceColumn = sql.raw('lf.sale_effective_price');
  const rentEffectivePriceColumn = sql.raw('lf.rent_effective_price');

  if (normalized.marketState.length !== DEFAULT_MARKET_STATE_ORDER.length) {
    predicates.push(sql`${marketStateColumn} IN ${buildStateList(normalized.marketState)}`);
  }

  if (normalized.salePriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '>=',
        normalized.salePriceFrom,
      ),
    );
  }

  if (normalized.salePriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '<=',
        normalized.salePriceTo,
      ),
    );
  }

  if (normalized.rentPriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '>=',
        normalized.rentPriceFrom,
      ),
    );
  }

  if (normalized.rentPriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '<=',
        normalized.rentPriceTo,
      ),
    );
  }

  return {
    filters: normalized,
    join,
    predicate: predicates.length > 0 ? sql`${sql.join(predicates, sql` AND `)}` : sql`TRUE`,
  };
}

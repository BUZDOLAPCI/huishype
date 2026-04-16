import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

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
}

type MapFilterQueryInput = {
  salePriceFrom?: number;
  salePriceTo?: number;
  rentPriceFrom?: number;
  rentPriceTo?: number;
  marketState?: string | string[];
};

export const mapFiltersQuerySchema = z.object({
  salePriceFrom: z.coerce.number().optional(),
  salePriceTo: z.coerce.number().optional(),
  rentPriceFrom: z.coerce.number().optional(),
  rentPriceTo: z.coerce.number().optional(),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
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
  });
}

export function areMapFiltersDefault(filters: MapFilters): boolean {
  return (
    filters.salePriceFrom == null &&
    filters.salePriceTo == null &&
    filters.rentPriceFrom == null &&
    filters.rentPriceTo == null &&
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

  const propertyIdColumn = sql.raw(`${propertyAlias}.id`);
  const officialValuationColumn = sql.raw(`${propertyAlias}.official_valuation`);
  const needsSaleFacts = normalized.salePriceFrom != null || normalized.salePriceTo != null;
  const needsRentFacts = normalized.rentPriceFrom != null || normalized.rentPriceTo != null;

  const soldHistoryJoin = needsSaleFacts
    ? sql`
        LEFT JOIN LATERAL (
          SELECT ph.price AS last_sold_price
          FROM price_history ph
          WHERE ph.property_id = ${propertyIdColumn}
            AND ph.event_type = 'sold'
          ORDER BY ph.price_date DESC, ph.created_at DESC, ph.id DESC
          LIMIT 1
        ) sold_history ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS last_sold_price) sold_history ON TRUE`;

  const rentedHistoryJoin = needsRentFacts
    ? sql`
        LEFT JOIN LATERAL (
          SELECT ph.price AS last_rented_price
          FROM price_history ph
          WHERE ph.property_id = ${propertyIdColumn}
            AND ph.event_type = 'rented'
          ORDER BY ph.price_date DESC, ph.created_at DESC, ph.id DESC
          LIMIT 1
        ) rented_history ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS last_rented_price) rented_history ON TRUE`;

  const guessFactsJoin = needsSaleFacts
    ? sql`
        LEFT JOIN LATERAL (
          SELECT
            guess_base.guess_count,
            CASE
              WHEN guess_base.guess_count = 0 OR guess_base.weighted_mean IS NULL THEN NULL
              WHEN guess_base.guess_count <= 2 THEN ROUND(
                CASE
                  WHEN ${officialValuationColumn} IS NOT NULL
                    THEN ${officialValuationColumn}::numeric * 0.7 + guess_base.weighted_mean * 0.3
                  ELSE guess_base.weighted_mean
                END
              )::bigint
              WHEN guess_base.guess_count <= 9 THEN ROUND(
                CASE
                  WHEN ${officialValuationColumn} IS NOT NULL
                    THEN ${officialValuationColumn}::numeric * 0.3 + guess_base.weighted_mean * 0.7
                  ELSE guess_base.weighted_mean
                END
              )::bigint
              ELSE ROUND(guess_base.weighted_mean)::bigint
            END AS canonical_fmv
          FROM (
            SELECT
              COUNT(*)::int AS guess_count,
              SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0) AS weighted_mean
            FROM price_guesses pg
            INNER JOIN users u ON u.id = pg.user_id
            WHERE pg.property_id = ${propertyIdColumn}
              AND pg.is_meme_guess = FALSE
          ) guess_base
        ) guess_facts ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT 0::int AS guess_count, NULL::bigint AS canonical_fmv) guess_facts ON TRUE`;

  const join = sql`
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN active_listing.active_price_type = 'rent' THEN 'for-rent'
          WHEN active_listing.active_asking_price IS NOT NULL THEN 'for-sale'
          WHEN terminal_listing.latest_terminal_listing_status = 'sold' THEN 'sold'
          WHEN terminal_listing.latest_terminal_listing_status = 'rented' THEN 'rented'
          ELSE 'not-listed'
        END AS market_state,
        COALESCE(
          CASE
            WHEN active_listing.active_price_type = 'sale' THEN active_listing.active_asking_price
            ELSE NULL
          END,
          sold_history.last_sold_price,
          guess_facts.canonical_fmv,
          ${officialValuationColumn}
        ) AS sale_effective_price,
        COALESCE(
          CASE
            WHEN active_listing.active_price_type = 'rent' THEN active_listing.active_asking_price
            ELSE NULL
          END,
          rented_history.last_rented_price
        ) AS rent_effective_price
      FROM (SELECT 1) AS _seed
      LEFT JOIN LATERAL (
        SELECT
          l.asking_price AS active_asking_price,
          COALESCE(NULLIF(l.price_type, ''), 'sale') AS active_price_type
        FROM listings l
        WHERE l.property_id = ${propertyIdColumn}
          AND l.status = 'active'
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ) active_listing ON TRUE
      LEFT JOIN LATERAL (
        SELECT l.status AS latest_terminal_listing_status
        FROM listings l
        WHERE l.property_id = ${propertyIdColumn}
          AND l.status IN ('sold', 'rented', 'withdrawn')
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ) terminal_listing ON TRUE
      ${soldHistoryJoin}
      ${rentedHistoryJoin}
      ${guessFactsJoin}
    ) mf ON TRUE
  `;

  const predicates: SQL[] = [];
  const marketStateColumn = sql.raw('mf.market_state');
  const saleEffectivePriceColumn = sql.raw('mf.sale_effective_price');
  const rentEffectivePriceColumn = sql.raw('mf.rent_effective_price');

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

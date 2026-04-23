import {
  getCountryDefaultGuessStart,
  getPriceGuessPostalScope,
  isValidCountryCode,
  type CountryCode,
} from '@huishype/shared/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const PRICE_GUESS_MIN = 50_000;
const PRICE_GUESS_MAX = 2_000_000;
const OFFICIAL_RATIO_MIN = 0.5;
const OFFICIAL_RATIO_MAX = 2;
const ADJUSTED_RATIO_MIN = 0.8;
const ADJUSTED_RATIO_MAX = 1.35;
const OFFICIAL_FINAL_GUARD_MIN = 0.65;
const OFFICIAL_FINAL_GUARD_MAX = 1.65;

export type PriceGuessStartSource =
  | 'official_valuation_adjusted'
  | 'local_comparable_price_per_m2'
  | 'official_valuation'
  | 'country_default';

export type PriceGuessStartConfidence = 'weak' | 'usable';
export type PriceGuessScopeType = 'postal_prefix' | 'city' | 'region' | 'country';
export type NormalizedListingPriceType = 'sale' | 'rent';

export interface PriceGuessStart {
  price: number;
  source: PriceGuessStartSource;
  confidence: PriceGuessStartConfidence;
  sampleSize: number;
}

export interface PriceGuessPropertyFacts {
  id: string;
  countryCode: string;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  officialValuation: number | null;
  floorAreaM2: number | null;
}

export interface PriceGuessMarketSummary {
  countryCode: string;
  scopeType: PriceGuessScopeType;
  scopeKey: string;
  medianAskingToOfficialRatio: number | null;
  ratioSampleSize: number;
  medianAskingPerM2: number | null;
  perM2SampleSize: number;
  refreshedAt: Date;
}

export interface PriceGuessStartResult {
  activeListingAskingPrice: number | null;
  priceGuessStart?: PriceGuessStart;
}

interface SummaryScope {
  scopeType: PriceGuessScopeType;
  scopeKey: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToFriendlyPrice(value: number): number {
  return Math.round(value / 5_000) * 5_000;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeScopeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function asCountryCode(countryCode: string): CountryCode {
  const upper = countryCode.toUpperCase();
  return isValidCountryCode(upper) ? upper : 'NL';
}

export function getMinimumPriceGuessSummarySampleSize(scopeType: PriceGuessScopeType): number {
  switch (scopeType) {
    case 'postal_prefix':
      return 8;
    case 'city':
      return 20;
    case 'region':
      return 40;
    case 'country':
      return 100;
  }
}

export function normalizeListingPriceTypeForGuessStart(
  sourceName: string | null | undefined,
  priceType: string | null | undefined,
): NormalizedListingPriceType | null {
  const source = sourceName?.trim().toLowerCase() ?? '';
  const type = priceType?.trim().toLowerCase() ?? '';

  if (!type) {
    return null;
  }

  if (source === 'funda' && type === 'buy') {
    return 'sale';
  }

  if (type === 'sale' || type === 'rent') {
    return type;
  }

  return null;
}

export function isSaleMarketSummaryListingFact(input: {
  sourceName: string | null | undefined;
  status: string | null | undefined;
  priceType: string | null | undefined;
  askingPrice: number | null | undefined;
}): boolean {
  const askingPrice = positiveNumber(input.askingPrice);
  return (
    input.sourceName?.trim().toLowerCase() === 'funda' &&
    input.status === 'active' &&
    normalizeListingPriceTypeForGuessStart(input.sourceName, input.priceType) === 'sale' &&
    askingPrice != null &&
    askingPrice >= PRICE_GUESS_MIN &&
    askingPrice <= PRICE_GUESS_MAX
  );
}

export function buildPriceGuessSummaryScopes(property: PriceGuessPropertyFacts): SummaryScope[] {
  const countryCode = asCountryCode(property.countryCode);
  const scopes: SummaryScope[] = [];
  const postalScope = getPriceGuessPostalScope(countryCode, property.postalCode);
  const cityScope = normalizeScopeKey(property.city);
  const regionScope = normalizeScopeKey(property.region);

  if (postalScope) {
    scopes.push({ scopeType: 'postal_prefix', scopeKey: postalScope });
  }

  if (cityScope) {
    scopes.push({ scopeType: 'city', scopeKey: cityScope });
  }

  if (regionScope) {
    scopes.push({ scopeType: 'region', scopeKey: regionScope });
  }

  scopes.push({ scopeType: 'country', scopeKey: countryCode });
  return scopes;
}

export function choosePriceGuessStart(input: {
  property: PriceGuessPropertyFacts;
  activeListingAskingPrice: number | null;
  summary: PriceGuessMarketSummary | null;
}): PriceGuessStart | undefined {
  if (positiveNumber(input.activeListingAskingPrice) != null) {
    return undefined;
  }

  const countryCode = asCountryCode(input.property.countryCode);
  const officialValuation = positiveNumber(input.property.officialValuation);
  const floorAreaM2 = positiveNumber(input.property.floorAreaM2);
  const summary = input.summary;

  if (officialValuation != null && summary) {
    const minSampleSize = getMinimumPriceGuessSummarySampleSize(summary.scopeType);
    const rawRatio = positiveNumber(summary.medianAskingToOfficialRatio);

    if (
      rawRatio != null &&
      rawRatio >= OFFICIAL_RATIO_MIN &&
      rawRatio <= OFFICIAL_RATIO_MAX &&
      summary.ratioSampleSize >= minSampleSize
    ) {
      const weight = summary.ratioSampleSize / (summary.ratioSampleSize + 20);
      const adjustedRatio = clamp(
        1 + (rawRatio - 1) * weight,
        ADJUSTED_RATIO_MIN,
        ADJUSTED_RATIO_MAX,
      );
      const guarded = clamp(
        officialValuation * adjustedRatio,
        officialValuation * OFFICIAL_FINAL_GUARD_MIN,
        officialValuation * OFFICIAL_FINAL_GUARD_MAX,
      );

      return {
        price: roundToFriendlyPrice(clamp(guarded, PRICE_GUESS_MIN, PRICE_GUESS_MAX)),
        source: 'official_valuation_adjusted',
        confidence: 'usable',
        sampleSize: summary.ratioSampleSize,
      };
    }
  }

  if (officialValuation == null && floorAreaM2 != null && summary) {
    const minSampleSize = getMinimumPriceGuessSummarySampleSize(summary.scopeType);
    const medianAskingPerM2 = positiveNumber(summary.medianAskingPerM2);

    if (medianAskingPerM2 != null && summary.perM2SampleSize >= minSampleSize) {
      return {
        price: roundToFriendlyPrice(
          clamp(medianAskingPerM2 * floorAreaM2, PRICE_GUESS_MIN, PRICE_GUESS_MAX),
        ),
        source: 'local_comparable_price_per_m2',
        confidence: 'usable',
        sampleSize: summary.perM2SampleSize,
      };
    }
  }

  if (officialValuation != null) {
    return {
      price: roundToFriendlyPrice(clamp(officialValuation, PRICE_GUESS_MIN, PRICE_GUESS_MAX)),
      source: 'official_valuation',
      confidence: 'weak',
      sampleSize: 0,
    };
  }

  return {
    price: getCountryDefaultGuessStart(countryCode),
    source: 'country_default',
    confidence: 'weak',
    sampleSize: 0,
  };
}

function canUseSummaryForProperty(
  property: PriceGuessPropertyFacts,
  summary: PriceGuessMarketSummary,
): boolean {
  const officialValuation = positiveNumber(property.officialValuation);
  const floorAreaM2 = positiveNumber(property.floorAreaM2);
  const minSampleSize = getMinimumPriceGuessSummarySampleSize(summary.scopeType);

  if (officialValuation != null) {
    const rawRatio = positiveNumber(summary.medianAskingToOfficialRatio);
    return (
      rawRatio != null &&
      rawRatio >= OFFICIAL_RATIO_MIN &&
      rawRatio <= OFFICIAL_RATIO_MAX &&
      summary.ratioSampleSize >= minSampleSize
    );
  }

  if (floorAreaM2 != null) {
    return (
      positiveNumber(summary.medianAskingPerM2) != null &&
      summary.perM2SampleSize >= minSampleSize
    );
  }

  return false;
}

export async function fetchActiveSaleListingAskingPrice(propertyId: string): Promise<number | null> {
  const rows = await db.execute<{ asking_price: number | string | null }>(sql`
    SELECT asking_price
    FROM v_canonical_listing_facts
    WHERE property_id = ${propertyId}
      AND is_active_sale = true
      AND asking_price IS NOT NULL
    ORDER BY listed_at DESC NULLS LAST, listing_id DESC
    LIMIT 1
  `);

  const row = Array.from(rows)[0];
  return row?.asking_price != null ? Number(row.asking_price) : null;
}

export async function fetchPriceGuessMarketSummary(
  property: PriceGuessPropertyFacts,
): Promise<PriceGuessMarketSummary | null> {
  const countryCode = asCountryCode(property.countryCode);

  for (const scope of buildPriceGuessSummaryScopes(property)) {
    const rows = await db.execute<{
      country_code: string;
      scope_type: PriceGuessScopeType;
      scope_key: string;
      median_asking_to_official_ratio: number | string | null;
      ratio_sample_size: number | string;
      median_asking_per_m2: number | string | null;
      per_m2_sample_size: number | string;
      refreshed_at: Date;
    }>(sql`
      SELECT
        country_code,
        scope_type,
        scope_key,
        median_asking_to_official_ratio,
        ratio_sample_size,
        median_asking_per_m2,
        per_m2_sample_size,
        refreshed_at
      FROM mv_price_guess_start_market_summaries
      WHERE country_code = ${countryCode}
        AND scope_type = ${scope.scopeType}
        AND scope_key = ${scope.scopeKey}
      LIMIT 1
    `);

    const row = Array.from(rows)[0];
    if (row) {
      const summary = {
        countryCode: row.country_code,
        scopeType: row.scope_type,
        scopeKey: row.scope_key,
        medianAskingToOfficialRatio:
          row.median_asking_to_official_ratio == null
            ? null
            : Number(row.median_asking_to_official_ratio),
        ratioSampleSize: Number(row.ratio_sample_size),
        medianAskingPerM2:
          row.median_asking_per_m2 == null ? null : Number(row.median_asking_per_m2),
        perM2SampleSize: Number(row.per_m2_sample_size),
        refreshedAt: row.refreshed_at,
      };

      if (canUseSummaryForProperty(property, summary)) {
        return summary;
      }
    }
  }

  return null;
}

export async function getPriceGuessStartForProperty(
  property: PriceGuessPropertyFacts,
): Promise<PriceGuessStartResult> {
  const activeListingAskingPrice = await fetchActiveSaleListingAskingPrice(property.id);

  if (activeListingAskingPrice != null) {
    return { activeListingAskingPrice };
  }

  const summary = await fetchPriceGuessMarketSummary(property);
  return {
    activeListingAskingPrice: null,
    priceGuessStart: choosePriceGuessStart({
      property,
      activeListingAskingPrice: null,
      summary,
    }),
  };
}

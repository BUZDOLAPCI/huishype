import { db } from '../db/index.js';
import { priceGuesses, properties, users } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

// --- Types ---

export type FmvConfidence = 'none' | 'low' | 'medium' | 'high';

export interface FmvDistribution {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
}

export interface FmvResult {
  fmv: number | null;
  confidence: FmvConfidence;
  guessCount: number;
  distribution: FmvDistribution | null;
  officialValuation: number | null;
  askingPrice: number | null;
  divergence: number | null; // % difference between FMV and asking price
}

export interface WeightedGuess {
  guessedPrice: number;
  karma: number;
}

// --- Pure FMV Calculation ---

/**
 * Calculate karma-weighted mean from guesses.
 * Weight = max(1, karma) so every guess counts at least 1.
 */
export function karmaWeightedMean(guesses: WeightedGuess[]): number {
  if (guesses.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const g of guesses) {
    const w = Math.max(1, g.karma);
    weightedSum += g.guessedPrice * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Calculate standard deviation of prices (unweighted, for outlier detection).
 */
export function standardDeviation(prices: number[]): number {
  if (prices.length < 2) return 0;

  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const squaredDiffs = prices.map((p) => (p - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / prices.length;

  return Math.sqrt(variance);
}

/**
 * Remove outliers beyond 2 standard deviations from the karma-weighted mean.
 * Returns the filtered list.
 */
export function trimOutliers(guesses: WeightedGuess[]): WeightedGuess[] {
  if (guesses.length < 3) return guesses; // Need at least 3 for meaningful trimming

  const mean = karmaWeightedMean(guesses);
  const prices = guesses.map((g) => g.guessedPrice);
  const sd = standardDeviation(prices);

  if (sd === 0) return guesses; // All same price

  return guesses.filter((g) => Math.abs(g.guessedPrice - mean) <= 2 * sd);
}

/**
 * Calculate percentile distribution from a list of prices.
 */
export function calculateDistribution(prices: number[]): FmvDistribution | null {
  if (prices.length === 0) return null;

  const sorted = [...prices].sort((a, b) => a - b);

  function percentile(arr: number[], p: number): number {
    const index = (p / 100) * (arr.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return arr[lower];
    const frac = index - lower;
    return arr[lower] * (1 - frac) + arr[upper] * frac;
  }

  return {
    p10: Math.round(percentile(sorted, 10)),
    p25: Math.round(percentile(sorted, 25)),
    p50: Math.round(percentile(sorted, 50)),
    p75: Math.round(percentile(sorted, 75)),
    p90: Math.round(percentile(sorted, 90)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Determine confidence level based on number of non-meme guesses.
 */
export function getConfidence(guessCount: number): FmvConfidence {
  if (guessCount === 0) return 'none';
  if (guessCount <= 2) return 'low';
  if (guessCount <= 9) return 'medium';
  return 'high';
}

/**
 * Blend WOZ value and crowd estimate based on confidence level.
 *
 * - none (0 guesses): FMV = WOZ only
 * - low (1-2): 70% WOZ + 30% crowd
 * - medium (3-9): 30% WOZ + 70% crowd
 * - high (10+): 100% crowd
 */
export function blendFmv(
  crowdEstimate: number,
  officialValuation: number | null,
  confidence: FmvConfidence
): number {
  if (confidence === 'none') {
    return officialValuation ?? 0;
  }

  if (!officialValuation || officialValuation <= 0) {
    // No WOZ available: use crowd estimate at any confidence
    return crowdEstimate;
  }

  switch (confidence) {
    case 'low':
      return Math.round(officialValuation * 0.7 + crowdEstimate * 0.3);
    case 'medium':
      return Math.round(officialValuation * 0.3 + crowdEstimate * 0.7);
    case 'high':
      return Math.round(crowdEstimate);
    default:
      return Math.round(crowdEstimate);
  }
}

/**
 * Calculate divergence percentage between FMV and asking price.
 * Positive = FMV > asking (underpriced), Negative = FMV < asking (overpriced).
 */
export function calculateDivergence(
  fmv: number | null,
  askingPrice: number | null
): number | null {
  if (!fmv || !askingPrice || askingPrice <= 0) return null;
  return Math.round(((fmv - askingPrice) / askingPrice) * 10000) / 100; // 2 decimal places
}

/**
 * Core FMV calculation from weighted guesses.
 * This is the main pure function that computes everything.
 */
export function calculateFmv(
  guesses: WeightedGuess[],
  officialValuation: number | null,
  askingPrice: number | null
): FmvResult {
  const confidence = getConfidence(guesses.length);

  // No guesses: return WOZ-only result
  if (guesses.length === 0) {
    return {
      fmv: officialValuation ?? null,
      confidence,
      guessCount: 0,
      distribution: null,
      officialValuation,
      askingPrice,
      divergence: calculateDivergence(officialValuation, askingPrice),
    };
  }

  // Trim outliers (only meaningful with 3+ guesses)
  const trimmed = trimOutliers(guesses);

  // If all guesses were outliers, fall back to full set
  const effectiveGuesses = trimmed.length > 0 ? trimmed : guesses;

  // Karma-weighted mean of (possibly trimmed) guesses
  const crowdEstimate = Math.round(karmaWeightedMean(effectiveGuesses));

  // Blend with WOZ based on confidence
  const fmv = blendFmv(crowdEstimate, officialValuation, confidence);

  // Distribution from all non-meme guess prices (before trimming, for full picture)
  const allPrices = guesses.map((g) => g.guessedPrice);
  const distribution = calculateDistribution(allPrices);

  return {
    fmv: fmv || null,
    confidence,
    guessCount: guesses.length,
    distribution,
    officialValuation,
    askingPrice,
    divergence: calculateDivergence(fmv, askingPrice),
  };
}

// --- Database-Dependent Functions ---

/**
 * Fetch non-meme price guesses with user karma for a property.
 * This is the only query needed when officialValuation and askingPrice
 * are already available from a parent query.
 */
export async function fetchGuessesWithKarma(propertyId: string): Promise<WeightedGuess[]> {
  const guessRows = await db
    .select({
      guessedPrice: priceGuesses.guessedPrice,
      karma: users.karma,
    })
    .from(priceGuesses)
    .innerJoin(users, eq(priceGuesses.userId, users.id))
    .where(
      and(
        eq(priceGuesses.propertyId, propertyId),
        eq(priceGuesses.isMemeGuess, false)
      )
    );

  return guessRows.map((r) => ({
    guessedPrice: Number(r.guessedPrice),
    karma: r.karma,
  }));
}

/**
 * Fetch FMV data for a property from the database.
 * Issues 3 DB queries (officialValuation, askingPrice, guesses+karma).
 * Prefer fetchGuessesWithKarma() + calculateFmv() when the caller
 * already has officialValuation and askingPrice loaded.
 */
export async function calculateFmvForProperty(propertyId: string): Promise<FmvResult> {
  // Fetch property official valuation
  const propertyRows = await db
    .select({ officialValuation: properties.officialValuation })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  const officialValuation = propertyRows[0]?.officialValuation ?? null;

  const listingRows = await db.execute<{ asking_price: number | string | null }>(sql`
    SELECT asking_price
    FROM v_canonical_listing_facts
    WHERE property_id = ${propertyId}
      AND status = 'active'
      AND asking_price IS NOT NULL
    ORDER BY sort_at DESC, listing_created_at DESC, listing_id DESC
    LIMIT 1
  `);

  const listingRow = Array.from(listingRows)[0];
  const askingPrice = listingRow?.asking_price != null ? Number(listingRow.asking_price) : null;

  const guesses = await fetchGuessesWithKarma(propertyId);

  return calculateFmv(guesses, officialValuation, askingPrice);
}

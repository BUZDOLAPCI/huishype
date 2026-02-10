import { db } from '../db/index.js';
import { priceGuesses, priceHistory, properties, users } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

// --- Karma Rank Titles ---

const KARMA_RANKS = [
  { minKarma: 500, title: 'Legende', level: 6 },
  { minKarma: 200, title: 'Meester', level: 5 },
  { minKarma: 100, title: 'Specialist', level: 4 },
  { minKarma: 50, title: 'Kenner', level: 3 },
  { minKarma: 10, title: 'Bewoner', level: 2 },
  { minKarma: 0, title: 'Nieuwkomer', level: 1 },
] as const;

export function getKarmaRank(karma: number): { title: string; level: number } {
  const publicKarma = Math.max(0, karma);
  for (const rank of KARMA_RANKS) {
    if (publicKarma >= rank.minKarma) {
      return { title: rank.title, level: rank.level };
    }
  }
  return { title: 'Nieuwkomer', level: 1 };
}

// --- Guess Accuracy Scoring ---

// Reward tiers based on deviation from actual sale price
const ACCURACY_TIERS = [
  { maxDeviation: 0.05, reward: 10 }, // Within 5%: high reward
  { maxDeviation: 0.10, reward: 5 },  // Within 10%: medium reward
  { maxDeviation: 0.20, reward: 2 },  // Within 20%: small reward
] as const;

const PENALTY_DEVIATION = 0.50;
const PENALTY_AMOUNT = -3;
const NEW_ACCOUNT_THRESHOLD = 5;
const NEW_ACCOUNT_WEIGHT = 0.5;
const CONSISTENCY_STREAK_LENGTH = 5;
const CONSISTENCY_BONUS = 2;

export function scoreGuessAccuracy(
  guessedPrice: number,
  actualPrice: number
): { reward: number; deviation: number } {
  if (actualPrice <= 0) return { reward: 0, deviation: 1 };

  const deviation = Math.abs(guessedPrice - actualPrice) / actualPrice;

  for (const tier of ACCURACY_TIERS) {
    if (deviation <= tier.maxDeviation) {
      return { reward: tier.reward, deviation };
    }
  }

  // Between 20% and 50%: no reward, no penalty
  if (deviation <= PENALTY_DEVIATION) {
    return { reward: 0, deviation };
  }

  // Beyond 50%: penalty
  return { reward: PENALTY_AMOUNT, deviation };
}

// --- Meme Guess Detection ---

export function checkMemeGuess(guessedPrice: number, wozValue: number | null): boolean {
  if (!wozValue || wozValue <= 0) return false;

  const ratio = guessedPrice / wozValue;
  return ratio < 0.2 || ratio > 5.0;
}

// --- Karma Calculation (Pure) ---

export interface ResolvedGuess {
  guessedPrice: number;
  actualPrice: number;
  guessIndex: number; // 0-based chronological order of user's guesses
}

export function calculateKarma(
  resolvedGuesses: ResolvedGuess[]
): { karma: number; internalKarma: number } {
  let internalKarma = 0;
  let consecutiveAccurate = 0;

  for (const guess of resolvedGuesses) {
    const { reward, deviation } = scoreGuessAccuracy(guess.guessedPrice, guess.actualPrice);

    // First N guesses get reduced impact (anti-Sybil)
    const weight = guess.guessIndex < NEW_ACCOUNT_THRESHOLD ? NEW_ACCOUNT_WEIGHT : 1.0;
    internalKarma += reward * weight;

    // Track consistency streak
    if (deviation <= 0.20) {
      consecutiveAccurate++;
      if (consecutiveAccurate > 0 && consecutiveAccurate % CONSISTENCY_STREAK_LENGTH === 0) {
        internalKarma += CONSISTENCY_BONUS;
      }
    } else {
      consecutiveAccurate = 0;
    }
  }

  return {
    karma: Math.max(0, Math.round(internalKarma)),
    internalKarma: Math.round(internalKarma),
  };
}

// --- Database-Dependent Functions ---

/**
 * Recalculate karma for a user based on all their resolved guesses.
 * A guess is "resolved" when the property has a 'sold' price_history entry.
 */
export async function calculateKarmaForUser(
  userId: string
): Promise<{ karma: number; internalKarma: number }> {
  // Fetch all user guesses that have a corresponding 'sold' price_history event
  const resolvedRows = await db
    .select({
      guessedPrice: priceGuesses.guessedPrice,
      actualPrice: priceHistory.price,
      createdAt: priceGuesses.createdAt,
    })
    .from(priceGuesses)
    .innerJoin(
      priceHistory,
      and(
        eq(priceGuesses.propertyId, priceHistory.propertyId),
        eq(priceHistory.eventType, 'sold')
      )
    )
    .where(
      and(
        eq(priceGuesses.userId, userId),
        eq(priceGuesses.isMemeGuess, false)
      )
    )
    .orderBy(priceGuesses.createdAt);

  const resolvedGuesses: ResolvedGuess[] = resolvedRows.map((row, index) => ({
    guessedPrice: Number(row.guessedPrice),
    actualPrice: Number(row.actualPrice),
    guessIndex: index,
  }));

  return calculateKarma(resolvedGuesses);
}

/**
 * Recalculate and update karma for a user in the database.
 */
export async function updateKarmaForUser(userId: string): Promise<void> {
  const { karma, internalKarma } = await calculateKarmaForUser(userId);

  await db
    .update(users)
    .set({
      karma,
      internalKarma,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

// Export constants for testing
export const KARMA_CONSTANTS = {
  ACCURACY_TIERS,
  PENALTY_DEVIATION,
  PENALTY_AMOUNT,
  NEW_ACCOUNT_THRESHOLD,
  NEW_ACCOUNT_WEIGHT,
  CONSISTENCY_STREAK_LENGTH,
  CONSISTENCY_BONUS,
  KARMA_RANKS,
} as const;

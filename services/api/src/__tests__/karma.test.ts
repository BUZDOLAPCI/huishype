import { describe, it, expect } from '@jest/globals';
import {
  getKarmaRank,
  scoreGuessAccuracy,
  checkMemeGuess,
  calculateKarma,
  KARMA_CONSTANTS,
  type ResolvedGuess,
} from '../services/karma.js';

describe('Karma Service', () => {
  describe('getKarmaRank', () => {
    it('returns Nieuwkomer for 0 karma', () => {
      expect(getKarmaRank(0)).toEqual({ title: 'Nieuwkomer', level: 1 });
    });

    it('returns Nieuwkomer for karma 1-9', () => {
      expect(getKarmaRank(1)).toEqual({ title: 'Nieuwkomer', level: 1 });
      expect(getKarmaRank(9)).toEqual({ title: 'Nieuwkomer', level: 1 });
    });

    it('returns Bewoner for karma 10-49', () => {
      expect(getKarmaRank(10)).toEqual({ title: 'Bewoner', level: 2 });
      expect(getKarmaRank(49)).toEqual({ title: 'Bewoner', level: 2 });
    });

    it('returns Kenner for karma 50-99', () => {
      expect(getKarmaRank(50)).toEqual({ title: 'Kenner', level: 3 });
      expect(getKarmaRank(99)).toEqual({ title: 'Kenner', level: 3 });
    });

    it('returns Specialist for karma 100-199', () => {
      expect(getKarmaRank(100)).toEqual({ title: 'Specialist', level: 4 });
      expect(getKarmaRank(199)).toEqual({ title: 'Specialist', level: 4 });
    });

    it('returns Meester for karma 200-499', () => {
      expect(getKarmaRank(200)).toEqual({ title: 'Meester', level: 5 });
      expect(getKarmaRank(499)).toEqual({ title: 'Meester', level: 5 });
    });

    it('returns Legende for karma 500+', () => {
      expect(getKarmaRank(500)).toEqual({ title: 'Legende', level: 6 });
      expect(getKarmaRank(10000)).toEqual({ title: 'Legende', level: 6 });
    });

    it('treats negative karma as 0 (Nieuwkomer)', () => {
      expect(getKarmaRank(-50)).toEqual({ title: 'Nieuwkomer', level: 1 });
      expect(getKarmaRank(-1000)).toEqual({ title: 'Nieuwkomer', level: 1 });
    });
  });

  describe('scoreGuessAccuracy', () => {
    const actualPrice = 400000;

    it('gives high reward (10) for guess within 5%', () => {
      // Exactly right
      expect(scoreGuessAccuracy(400000, actualPrice)).toEqual({ reward: 10, deviation: 0 });
      // 4% off
      expect(scoreGuessAccuracy(416000, actualPrice).reward).toBe(10);
      expect(scoreGuessAccuracy(384000, actualPrice).reward).toBe(10);
      // Exactly 5% off
      expect(scoreGuessAccuracy(420000, actualPrice).reward).toBe(10);
    });

    it('gives medium reward (5) for guess within 10%', () => {
      // 6% off
      expect(scoreGuessAccuracy(424000, actualPrice).reward).toBe(5);
      // 10% off
      expect(scoreGuessAccuracy(440000, actualPrice).reward).toBe(5);
      expect(scoreGuessAccuracy(360000, actualPrice).reward).toBe(5);
    });

    it('gives small reward (2) for guess within 20%', () => {
      // 15% off
      expect(scoreGuessAccuracy(460000, actualPrice).reward).toBe(2);
      // 20% off
      expect(scoreGuessAccuracy(480000, actualPrice).reward).toBe(2);
      expect(scoreGuessAccuracy(320000, actualPrice).reward).toBe(2);
    });

    it('gives no reward for guess within 50%', () => {
      // 25% off
      expect(scoreGuessAccuracy(500000, actualPrice).reward).toBe(0);
      // 45% off
      expect(scoreGuessAccuracy(580000, actualPrice).reward).toBe(0);
      // 50% off
      expect(scoreGuessAccuracy(600000, actualPrice).reward).toBe(0);
    });

    it('gives penalty (-3) for guess beyond 50%', () => {
      // 51% off
      const result = scoreGuessAccuracy(604000, actualPrice);
      expect(result.reward).toBe(-3);
      // Way off
      expect(scoreGuessAccuracy(1000000, actualPrice).reward).toBe(-3);
      expect(scoreGuessAccuracy(100000, actualPrice).reward).toBe(-3);
    });

    it('returns 0 reward for invalid actual price', () => {
      expect(scoreGuessAccuracy(400000, 0)).toEqual({ reward: 0, deviation: 1 });
      expect(scoreGuessAccuracy(400000, -100)).toEqual({ reward: 0, deviation: 1 });
    });

    it('calculates correct deviation', () => {
      const result = scoreGuessAccuracy(440000, 400000);
      expect(result.deviation).toBeCloseTo(0.1);
    });
  });

  describe('checkMemeGuess', () => {
    it('returns false when no WOZ value', () => {
      expect(checkMemeGuess(300000, null)).toBe(false);
      expect(checkMemeGuess(300000, 0)).toBe(false);
    });

    it('returns false for reasonable guesses', () => {
      // WOZ is 400k, guess is 300k (75% of WOZ)
      expect(checkMemeGuess(300000, 400000)).toBe(false);
      // WOZ is 400k, guess is 500k (125% of WOZ)
      expect(checkMemeGuess(500000, 400000)).toBe(false);
      // WOZ is 400k, guess is 1.5M (375% of WOZ)
      expect(checkMemeGuess(1500000, 400000)).toBe(false);
    });

    it('flags extremely low guesses (<20% of WOZ)', () => {
      // WOZ is 400k, guess is 1 euro
      expect(checkMemeGuess(1, 400000)).toBe(true);
      // WOZ is 400k, guess is 60k (15% of WOZ)
      expect(checkMemeGuess(60000, 400000)).toBe(true);
      // WOZ is 400k, guess is 79k (19.75% of WOZ)
      expect(checkMemeGuess(79000, 400000)).toBe(true);
    });

    it('flags extremely high guesses (>500% of WOZ)', () => {
      // WOZ is 400k, guess is 2.5M (625% of WOZ)
      expect(checkMemeGuess(2500000, 400000)).toBe(true);
      // WOZ is 400k, guess is 10M (2500% of WOZ)
      expect(checkMemeGuess(10000000, 400000)).toBe(true);
    });

    it('allows guesses at boundary values', () => {
      // Exactly 20% of WOZ (boundary - inclusive lower)
      expect(checkMemeGuess(80000, 400000)).toBe(false);
      // Exactly 500% of WOZ (boundary - inclusive upper)
      expect(checkMemeGuess(2000000, 400000)).toBe(false);
    });
  });

  describe('calculateKarma', () => {
    it('returns 0 karma for no guesses', () => {
      expect(calculateKarma([])).toEqual({ karma: 0, internalKarma: 0 });
    });

    it('calculates karma for a single accurate guess', () => {
      const guesses: ResolvedGuess[] = [
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 0 },
      ];
      const result = calculateKarma(guesses);
      // Reward = 10, but new account weight = 0.5, so 10 * 0.5 = 5
      expect(result.karma).toBe(5);
      expect(result.internalKarma).toBe(5);
    });

    it('applies new account weight for first 5 guesses', () => {
      const guesses: ResolvedGuess[] = Array.from({ length: 6 }, (_, i) => ({
        guessedPrice: 400000,
        actualPrice: 400000,
        guessIndex: i,
      }));
      const result = calculateKarma(guesses);
      // First 5: 10 * 0.5 = 5 each = 25
      // 6th: 10 * 1.0 = 10
      // Consistency bonus at guess 5 (streak of 5): +2
      // Total: 25 + 10 + 2 = 37
      expect(result.karma).toBe(37);
      expect(result.internalKarma).toBe(37);
    });

    it('gives full weight after first 5 guesses', () => {
      const guesses: ResolvedGuess[] = [
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 5 },
      ];
      const result = calculateKarma(guesses);
      // Full weight: 10 * 1.0 = 10
      expect(result.karma).toBe(10);
    });

    it('handles penalties correctly', () => {
      const guesses: ResolvedGuess[] = [
        // Way off: >50% deviation, penalty = -3 * 0.5 = -1.5 → rounded to -2
        { guessedPrice: 100000, actualPrice: 400000, guessIndex: 0 },
      ];
      const result = calculateKarma(guesses);
      // Penalty: -3 * 0.5 (new account) = -1.5, Math.round(-1.5) = -1
      expect(result.karma).toBe(0); // Public karma clamped to 0
      expect(result.internalKarma).toBe(-1);
    });

    it('clamps public karma to 0 for negative internal karma', () => {
      const guesses: ResolvedGuess[] = Array.from({ length: 10 }, (_, i) => ({
        guessedPrice: 100000, // 75% off
        actualPrice: 400000,
        guessIndex: i,
      }));
      const result = calculateKarma(guesses);
      expect(result.karma).toBe(0);
      expect(result.internalKarma).toBeLessThan(0);
    });

    it('awards consistency bonus every 5 consecutive accurate guesses', () => {
      // 10 perfect guesses, all past new account threshold
      const guesses: ResolvedGuess[] = Array.from({ length: 10 }, (_, i) => ({
        guessedPrice: 400000,
        actualPrice: 400000,
        guessIndex: i + 5, // Past new account threshold
      }));
      const result = calculateKarma(guesses);
      // 10 * 10 (full weight, within 5%) = 100
      // Consistency bonuses at guess 5 and 10 = 2 * 2 = 4
      // Total = 104
      expect(result.karma).toBe(104);
    });

    it('resets consistency streak on inaccurate guess', () => {
      const guesses: ResolvedGuess[] = [
        // 4 accurate guesses
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 5 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 6 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 7 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 8 },
        // 1 bad guess (25% off, within 50% so no penalty but not accurate)
        { guessedPrice: 500000, actualPrice: 400000, guessIndex: 9 },
        // 4 more accurate guesses (streak restarts)
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 10 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 11 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 12 },
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 13 },
      ];
      const result = calculateKarma(guesses);
      // 4 * 10 = 40 (accurate)
      // 1 * 0 = 0 (25% off, no reward)
      // 4 * 10 = 40 (accurate)
      // Streak never reached 5, so no consistency bonus
      // Total = 80
      expect(result.karma).toBe(80);
    });

    it('handles mixed accuracy tiers', () => {
      const guesses: ResolvedGuess[] = [
        { guessedPrice: 400000, actualPrice: 400000, guessIndex: 5 }, // 0%, reward 10
        { guessedPrice: 370000, actualPrice: 400000, guessIndex: 6 }, // 7.5%, reward 5
        { guessedPrice: 340000, actualPrice: 400000, guessIndex: 7 }, // 15%, reward 2
        { guessedPrice: 500000, actualPrice: 400000, guessIndex: 8 }, // 25%, reward 0
        { guessedPrice: 100000, actualPrice: 400000, guessIndex: 9 }, // 75%, penalty -3
      ];
      const result = calculateKarma(guesses);
      // 10 + 5 + 2 + 0 + (-3) = 14
      expect(result.karma).toBe(14);
      expect(result.internalKarma).toBe(14);
    });

    it('correctly scores edge case deviations', () => {
      // Exactly 5% off - should be tier 1 (10)
      const r1 = scoreGuessAccuracy(420000, 400000);
      expect(r1.reward).toBe(10);

      // Exactly 10% off - should be tier 2 (5)
      const r2 = scoreGuessAccuracy(440000, 400000);
      expect(r2.reward).toBe(5);

      // Exactly 20% off - should be tier 3 (2)
      const r3 = scoreGuessAccuracy(480000, 400000);
      expect(r3.reward).toBe(2);

      // Exactly 50% off - should be tier 4 (0)
      const r4 = scoreGuessAccuracy(600000, 400000);
      expect(r4.reward).toBe(0);
    });
  });

  describe('KARMA_CONSTANTS', () => {
    it('exports expected constants', () => {
      expect(KARMA_CONSTANTS.NEW_ACCOUNT_THRESHOLD).toBe(5);
      expect(KARMA_CONSTANTS.NEW_ACCOUNT_WEIGHT).toBe(0.5);
      expect(KARMA_CONSTANTS.CONSISTENCY_STREAK_LENGTH).toBe(5);
      expect(KARMA_CONSTANTS.CONSISTENCY_BONUS).toBe(2);
      expect(KARMA_CONSTANTS.PENALTY_AMOUNT).toBe(-3);
      expect(KARMA_CONSTANTS.PENALTY_DEVIATION).toBe(0.5);
    });

    it('has 3 positive reward tiers', () => {
      expect(KARMA_CONSTANTS.ACCURACY_TIERS).toHaveLength(3);
      for (const tier of KARMA_CONSTANTS.ACCURACY_TIERS) {
        expect(tier.reward).toBeGreaterThan(0);
      }
    });

    it('has 6 karma ranks in descending order', () => {
      expect(KARMA_CONSTANTS.KARMA_RANKS).toHaveLength(6);
      for (let i = 0; i < KARMA_CONSTANTS.KARMA_RANKS.length - 1; i++) {
        expect(KARMA_CONSTANTS.KARMA_RANKS[i].minKarma).toBeGreaterThan(
          KARMA_CONSTANTS.KARMA_RANKS[i + 1].minKarma
        );
      }
    });
  });
});

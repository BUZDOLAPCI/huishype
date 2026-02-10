import { describe, it, expect } from '@jest/globals';
import {
  karmaWeightedMean,
  standardDeviation,
  trimOutliers,
  calculateDistribution,
  getConfidence,
  blendFmv,
  calculateDivergence,
  calculateFmv,
  type WeightedGuess,
} from '../services/fmv.js';

describe('FMV Service', () => {
  describe('karmaWeightedMean', () => {
    it('returns 0 for empty guesses', () => {
      expect(karmaWeightedMean([])).toBe(0);
    });

    it('returns the price for a single guess', () => {
      expect(karmaWeightedMean([{ guessedPrice: 400000, karma: 10 }])).toBe(400000);
    });

    it('weights equally when all karma is the same', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 10 },
        { guessedPrice: 500000, karma: 10 },
      ];
      expect(karmaWeightedMean(guesses)).toBe(400000);
    });

    it('gives more weight to higher karma users', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 100 }, // weight 100
        { guessedPrice: 500000, karma: 1 },   // weight 1
      ];
      // (300000*100 + 500000*1) / (100+1) = 30500000/101 ≈ 301980
      const result = karmaWeightedMean(guesses);
      expect(result).toBeCloseTo(301980, -1);
    });

    it('uses minimum weight of 1 for 0-karma users', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 0 }, // weight 1 (min)
        { guessedPrice: 500000, karma: 0 }, // weight 1 (min)
      ];
      expect(karmaWeightedMean(guesses)).toBe(400000);
    });

    it('uses minimum weight of 1 for negative karma users', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: -50 }, // weight 1 (min)
        { guessedPrice: 500000, karma: -50 }, // weight 1 (min)
      ];
      expect(karmaWeightedMean(guesses)).toBe(400000);
    });
  });

  describe('standardDeviation', () => {
    it('returns 0 for empty array', () => {
      expect(standardDeviation([])).toBe(0);
    });

    it('returns 0 for single value', () => {
      expect(standardDeviation([400000])).toBe(0);
    });

    it('returns 0 for all same values', () => {
      expect(standardDeviation([400000, 400000, 400000])).toBe(0);
    });

    it('calculates correctly for known values', () => {
      // Mean = 400000, deviations = [-100000, 0, 100000]
      // Variance = (10^10 + 0 + 10^10) / 3 = 2*10^10/3
      // SD = sqrt(2*10^10/3) ≈ 81650
      const result = standardDeviation([300000, 400000, 500000]);
      expect(result).toBeCloseTo(81650, -2);
    });
  });

  describe('trimOutliers', () => {
    it('returns all guesses when fewer than 3', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 100000, karma: 1 },
        { guessedPrice: 900000, karma: 1 },
      ];
      expect(trimOutliers(guesses)).toHaveLength(2);
    });

    it('keeps all guesses when no outliers', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 380000, karma: 10 },
        { guessedPrice: 400000, karma: 10 },
        { guessedPrice: 420000, karma: 10 },
      ];
      expect(trimOutliers(guesses)).toHaveLength(3);
    });

    it('removes extreme outliers beyond 2 SD', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 400000, karma: 10 },
        { guessedPrice: 410000, karma: 10 },
        { guessedPrice: 390000, karma: 10 },
        { guessedPrice: 405000, karma: 10 },
        { guessedPrice: 1000000, karma: 1 }, // extreme outlier
      ];
      const trimmed = trimOutliers(guesses);
      expect(trimmed.length).toBeLessThan(5);
      // The 1M outlier should be removed
      expect(trimmed.every((g) => g.guessedPrice < 900000)).toBe(true);
    });

    it('returns all guesses when all prices are identical', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 400000, karma: 1 },
        { guessedPrice: 400000, karma: 5 },
        { guessedPrice: 400000, karma: 100 },
      ];
      expect(trimOutliers(guesses)).toHaveLength(3);
    });
  });

  describe('calculateDistribution', () => {
    it('returns null for empty prices', () => {
      expect(calculateDistribution([])).toBeNull();
    });

    it('returns correct distribution for single price', () => {
      const dist = calculateDistribution([400000]);
      expect(dist).toEqual({
        p10: 400000,
        p25: 400000,
        p50: 400000,
        p75: 400000,
        p90: 400000,
        min: 400000,
        max: 400000,
      });
    });

    it('returns correct min/max', () => {
      const dist = calculateDistribution([200000, 300000, 400000, 500000, 600000]);
      expect(dist!.min).toBe(200000);
      expect(dist!.max).toBe(600000);
    });

    it('calculates p50 as median', () => {
      const dist = calculateDistribution([200000, 300000, 400000, 500000, 600000]);
      expect(dist!.p50).toBe(400000);
    });

    it('interpolates percentiles for small sets', () => {
      const dist = calculateDistribution([300000, 500000]);
      expect(dist!.p50).toBe(400000); // midpoint
      expect(dist!.min).toBe(300000);
      expect(dist!.max).toBe(500000);
    });
  });

  describe('getConfidence', () => {
    it('returns none for 0 guesses', () => {
      expect(getConfidence(0)).toBe('none');
    });

    it('returns low for 1-2 guesses', () => {
      expect(getConfidence(1)).toBe('low');
      expect(getConfidence(2)).toBe('low');
    });

    it('returns medium for 3-9 guesses', () => {
      expect(getConfidence(3)).toBe('medium');
      expect(getConfidence(9)).toBe('medium');
    });

    it('returns high for 10+ guesses', () => {
      expect(getConfidence(10)).toBe('high');
      expect(getConfidence(100)).toBe('high');
    });
  });

  describe('blendFmv', () => {
    it('returns WOZ for none confidence', () => {
      expect(blendFmv(0, 400000, 'none')).toBe(400000);
    });

    it('returns 0 for none confidence without WOZ', () => {
      expect(blendFmv(0, null, 'none')).toBe(0);
    });

    it('blends 70/30 WOZ/crowd for low confidence', () => {
      // 400000 * 0.7 + 500000 * 0.3 = 280000 + 150000 = 430000
      expect(blendFmv(500000, 400000, 'low')).toBe(430000);
    });

    it('blends 30/70 WOZ/crowd for medium confidence', () => {
      // 400000 * 0.3 + 500000 * 0.7 = 120000 + 350000 = 470000
      expect(blendFmv(500000, 400000, 'medium')).toBe(470000);
    });

    it('uses pure crowd for high confidence', () => {
      expect(blendFmv(500000, 400000, 'high')).toBe(500000);
    });

    it('uses crowd estimate when no WOZ available (any confidence)', () => {
      expect(blendFmv(500000, null, 'low')).toBe(500000);
      expect(blendFmv(500000, null, 'medium')).toBe(500000);
      expect(blendFmv(500000, null, 'high')).toBe(500000);
    });

    it('uses crowd estimate when WOZ is 0', () => {
      expect(blendFmv(500000, 0, 'low')).toBe(500000);
    });
  });

  describe('calculateDivergence', () => {
    it('returns null when FMV is null', () => {
      expect(calculateDivergence(null, 400000)).toBeNull();
    });

    it('returns null when asking price is null', () => {
      expect(calculateDivergence(400000, null)).toBeNull();
    });

    it('returns null when asking price is 0', () => {
      expect(calculateDivergence(400000, 0)).toBeNull();
    });

    it('returns 0 when FMV equals asking price', () => {
      expect(calculateDivergence(400000, 400000)).toBe(0);
    });

    it('returns positive when FMV > asking (underpriced)', () => {
      // (500000 - 400000) / 400000 = 25%
      expect(calculateDivergence(500000, 400000)).toBe(25);
    });

    it('returns negative when FMV < asking (overpriced)', () => {
      // (300000 - 400000) / 400000 = -25%
      expect(calculateDivergence(300000, 400000)).toBe(-25);
    });

    it('rounds to 2 decimal places', () => {
      // (333333 - 400000) / 400000 = -16.666675%
      const result = calculateDivergence(333333, 400000);
      expect(result).toBe(-16.67);
    });
  });

  describe('calculateFmv', () => {
    it('returns WOZ-only for 0 guesses', () => {
      const result = calculateFmv([], 400000, 350000);
      expect(result.fmv).toBe(400000);
      expect(result.confidence).toBe('none');
      expect(result.guessCount).toBe(0);
      expect(result.distribution).toBeNull();
      expect(result.wozValue).toBe(400000);
      expect(result.askingPrice).toBe(350000);
      expect(result.divergence).toBeCloseTo(14.29, 1);
    });

    it('returns null FMV when 0 guesses and no WOZ', () => {
      const result = calculateFmv([], null, 350000);
      expect(result.fmv).toBeNull();
      expect(result.confidence).toBe('none');
    });

    it('handles single guess with WOZ anchoring (low confidence)', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 500000, karma: 10 },
      ];
      const result = calculateFmv(guesses, 400000, null);
      // low confidence: 70% WOZ + 30% crowd = 280000 + 150000 = 430000
      expect(result.fmv).toBe(430000);
      expect(result.confidence).toBe('low');
      expect(result.guessCount).toBe(1);
    });

    it('handles 2 guesses (still low confidence)', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 500000, karma: 10 },
        { guessedPrice: 600000, karma: 10 },
      ];
      const result = calculateFmv(guesses, 400000, null);
      // Weighted mean = (500000*10 + 600000*10) / (10+10) = 550000
      // low confidence: 70% WOZ + 30% crowd = 280000 + 165000 = 445000
      expect(result.fmv).toBe(445000);
      expect(result.confidence).toBe('low');
    });

    it('handles 3 guesses (medium confidence)', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 500000, karma: 10 },
        { guessedPrice: 600000, karma: 10 },
        { guessedPrice: 550000, karma: 10 },
      ];
      const result = calculateFmv(guesses, 400000, null);
      // Weighted mean = (500000+600000+550000)*10 / (3*10) = 550000
      // medium confidence: 30% WOZ + 70% crowd = 120000 + 385000 = 505000
      expect(result.fmv).toBe(505000);
      expect(result.confidence).toBe('medium');
    });

    it('handles 10+ guesses (high confidence, crowd-only)', () => {
      const guesses: WeightedGuess[] = Array.from({ length: 10 }, () => ({
        guessedPrice: 500000,
        karma: 10,
      }));
      const result = calculateFmv(guesses, 400000, null);
      // high confidence: 100% crowd = 500000
      expect(result.fmv).toBe(500000);
      expect(result.confidence).toBe('high');
    });

    it('karma weighting affects FMV', () => {
      const guesses: WeightedGuess[] = Array.from({ length: 10 }, (_, i) => ({
        guessedPrice: i === 0 ? 600000 : 400000, // 1 high-karma expert says 600k
        karma: i === 0 ? 500 : 1, // expert has 500 karma
      }));
      const result = calculateFmv(guesses, null, null);
      // Expert's vote weighs 500, others weigh 1 each (9*1=9)
      // (600000*500 + 400000*9) / (500+9) = (300M + 3.6M) / 509 ≈ 596463
      expect(result.fmv).toBeGreaterThan(550000);
      expect(result.confidence).toBe('high');
    });

    it('includes distribution data', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 10 },
        { guessedPrice: 400000, karma: 10 },
        { guessedPrice: 500000, karma: 10 },
      ];
      const result = calculateFmv(guesses, null, null);
      expect(result.distribution).not.toBeNull();
      expect(result.distribution!.min).toBe(300000);
      expect(result.distribution!.max).toBe(500000);
      expect(result.distribution!.p50).toBe(400000);
    });

    it('calculates divergence when both FMV and asking price present', () => {
      const guesses: WeightedGuess[] = Array.from({ length: 10 }, () => ({
        guessedPrice: 500000,
        karma: 10,
      }));
      const result = calculateFmv(guesses, null, 400000);
      // FMV = 500000, asking = 400000, divergence = 25%
      expect(result.divergence).toBe(25);
    });

    it('trims outliers for 3+ guesses', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 400000, karma: 10 },
        { guessedPrice: 410000, karma: 10 },
        { guessedPrice: 390000, karma: 10 },
        { guessedPrice: 2000000, karma: 1 }, // extreme outlier
      ];
      const result = calculateFmv(guesses, null, null);
      // Without trimming, mean would be pulled towards 2M
      // With trimming, outlier removed, mean ≈ 400000
      expect(result.fmv).toBeLessThan(500000);
    });

    it('handles all-same-karma guesses', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 50 },
        { guessedPrice: 400000, karma: 50 },
        { guessedPrice: 500000, karma: 50 },
      ];
      const result = calculateFmv(guesses, null, null);
      // All same karma = simple average = 400000
      // medium confidence, no WOZ = crowd only
      expect(result.fmv).toBe(400000);
    });

    it('handles mixed karma levels', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 300000, karma: 100 },
        { guessedPrice: 400000, karma: 50 },
        { guessedPrice: 500000, karma: 10 },
      ];
      const result = calculateFmv(guesses, null, null);
      // Weighted: (300000*100 + 400000*50 + 500000*10) / (100+50+10)
      // = (30M + 20M + 5M) / 160 = 343750
      expect(result.fmv).toBe(343750);
    });

    it('handles no WOZ and no asking price', () => {
      const guesses: WeightedGuess[] = [
        { guessedPrice: 400000, karma: 10 },
      ];
      const result = calculateFmv(guesses, null, null);
      expect(result.wozValue).toBeNull();
      expect(result.askingPrice).toBeNull();
      expect(result.divergence).toBeNull();
      // No WOZ: falls back to crowd estimate regardless of confidence
      expect(result.fmv).toBe(400000);
    });
  });
});

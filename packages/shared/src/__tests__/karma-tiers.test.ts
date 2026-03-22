import { describe, it, expect } from 'vitest';
import { KARMA_TIERS, getKarmaTier, type KarmaTier } from '../utils/karma-tiers.js';

describe('karma-tiers', () => {
  describe('KARMA_TIERS', () => {
    it('has 7 tiers', () => {
      expect(KARMA_TIERS).toHaveLength(7);
    });

    it('is sorted descending by minKarma', () => {
      for (let i = 1; i < KARMA_TIERS.length; i++) {
        expect(KARMA_TIERS[i - 1].minKarma).toBeGreaterThan(KARMA_TIERS[i].minKarma);
      }
    });

    it('has unique levels 1-7', () => {
      const levels = KARMA_TIERS.map(t => t.level).sort();
      expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('has the lowest tier at minKarma 0', () => {
      const lowest = KARMA_TIERS[KARMA_TIERS.length - 1];
      expect(lowest.minKarma).toBe(0);
      expect(lowest.level).toBe(1);
    });

    it('has non-empty labels, bgColor, and textColor for every tier', () => {
      for (const tier of KARMA_TIERS) {
        expect(tier.label).toBeTruthy();
        expect(tier.bgColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(tier.textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  describe('getKarmaTier', () => {
    it('returns Newcomer for karma 0', () => {
      expect(getKarmaTier(0).label).toBe('Newcomer');
    });

    it('returns Contributor for karma 10', () => {
      expect(getKarmaTier(10).label).toBe('Contributor');
    });

    it('returns Rising Star for karma 50', () => {
      expect(getKarmaTier(50).label).toBe('Rising Star');
    });

    it('returns Local Expert for karma 100', () => {
      expect(getKarmaTier(100).label).toBe('Local Expert');
    });

    it('returns Expert for karma 200', () => {
      expect(getKarmaTier(200).label).toBe('Expert');
    });

    it('returns Local Legend for karma 500', () => {
      expect(getKarmaTier(500).label).toBe('Local Legend');
    });

    it('returns Master for karma 1000', () => {
      expect(getKarmaTier(1000).label).toBe('Master');
    });

    it('returns Master for very high karma', () => {
      expect(getKarmaTier(99999).label).toBe('Master');
    });

    it('clamps negative karma to Newcomer', () => {
      expect(getKarmaTier(-50).label).toBe('Newcomer');
      expect(getKarmaTier(-1).label).toBe('Newcomer');
    });

    it('returns exact boundary values correctly', () => {
      // Each tier should activate exactly at its minKarma
      expect(getKarmaTier(9).label).toBe('Newcomer');
      expect(getKarmaTier(10).label).toBe('Contributor');
      expect(getKarmaTier(49).label).toBe('Contributor');
      expect(getKarmaTier(50).label).toBe('Rising Star');
      expect(getKarmaTier(99).label).toBe('Rising Star');
      expect(getKarmaTier(100).label).toBe('Local Expert');
      expect(getKarmaTier(199).label).toBe('Local Expert');
      expect(getKarmaTier(200).label).toBe('Expert');
      expect(getKarmaTier(499).label).toBe('Expert');
      expect(getKarmaTier(500).label).toBe('Local Legend');
      expect(getKarmaTier(999).label).toBe('Local Legend');
      expect(getKarmaTier(1000).label).toBe('Master');
    });

    it('returns the correct level for each tier', () => {
      expect(getKarmaTier(0).level).toBe(1);
      expect(getKarmaTier(10).level).toBe(2);
      expect(getKarmaTier(50).level).toBe(3);
      expect(getKarmaTier(100).level).toBe(4);
      expect(getKarmaTier(200).level).toBe(5);
      expect(getKarmaTier(500).level).toBe(6);
      expect(getKarmaTier(1000).level).toBe(7);
    });
  });
});

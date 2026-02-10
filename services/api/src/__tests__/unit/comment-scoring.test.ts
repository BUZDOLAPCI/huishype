import { describe, it, expect } from '@jest/globals';
import { calculateRecencyBonus, calculateCommentScore } from '../../routes/comments.js';

describe('Comment scoring', () => {
  // Fixed reference time for deterministic tests
  const now = new Date('2026-02-10T12:00:00Z');

  describe('calculateRecencyBonus', () => {
    it('returns 10 for comments less than 1 hour old', () => {
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      expect(calculateRecencyBonus(thirtyMinAgo, now)).toBe(10);
    });

    it('returns 10 for comments just under 1 hour', () => {
      const almostOneHour = new Date(now.getTime() - 59 * 60 * 1000);
      expect(calculateRecencyBonus(almostOneHour, now)).toBe(10);
    });

    it('returns 5 for comments between 1 and 24 hours old', () => {
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(twoHoursAgo, now)).toBe(5);
    });

    it('returns 5 for comments just over 1 hour old', () => {
      const justOverOneHour = new Date(now.getTime() - 61 * 60 * 1000);
      expect(calculateRecencyBonus(justOverOneHour, now)).toBe(5);
    });

    it('returns 5 for comments just under 24 hours old', () => {
      const almostOneDay = new Date(now.getTime() - 23 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(almostOneDay, now)).toBe(5);
    });

    it('returns 2 for comments between 1 and 7 days old', () => {
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(threeDaysAgo, now)).toBe(2);
    });

    it('returns 2 for comments just over 24 hours old', () => {
      const justOverOneDay = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(justOverOneDay, now)).toBe(2);
    });

    it('returns 0 for comments older than 7 days', () => {
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(twoWeeksAgo, now)).toBe(0);
    });

    it('returns 0 for comments exactly 7 days old', () => {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(calculateRecencyBonus(sevenDaysAgo, now)).toBe(0);
    });

    it('returns 10 for brand new comments (0ms age)', () => {
      expect(calculateRecencyBonus(now, now)).toBe(10);
    });
  });

  describe('calculateCommentScore', () => {
    it('returns recency bonus only when likeCount is 0', () => {
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      expect(calculateCommentScore(0, thirtyMinAgo, now)).toBe(10);
    });

    it('returns (likes * 2) + recency bonus', () => {
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      // 5 likes * 2 = 10, recency bonus = 10 → total = 20
      expect(calculateCommentScore(5, thirtyMinAgo, now)).toBe(20);
    });

    it('weights likes by 2x', () => {
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      // 3 likes * 2 = 6, recency bonus = 0 → total = 6
      expect(calculateCommentScore(3, twoWeeksAgo, now)).toBe(6);
    });

    it('new comment with no likes beats old comment with 2 likes', () => {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const newScore = calculateCommentScore(0, fiveMinAgo, now); // 0 + 10 = 10
      const oldScore = calculateCommentScore(2, twoWeeksAgo, now); // 4 + 0 = 4

      expect(newScore).toBeGreaterThan(oldScore);
    });

    it('old comment with many likes beats new comment with no likes', () => {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const newScore = calculateCommentScore(0, fiveMinAgo, now); // 0 + 10 = 10
      const oldPopularScore = calculateCommentScore(10, twoWeeksAgo, now); // 20 + 0 = 20

      expect(oldPopularScore).toBeGreaterThan(newScore);
    });

    it('handles the boundary correctly: 1hr-old 3-like vs brand-new 0-like', () => {
      const oneHourAgo = new Date(now.getTime() - 61 * 60 * 1000);

      const olderWithLikes = calculateCommentScore(3, oneHourAgo, now); // 6 + 5 = 11
      const brandNew = calculateCommentScore(0, now, now); // 0 + 10 = 10

      expect(olderWithLikes).toBeGreaterThan(brandNew);
    });
  });
});

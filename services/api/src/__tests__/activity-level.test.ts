import { describe, it, expect } from '@jest/globals';
import { calculateActivityLevel } from '../routes/views.js';

describe('calculateActivityLevel', () => {
  describe('hot activity', () => {
    it('should return hot when recent views > 50', () => {
      expect(calculateActivityLevel(51, 0, 0)).toBe('hot');
      expect(calculateActivityLevel(100, 0, 0)).toBe('hot');
    });

    it('should return hot when comment count > 10', () => {
      expect(calculateActivityLevel(0, 11, 0)).toBe('hot');
      expect(calculateActivityLevel(0, 50, 0)).toBe('hot');
    });

    it('should return hot when guess count > 5', () => {
      expect(calculateActivityLevel(0, 0, 6)).toBe('hot');
      expect(calculateActivityLevel(0, 0, 20)).toBe('hot');
    });

    it('should return hot when multiple criteria exceed thresholds', () => {
      expect(calculateActivityLevel(100, 20, 10)).toBe('hot');
    });
  });

  describe('warm activity', () => {
    it('should return warm when recent views > 10 but <= 50', () => {
      expect(calculateActivityLevel(11, 0, 0)).toBe('warm');
      expect(calculateActivityLevel(50, 0, 0)).toBe('warm');
    });

    it('should return warm when comment count > 3 but <= 10', () => {
      expect(calculateActivityLevel(0, 4, 0)).toBe('warm');
      expect(calculateActivityLevel(0, 10, 0)).toBe('warm');
    });

    it('should return warm when guess count > 1 but <= 5', () => {
      expect(calculateActivityLevel(0, 0, 2)).toBe('warm');
      expect(calculateActivityLevel(0, 0, 5)).toBe('warm');
    });
  });

  describe('cold activity', () => {
    it('should return cold when all metrics are at or below thresholds', () => {
      expect(calculateActivityLevel(0, 0, 0)).toBe('cold');
      expect(calculateActivityLevel(10, 3, 1)).toBe('cold');
      expect(calculateActivityLevel(5, 2, 0)).toBe('cold');
    });
  });

  describe('boundary values', () => {
    it('should return cold at exactly 10 views, 3 comments, 1 guess', () => {
      expect(calculateActivityLevel(10, 3, 1)).toBe('cold');
    });

    it('should return warm at 11 views', () => {
      expect(calculateActivityLevel(11, 0, 0)).toBe('warm');
    });

    it('should return warm at 4 comments', () => {
      expect(calculateActivityLevel(0, 4, 0)).toBe('warm');
    });

    it('should return warm at 2 guesses', () => {
      expect(calculateActivityLevel(0, 0, 2)).toBe('warm');
    });

    it('should return hot at 51 views', () => {
      expect(calculateActivityLevel(51, 0, 0)).toBe('hot');
    });

    it('should return hot at 11 comments', () => {
      expect(calculateActivityLevel(0, 11, 0)).toBe('hot');
    });

    it('should return hot at 6 guesses', () => {
      expect(calculateActivityLevel(0, 0, 6)).toBe('hot');
    });

    it('should return warm at exactly 50 views (not hot)', () => {
      expect(calculateActivityLevel(50, 0, 0)).toBe('warm');
    });

    it('should return warm at exactly 10 comments (not hot)', () => {
      expect(calculateActivityLevel(0, 10, 0)).toBe('warm');
    });

    it('should return warm at exactly 5 guesses (not hot)', () => {
      expect(calculateActivityLevel(0, 0, 5)).toBe('warm');
    });
  });
});

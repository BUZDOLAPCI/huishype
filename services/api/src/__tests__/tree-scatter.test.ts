import { describe, test, expect } from '@jest/globals';
import { scatterCandidatePoints, seededRandom, tileSeed } from '../services/tree-scatter.js';

describe('tree-scatter', () => {
  test('seededRandom produces deterministic sequence', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(12345);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  test('seededRandom produces values in [0, 1)', () => {
    const rng = seededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('different seeds produce different sequences', () => {
    const rng1 = seededRandom(1);
    const rng2 = seededRandom(2);
    const seq1 = Array.from({ length: 5 }, () => rng1());
    const seq2 = Array.from({ length: 5 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  test('tileSeed is deterministic', () => {
    expect(tileSeed(15, 16892, 10898)).toBe(tileSeed(15, 16892, 10898));
    expect(tileSeed(15, 16892, 10898)).not.toBe(tileSeed(15, 16893, 10898));
  });

  test('scatterCandidatePoints generates correct count in bbox', () => {
    const points = scatterCandidatePoints(
      { minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 },
      20, 16, 12345,
    );
    expect(points).toHaveLength(20);
    points.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(5.4);
      expect(p.lon).toBeLessThanOrEqual(5.5);
      expect(p.lat).toBeGreaterThanOrEqual(51.4);
      expect(p.lat).toBeLessThanOrEqual(51.5);
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(16);
    });
  });

  test('scatterCandidatePoints is deterministic with same seed', () => {
    const p1 = scatterCandidatePoints({ minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 }, 10, 16, 999);
    const p2 = scatterCandidatePoints({ minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 }, 10, 16, 999);
    expect(p1).toEqual(p2);
  });

  test('scatterCandidatePoints returns empty array for count 0', () => {
    const points = scatterCandidatePoints(
      { minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 },
      0, 16, 12345,
    );
    expect(points).toHaveLength(0);
  });
});

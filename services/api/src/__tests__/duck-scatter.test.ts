import { describe, expect, test } from '@jest/globals';
import {
  DUCK_CANDIDATES_LEVEL1,
  DUCK_VARIANTS,
  generateDuckCandidates,
  getAncestorTile,
  scatterCandidatePoints,
  seededRandom,
  tileSeed,
  tileToBBox,
} from '../services/duck-scatter.js';

describe('duck-scatter', () => {
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
      20,
      DUCK_VARIANTS,
      12345
    );

    expect(points).toHaveLength(20);
    points.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(5.4);
      expect(p.lon).toBeLessThanOrEqual(5.5);
      expect(p.lat).toBeGreaterThanOrEqual(51.4);
      expect(p.lat).toBeLessThanOrEqual(51.5);
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(DUCK_VARIANTS);
    });
  });

  test('scatterCandidatePoints is deterministic with same seed', () => {
    const bbox = { minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 };
    const p1 = scatterCandidatePoints(bbox, 10, DUCK_VARIANTS, 999);
    const p2 = scatterCandidatePoints(bbox, 10, DUCK_VARIANTS, 999);
    expect(p1).toEqual(p2);
  });
});

describe('duck tile anchoring', () => {
  test('z15 tile is its own ancestor at z15', () => {
    expect(getAncestorTile(15, 16892, 10898, 15)).toEqual({ x: 16892, y: 10898 });
  });

  test('z16 sibling tiles share the same z15 ancestor', () => {
    const ancestors = [
      getAncestorTile(16, 33784, 21796, 15),
      getAncestorTile(16, 33785, 21796, 15),
      getAncestorTile(16, 33784, 21797, 15),
      getAncestorTile(16, 33785, 21797, 15),
    ];
    ancestors.forEach((ancestor) => expect(ancestor).toEqual({ x: 16892, y: 10898 }));
  });

  test('z17 tile maps to correct z15 ancestor', () => {
    expect(getAncestorTile(17, 67568, 43592, 15)).toEqual({ x: 16892, y: 10898 });
  });

  test('child tile bbox is within parent tile bbox', () => {
    const parentBBox = tileToBBox(15, 16892, 10898);
    const childBBox = tileToBBox(16, 33784, 21796);
    expect(childBBox.minLon).toBeGreaterThanOrEqual(parentBBox.minLon);
    expect(childBBox.maxLon).toBeLessThanOrEqual(parentBBox.maxLon);
    expect(childBBox.minLat).toBeGreaterThanOrEqual(parentBBox.minLat);
    expect(childBBox.maxLat).toBeLessThanOrEqual(parentBBox.maxLat);
  });
});

describe('generateDuckCandidates', () => {
  const pointKey = (p: { lon: number; lat: number; variant: number }) =>
    `${p.lon}:${p.lat}:${p.variant}`;

  test('is deterministic for same inputs', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const c1 = generateDuckCandidates(15, 16892, 10898, bbox);
    const c2 = generateDuckCandidates(15, 16892, 10898, bbox);
    expect(c1).toEqual(c2);
  });

  test('at z15 returns exactly sparse base candidates', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const candidates = generateDuckCandidates(15, 16892, 10898, bbox);
    expect(candidates).toHaveLength(DUCK_CANDIDATES_LEVEL1);
  });

  test('all z15 candidates fall within z15 bbox', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const candidates = generateDuckCandidates(15, 16892, 10898, bbox);
    candidates.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(bbox.minLon);
      expect(p.lon).toBeLessThanOrEqual(bbox.maxLon);
      expect(p.lat).toBeGreaterThanOrEqual(bbox.minLat);
      expect(p.lat).toBeLessThanOrEqual(bbox.maxLat);
    });
  });

  test('z16 child tiles collectively contain only the z15 base density', () => {
    const childCoords = [
      [33784, 21796],
      [33785, 21796],
      [33784, 21797],
      [33785, 21797],
    ];

    let totalChildDucks = 0;
    for (const [cx, cy] of childCoords) {
      const childBBox = tileToBBox(16, cx, cy);
      totalChildDucks += generateDuckCandidates(16, cx, cy, childBBox).length;
    }

    expect(totalChildDucks).toBe(DUCK_CANDIDATES_LEVEL1);
  });

  test('z17 child tiles collectively preserve the z16 base candidates exactly', () => {
    const z16BBox = tileToBBox(16, 33784, 21796);
    const z16Ducks = generateDuckCandidates(16, 33784, 21796, z16BBox);
    const z17Coords = [
      [67568, 43592],
      [67569, 43592],
      [67568, 43593],
      [67569, 43593],
    ];

    const z17Ducks = z17Coords.flatMap(([gx, gy]) =>
      generateDuckCandidates(17, gx, gy, tileToBBox(17, gx, gy))
    );

    expect(new Set(z17Ducks.map(pointKey))).toEqual(new Set(z16Ducks.map(pointKey)));
  });

  test('variant values are valid', () => {
    const bbox = tileToBBox(16, 33784, 21796);
    const candidates = generateDuckCandidates(16, 33784, 21796, bbox);
    candidates.forEach((p) => {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(DUCK_VARIANTS);
    });
  });
});

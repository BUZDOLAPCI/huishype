import { describe, test, expect } from '@jest/globals';
import {
  scatterCandidatePoints,
  seededRandom,
  tileSeed,
  tileToBBox,
  getAncestorTile,
  generateTreeCandidates,
  TREE_CANDIDATES_LEVEL1,
  TREE_CANDIDATES_LEVEL2,
} from '../services/tree-scatter.js';

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

describe('getAncestorTile', () => {
  test('z15 tile is its own ancestor at z15', () => {
    const ancestor = getAncestorTile(15, 16892, 10898, 15);
    expect(ancestor).toEqual({ x: 16892, y: 10898 });
  });

  test('z16 tile maps to correct z15 ancestor', () => {
    // z16 tile (33784, 21796) should map to z15 tile (16892, 10898)
    const ancestor = getAncestorTile(16, 33784, 21796, 15);
    expect(ancestor).toEqual({ x: 16892, y: 10898 });
  });

  test('z16 sibling tiles share the same z15 ancestor', () => {
    // Four z16 children of z15 tile (16892, 10898):
    // (33784, 21796), (33785, 21796), (33784, 21797), (33785, 21797)
    const a1 = getAncestorTile(16, 33784, 21796, 15);
    const a2 = getAncestorTile(16, 33785, 21796, 15);
    const a3 = getAncestorTile(16, 33784, 21797, 15);
    const a4 = getAncestorTile(16, 33785, 21797, 15);
    expect(a1).toEqual(a2);
    expect(a2).toEqual(a3);
    expect(a3).toEqual(a4);
    expect(a1).toEqual({ x: 16892, y: 10898 });
  });

  test('z17 tile maps to correct z15 ancestor', () => {
    // z17 tile (67568, 43592) >> 2 = (16892, 10898)
    const ancestor = getAncestorTile(17, 67568, 43592, 15);
    expect(ancestor).toEqual({ x: 16892, y: 10898 });
  });

  test('z18 tile maps to correct z15 ancestor', () => {
    const ancestor = getAncestorTile(18, 135136, 87184, 15);
    expect(ancestor).toEqual({ x: 16892, y: 10898 });
  });
});

describe('tileToBBox', () => {
  test('returns valid bounding box', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    expect(bbox.minLon).toBeLessThan(bbox.maxLon);
    expect(bbox.minLat).toBeLessThan(bbox.maxLat);
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

describe('generateTreeCandidates', () => {
  test('is deterministic for same inputs', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const c1 = generateTreeCandidates(15, 16892, 10898, bbox, 16);
    const c2 = generateTreeCandidates(15, 16892, 10898, bbox, 16);
    expect(c1).toEqual(c2);
  });

  test('at z15 returns exactly TREE_CANDIDATES_LEVEL1 candidates', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const candidates = generateTreeCandidates(15, 16892, 10898, bbox, 16);
    expect(candidates).toHaveLength(TREE_CANDIDATES_LEVEL1);
  });

  test('all z15 candidates fall within z15 bbox', () => {
    const bbox = tileToBBox(15, 16892, 10898);
    const candidates = generateTreeCandidates(15, 16892, 10898, bbox, 16);
    candidates.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(bbox.minLon);
      expect(p.lon).toBeLessThanOrEqual(bbox.maxLon);
      expect(p.lat).toBeGreaterThanOrEqual(bbox.minLat);
      expect(p.lat).toBeLessThanOrEqual(bbox.maxLat);
    });
  });

  test('z16 child tiles collectively contain ALL z15 parent trees', () => {
    // Generate z15 parent trees
    const parentBBox = tileToBBox(15, 16892, 10898);
    const parentTrees = generateTreeCandidates(15, 16892, 10898, parentBBox, 16);

    // Generate trees for all 4 z16 children
    const childCoords = [
      [33784, 21796],
      [33785, 21796],
      [33784, 21797],
      [33785, 21797],
    ];
    const allChildTrees: Array<{ lon: number; lat: number; variant: number }> = [];
    for (const [cx, cy] of childCoords) {
      const childBBox = tileToBBox(16, cx, cy);
      const childTrees = generateTreeCandidates(16, cx, cy, childBBox, 16);
      allChildTrees.push(...childTrees);
    }

    // Every z15 parent tree must appear in the combined z16 child trees
    for (const parentTree of parentTrees) {
      const found = allChildTrees.some(
        (ct) =>
          ct.lon === parentTree.lon &&
          ct.lat === parentTree.lat &&
          ct.variant === parentTree.variant,
      );
      expect(found).toBe(true);
    }
  });

  test('z16 tiles have more candidates than z15 (Level 2 added)', () => {
    // Total z16 children trees should equal LEVEL1 + LEVEL2
    const parentBBox = tileToBBox(15, 16892, 10898);
    const childCoords = [
      [33784, 21796],
      [33785, 21796],
      [33784, 21797],
      [33785, 21797],
    ];
    let totalChildTrees = 0;
    for (const [cx, cy] of childCoords) {
      const childBBox = tileToBBox(16, cx, cy);
      const childTrees = generateTreeCandidates(16, cx, cy, childBBox, 16);
      totalChildTrees += childTrees.length;
    }
    // Combined z16 children should have LEVEL1 + LEVEL2 total
    expect(totalChildTrees).toBe(TREE_CANDIDATES_LEVEL1 + TREE_CANDIDATES_LEVEL2);
  });

  test('all z16 candidates fall within their respective tile bbox', () => {
    const childBBox = tileToBBox(16, 33784, 21796);
    const candidates = generateTreeCandidates(16, 33784, 21796, childBBox, 16);
    candidates.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(childBBox.minLon);
      expect(p.lon).toBeLessThanOrEqual(childBBox.maxLon);
      expect(p.lat).toBeGreaterThanOrEqual(childBBox.minLat);
      expect(p.lat).toBeLessThanOrEqual(childBBox.maxLat);
    });
  });

  test('z17 child tiles collectively contain ALL z15 parent trees within their area', () => {
    // Generate z15 parent trees
    const parentBBox = tileToBBox(15, 16892, 10898);
    const parentTrees = generateTreeCandidates(15, 16892, 10898, parentBBox, 16);

    // Pick one z16 child, then check its 4 z17 grandchildren
    // z16 (33784, 21796) -> z17 children: (67568,43592), (67569,43592), (67568,43593), (67569,43593)
    const z16BBox = tileToBBox(16, 33784, 21796);
    const z17Coords = [
      [67568, 43592],
      [67569, 43592],
      [67568, 43593],
      [67569, 43593],
    ];
    const allZ17Trees: Array<{ lon: number; lat: number; variant: number }> = [];
    for (const [gx, gy] of z17Coords) {
      const grandchildBBox = tileToBBox(17, gx, gy);
      const trees = generateTreeCandidates(17, gx, gy, grandchildBBox, 16);
      allZ17Trees.push(...trees);
    }

    // Every z15 parent tree that falls within this z16 quadrant must be present
    const parentTreesInQuadrant = parentTrees.filter(
      (p) =>
        p.lon >= z16BBox.minLon &&
        p.lon <= z16BBox.maxLon &&
        p.lat >= z16BBox.minLat &&
        p.lat <= z16BBox.maxLat,
    );

    for (const parentTree of parentTreesInQuadrant) {
      const found = allZ17Trees.some(
        (ct) =>
          ct.lon === parentTree.lon &&
          ct.lat === parentTree.lat &&
          ct.variant === parentTree.variant,
      );
      expect(found).toBe(true);
    }
  });

  test('variant values are valid', () => {
    const bbox = tileToBBox(16, 33784, 21796);
    const candidates = generateTreeCandidates(16, 33784, 21796, bbox, 16);
    candidates.forEach((p) => {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(16);
    });
  });
});

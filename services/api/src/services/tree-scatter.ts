export interface ScatterPoint {
  lon: number;
  lat: number;
  variant: number;
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Base density candidates generated at every zoom >= 15 */
export const TREE_CANDIDATES_LEVEL1 = 200;
/** Additional density candidates generated at zoom >= 16 */
export const TREE_CANDIDATES_LEVEL2 = 400;
/** Source-only re-enable switch for z16+ decorative tree density. */
const ENABLE_TREE_LEVEL2_DENSITY = false;
/** Seed offset for Level 2 candidates (ensures different positions from Level 1) */
const LEVEL2_SEED_OFFSET = 0xdeadbeef;
/** Anchor zoom level — all tree positions are derived from z15 tile coordinates */
const ANCHOR_ZOOM = 15;

/**
 * Simple seeded PRNG (Mulberry32)
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash tile coordinates to a seed
 */
export function tileSeed(z: number, x: number, y: number): number {
  return (z * 73856093) ^ (x * 19349663) ^ (y * 83492791);
}

/**
 * Convert tile coordinates to bounding box in EPSG:4326 (WGS84)
 */
export function tileToBBox(z: number, x: number, y: number): BBox {
  const n = Math.pow(2, z);
  const minLon = (x / n) * 360 - 180;
  const maxLon = ((x + 1) / n) * 360 - 180;
  const minLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const maxLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const minLat = (minLatRad * 180) / Math.PI;
  const maxLat = (maxLatRad * 180) / Math.PI;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Get the ancestor tile coordinates at a given ancestor zoom level.
 * For example, a z17 tile's z15 ancestor is found by right-shifting
 * its x/y coordinates by (17 - 15) = 2 bits.
 */
export function getAncestorTile(
  z: number,
  x: number,
  y: number,
  ancestorZ: number,
): { x: number; y: number } {
  const shift = z - ancestorZ;
  return { x: x >> shift, y: y >> shift };
}

/**
 * Scatter random points inside a bounding box (used as candidates,
 * filtered by PostGIS ST_Within against landcover polygons)
 */
export function scatterCandidatePoints(
  bbox: BBox,
  count: number,
  variants: number,
  seed: number,
): ScatterPoint[] {
  const rng = seededRandom(seed);
  const points: ScatterPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: bbox.minLon + rng() * (bbox.maxLon - bbox.minLon),
      lat: bbox.minLat + rng() * (bbox.maxLat - bbox.minLat),
      variant: Math.floor(rng() * variants),
    });
  }
  return points;
}

/**
 * Check if a point falls within a bounding box.
 */
function pointInBBox(p: ScatterPoint, bbox: BBox): boolean {
  return (
    p.lon >= bbox.minLon &&
    p.lon <= bbox.maxLon &&
    p.lat >= bbox.minLat &&
    p.lat <= bbox.maxLat
  );
}

/**
 * Generate tree candidate points anchored to z15 tiles for positional
 * consistency across zoom levels.
 *
 * All candidates are generated within the z15 ancestor tile's bbox using
 * the z15 tile's seed, then filtered to the current tile's bbox.
 *
 * - Level 1 (z15+): TREE_CANDIDATES_LEVEL1 candidates — base density
 * - Level 2 (disabled): TREE_CANDIDATES_LEVEL2 additional candidates — extra density
 *
 * This ensures z15 trees never jump or disappear when zooming in,
 * and z16+ tiles preserve the z15 set without extra decorative density.
 */
export function generateTreeCandidates(
  z: number,
  x: number,
  y: number,
  currentBBox: BBox,
  variants: number,
): ScatterPoint[] {
  // Find the z15 ancestor tile
  const ancestor = z === ANCHOR_ZOOM ? { x, y } : getAncestorTile(z, x, y, ANCHOR_ZOOM);
  const ancestorBBox = tileToBBox(ANCHOR_ZOOM, ancestor.x, ancestor.y);
  const ancestorSeed = tileSeed(ANCHOR_ZOOM, ancestor.x, ancestor.y);

  // Level 1: base density (always present at z15+)
  const level1 = scatterCandidatePoints(
    ancestorBBox,
    TREE_CANDIDATES_LEVEL1,
    variants,
    ancestorSeed,
  );

  // Level 2: additional density (z16+ only when deliberately re-enabled in source).
  let level2: ScatterPoint[] = [];
  if (ENABLE_TREE_LEVEL2_DENSITY && z >= ANCHOR_ZOOM + 1) {
    level2 = scatterCandidatePoints(
      ancestorBBox,
      TREE_CANDIDATES_LEVEL2,
      variants,
      ancestorSeed ^ LEVEL2_SEED_OFFSET,
    );
  }

  // Combine and filter to current tile bbox
  const allCandidates = level1.concat(level2);

  // At z15 the current bbox IS the ancestor bbox, no filtering needed
  if (z === ANCHOR_ZOOM) {
    return allCandidates;
  }

  return allCandidates.filter((p) => pointInBBox(p, currentBBox));
}

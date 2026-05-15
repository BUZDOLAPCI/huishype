export interface DuckScatterPoint {
  lon: number;
  lat: number;
  variant: number;
}

export interface DuckBBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Base density candidates generated at every zoom >= 15 */
export const DUCK_CANDIDATES_LEVEL1 = 24;
/** Additional density candidates generated at zoom >= 16 */
export const DUCK_CANDIDATES_LEVEL2 = 48;
/** Number of duck sprite variants exposed as duck-0 through duck-15 */
export const DUCK_VARIANTS = 16;

/** Seed offset for Level 2 candidates (ensures different positions from Level 1) */
const LEVEL2_SEED_OFFSET = 0x51f15e;
/** Anchor zoom level — all duck positions are derived from z15 tile coordinates */
const ANCHOR_ZOOM = 15;

/**
 * Simple seeded PRNG (Mulberry32).
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
 * Hash tile coordinates to a seed.
 */
export function tileSeed(z: number, x: number, y: number): number {
  return (z * 73856093) ^ (x * 19349663) ^ (y * 83492791);
}

/**
 * Convert tile coordinates to bounding box in EPSG:4326 (WGS84).
 */
export function tileToBBox(z: number, x: number, y: number): DuckBBox {
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
 * Get ancestor tile coordinates at a given ancestor zoom level.
 */
export function getAncestorTile(
  z: number,
  x: number,
  y: number,
  ancestorZ: number
): { x: number; y: number } {
  const shift = z - ancestorZ;
  return { x: x >> shift, y: y >> shift };
}

/**
 * Scatter random points inside a bounding box. The API filters these candidates
 * against watercover polygons with PostGIS.
 */
export function scatterCandidatePoints(
  bbox: DuckBBox,
  count: number,
  variants: number,
  seed: number
): DuckScatterPoint[] {
  const rng = seededRandom(seed);
  const points: DuckScatterPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: bbox.minLon + rng() * (bbox.maxLon - bbox.minLon),
      lat: bbox.minLat + rng() * (bbox.maxLat - bbox.minLat),
      variant: Math.floor(rng() * variants),
    });
  }
  return points;
}

function pointInBBox(p: DuckScatterPoint, bbox: DuckBBox): boolean {
  return (
    p.lon >= bbox.minLon &&
    p.lon <= bbox.maxLon &&
    p.lat >= bbox.minLat &&
    p.lat <= bbox.maxLat
  );
}

/**
 * Generate duck candidate points anchored to z15 tiles for positional
 * consistency across zoom levels.
 *
 * - Level 1 (z15+): DUCK_CANDIDATES_LEVEL1 candidates — sparse base accents
 * - Level 2 (z16+): DUCK_CANDIDATES_LEVEL2 additional candidates
 */
export function generateDuckCandidates(
  z: number,
  x: number,
  y: number,
  currentBBox: DuckBBox,
  variants: number = DUCK_VARIANTS
): DuckScatterPoint[] {
  const ancestor = z === ANCHOR_ZOOM ? { x, y } : getAncestorTile(z, x, y, ANCHOR_ZOOM);
  const ancestorBBox = tileToBBox(ANCHOR_ZOOM, ancestor.x, ancestor.y);
  const ancestorSeed = tileSeed(ANCHOR_ZOOM, ancestor.x, ancestor.y);

  const level1 = scatterCandidatePoints(
    ancestorBBox,
    DUCK_CANDIDATES_LEVEL1,
    variants,
    ancestorSeed
  );

  let level2: DuckScatterPoint[] = [];
  if (z >= ANCHOR_ZOOM + 1) {
    level2 = scatterCandidatePoints(
      ancestorBBox,
      DUCK_CANDIDATES_LEVEL2,
      variants,
      ancestorSeed ^ LEVEL2_SEED_OFFSET
    );
  }

  const allCandidates = level1.concat(level2);
  if (z === ANCHOR_ZOOM) {
    return allCandidates;
  }

  return allCandidates.filter((p) => pointInBBox(p, currentBBox));
}

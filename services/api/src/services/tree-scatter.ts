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

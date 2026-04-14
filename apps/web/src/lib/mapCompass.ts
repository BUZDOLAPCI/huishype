export function normalizeMapBearing(bearing: number) {
  return Math.abs((((bearing % 360) + 540) % 360) - 180);
}

export function isMapFacingNorth(bearing: number, threshold = 1) {
  return normalizeMapBearing(bearing) < threshold;
}

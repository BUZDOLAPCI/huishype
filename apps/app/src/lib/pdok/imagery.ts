type Term = readonly [p: number, q: number, coefficient: number];

// Dutch RD New conversion polynomial terms. This matches the standard
// WGS84 -> RD approximation used for RDNAP conversions closely enough for
// PDOK framing and avoids the browser-side proj4 datum-shift drift.
const RD_X_TERMS: readonly Term[] = [
  [0, 1, 190094.945],
  [1, 1, -11832.228],
  [2, 1, -114.221],
  [0, 3, -32.391],
  [1, 0, -0.705],
  [3, 1, -2.34],
  [1, 3, -0.608],
  [0, 2, -0.008],
  [2, 3, 0.148],
];

const RD_Y_TERMS: readonly Term[] = [
  [1, 0, 309056.544],
  [0, 2, 3638.893],
  [2, 0, 73.077],
  [1, 2, -157.984],
  [3, 0, 59.788],
  [0, 1, 0.433],
  [2, 2, -6.439],
  [1, 1, -0.032],
  [0, 4, 0.092],
  [1, 4, -0.054],
];

const RD_BASE_X = 155000;
const RD_BASE_Y = 463000;
const RD_BASE_LAT = 52.1551744;
const RD_BASE_LON = 5.38720621;
const RD_DELTA_SCALE = 0.36;

function evaluateTerms(terms: readonly Term[], dLatSec: number, dLonSec: number): number {
  return terms.reduce(
    (sum, [p, q, coefficient]) => sum + coefficient * dLatSec ** p * dLonSec ** q,
    0,
  );
}

/**
 * Converts WGS84 coordinates (lat/lon) to RD New coordinates (x/y)
 * @param lat Latitude in WGS84 (EPSG:4326)
 * @param lon Longitude in WGS84 (EPSG:4326)
 * @returns [x, y] tuple in RD New coordinates (EPSG:28992)
 */
export const convertToRDNew = (lat: number, lon: number): [number, number] => {
  const dLatSec = (lat - RD_BASE_LAT) * RD_DELTA_SCALE;
  const dLonSec = (lon - RD_BASE_LON) * RD_DELTA_SCALE;

  const x = RD_BASE_X + evaluateTerms(RD_X_TERMS, dLatSec, dLonSec);
  const y = RD_BASE_Y + evaluateTerms(RD_Y_TERMS, dLatSec, dLonSec);

  return [x, y];
};

/**
 * Generates a PDOK WMS URL for aerial imagery centered on the given coordinates
 *
 * @param lat Latitude in WGS84 (EPSG:4326)
 * @param lon Longitude in WGS84 (EPSG:4326)
 * @param width Image width in pixels (default 800)
 * @param height Image height in pixels (default 600)
 * @param boxSizeMeters Size of the bounding box in meters (default 45 for ~40x40m view)
 * @returns URL string for PDOK aerial imagery
 *
 * @example
 * // Get aerial image for Dom Tower in Utrecht
 * const url = getDutchAerialSnapshotUrl(52.0907, 5.1214);
 *
 * @example
 * // Get larger area with custom dimensions
 * const url = getDutchAerialSnapshotUrl(52.0907, 5.1214, 720, 480, 60);
 */
export const getDutchAerialSnapshotUrl = (
  lat: number,
  lon: number,
  width: number = 800,
  height: number = 600,
  boxSizeMeters: number = 45
): string => {
  // Convert WGS84 to RD New
  const [x, y] = convertToRDNew(lat, lon);

  // Create bounding box centered on coordinates
  // Adjust for aspect ratio to maintain proper proportions
  const aspectRatio = width / height;
  const halfHeight = boxSizeMeters / 2;
  const halfWidth = halfHeight * aspectRatio;

  const bbox = `${x - halfWidth},${y - halfHeight},${x + halfWidth},${y + halfHeight}`;

  // Build WMS URL with proper parameters
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    layers: 'Actueel_orthoHR',
    styles: '',
    format: 'image/png',
    transparent: 'true',
    version: '1.1.1',
    width: width.toString(),
    height: height.toString(),
    srs: 'EPSG:28992',
    BBOX: bbox,
  });

  return `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?${params.toString()}`;
};

/**
 * Default export for convenience
 */
export default {
  getDutchAerialSnapshotUrl,
  convertToRDNew,
};

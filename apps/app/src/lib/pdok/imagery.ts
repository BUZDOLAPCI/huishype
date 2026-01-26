import proj4 from 'proj4';

// Define RD New projection (EPSG:28992) - Dutch national coordinate system
const RD_NEW =
  '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.387638888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +units=m +towgs84=565.2369,50.0087,465.658,-0.40685,-0.35073,1.87035,4.0812 +no_defs';

// Define WGS84 projection (EPSG:4326)
const WGS84 = 'EPSG:4326';

// Register projections with proj4
proj4.defs('EPSG:28992', RD_NEW);

/**
 * Converts WGS84 coordinates (lat/lon) to RD New coordinates (x/y)
 * @param lat Latitude in WGS84 (EPSG:4326)
 * @param lon Longitude in WGS84 (EPSG:4326)
 * @returns [x, y] tuple in RD New coordinates (EPSG:28992)
 */
export const convertToRDNew = (lat: number, lon: number): [number, number] => {
  // proj4 expects [lon, lat] order for WGS84
  const [x, y] = proj4(WGS84, 'EPSG:28992', [lon, lat]);
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

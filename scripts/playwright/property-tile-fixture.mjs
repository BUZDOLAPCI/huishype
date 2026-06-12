export const PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID =
  'playwright_property_tile_pyramid_fixture';
export const PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV =
  'PLAYWRIGHT_ALLOW_PROPERTY_TILE_PYRAMID_FIXTURE';

export const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_BOUNDS = Object.freeze({
  minLon: 3.0,
  minLat: 50.6,
  maxLon: 6.4,
  maxLat: 53.8,
});

export const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER = Object.freeze({
  lon: 5.4697,
  lat: 51.4416,
  nodeId: 'playwright:eindhoven:cluster',
  pointCount: 80,
});

export const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CENTER = Object.freeze([
  PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER.lon,
  PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER.lat,
]);

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

// Synthetic addresses shared by the explicit CI bootstrap and existing test seed.
// The northern point exercises the address integration test's bounding box.
export const PLAYWRIGHT_TEST_PROPERTIES = Object.freeze([
  Object.freeze({ id: '91000000-0000-4000-8000-000000000001', street: 'Beeldbuisring', houseNumber: 41,
    postalCode: '5651HA', city: 'Eindhoven', lon: PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER.lon,
    lat: PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER.lat, officialValuation: 385000, askingPrice: 780000 }),
  Object.freeze({ id: '91000000-0000-4000-8000-000000000002', street: 'Playwright Teststraat', houseNumber: 2,
    postalCode: '5611AA', city: 'Eindhoven', lon: 5.4700, lat: 51.4417, officialValuation: 325000, askingPrice: 450000 }),
  Object.freeze({ id: '91000000-0000-4000-8000-000000000003', street: 'Playwright Addressstraat', houseNumber: 3,
    postalCode: '5628AA', city: 'Eindhoven', lon: 5.48, lat: 51.49, officialValuation: 400000, askingPrice: 525000 }),
]);

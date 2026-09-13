export declare const PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID: string;
export declare const PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV: string;

export declare const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_BOUNDS: Readonly<{
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}>;

export declare const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER: Readonly<{
  lon: number;
  lat: number;
  nodeId: string;
  pointCount: number;
}>;

export declare const PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CENTER: readonly [number, number];

export declare const PLAYWRIGHT_TEST_PROPERTIES: readonly Readonly<{
  id: string; street: string; houseNumber: number; postalCode: string; city: string;
  lon: number; lat: number; officialValuation: number; askingPrice: number;
}>[];

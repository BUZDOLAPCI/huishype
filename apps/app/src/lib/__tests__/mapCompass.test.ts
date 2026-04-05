import { isMapFacingNorth, normalizeMapBearing } from '../mapCompass';

describe('mapCompass', () => {
  it('normalizes bearings around north symmetrically', () => {
    expect(normalizeMapBearing(0)).toBe(0);
    expect(normalizeMapBearing(360)).toBe(0);
    expect(normalizeMapBearing(-360)).toBe(0);
    expect(normalizeMapBearing(35)).toBe(35);
    expect(normalizeMapBearing(-35)).toBe(35);
    expect(normalizeMapBearing(181)).toBe(179);
  });

  it('detects when the map is effectively facing north', () => {
    expect(isMapFacingNorth(0)).toBe(true);
    expect(isMapFacingNorth(0.8)).toBe(true);
    expect(isMapFacingNorth(-0.8)).toBe(true);
    expect(isMapFacingNorth(1.2)).toBe(false);
    expect(isMapFacingNorth(-1.2)).toBe(false);
  });
});

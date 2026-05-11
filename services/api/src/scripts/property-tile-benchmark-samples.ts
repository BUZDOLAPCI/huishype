export type PropertyTileSample = {
  city: string;
  semanticGroup: 'low-zoom' | 'pyramid-edge' | 'transition' | 'detail' | 'ghost-reveal';
  z: number;
  x: number;
  y: number;
};

export const REPRESENTATIVE_HEAVY_PUBLIC_TILES: readonly PropertyTileSample[] = [
  { city: 'Amsterdam dense z13', semanticGroup: 'transition', z: 13, x: 4206, y: 2692 },
  { city: 'Utrecht dense z13', semanticGroup: 'transition', z: 13, x: 4212, y: 2702 },
  { city: 'Rotterdam dense z13', semanticGroup: 'transition', z: 13, x: 4197, y: 2708 },
  { city: 'Randstad country z8', semanticGroup: 'low-zoom', z: 8, x: 131, y: 84 },
  { city: 'Amsterdam low z9', semanticGroup: 'low-zoom', z: 9, x: 262, y: 168 },
  { city: 'Utrecht low z9', semanticGroup: 'low-zoom', z: 9, x: 263, y: 168 },
  { city: 'Rotterdam low z9', semanticGroup: 'low-zoom', z: 9, x: 262, y: 169 },
  { city: 'Eindhoven pyramid edge z10', semanticGroup: 'pyramid-edge', z: 10, x: 527, y: 340 },
  { city: 'Eindhoven transition z11', semanticGroup: 'transition', z: 11, x: 1054, y: 680 },
  { city: 'Eindhoven transition z12', semanticGroup: 'transition', z: 12, x: 2108, y: 1360 },
  { city: 'Eindhoven transition z13', semanticGroup: 'transition', z: 13, x: 4217, y: 2721 },
  { city: 'Eindhoven detail z14', semanticGroup: 'detail', z: 14, x: 8418, y: 5428 },
  { city: 'Eindhoven detail z15', semanticGroup: 'detail', z: 15, x: 16853, y: 10874 },
  { city: 'Eindhoven detail z16', semanticGroup: 'detail', z: 16, x: 33723, y: 21760 },
  { city: 'Amsterdam ghost reveal z17', semanticGroup: 'ghost-reveal', z: 17, x: 67321, y: 43076 },
  { city: 'Utrecht ghost reveal z17', semanticGroup: 'ghost-reveal', z: 17, x: 67400, y: 43241 },
  { city: 'Rotterdam ghost reveal z17', semanticGroup: 'ghost-reveal', z: 17, x: 67166, y: 43339 },
];

export function buildRepresentativePropertyTileSamples(): PropertyTileSample[] {
  const seen = new Set<string>();
  return REPRESENTATIVE_HEAVY_PUBLIC_TILES.filter((tile) => {
    const key = propertyTileCoordinateKey(tile);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((tile) => ({ ...tile }));
}

export function propertyTilePath(tile: Pick<PropertyTileSample, 'z' | 'x' | 'y'>): string {
  return `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`;
}

export function propertyTileCoordinateKey(tile: Pick<PropertyTileSample, 'z' | 'x' | 'y'>): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

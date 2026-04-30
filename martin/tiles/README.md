# Martin Tile Archives

Mount production PMTiles and MBTiles archives here read-only.

Current config expects:

- `base.pmtiles` mounted in the Martin container as `/data/tiles/base.pmtiles`

The `base` source id is intentionally stable because checked-in styles reference
`/tiles/base` TileJSON and `/tiles/base/{z}/{x}/{y}` tile templates.

The checked-in `base.pmtiles` is a tiny Martin fixture archive used only to keep
local smoke tests and readiness checks runnable from a clean checkout. Replace it
with the generated production base archive in deployments.

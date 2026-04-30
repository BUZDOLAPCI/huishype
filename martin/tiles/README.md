# Martin Tile Archives

Mount production PMTiles and MBTiles archives here read-only.

Current config expects:

- `base.pmtiles` mounted in the Martin container as `/data/tiles/base.pmtiles`

The `base` source id is intentionally stable because the Fastify gateway keeps
`/tiles/base` TileJSON and `/tiles/base/{z}/{x}/{y}` tile templates available as
a first-class Martin smoke/local fixture.

The checked-in `base.pmtiles` is a tiny Martin fixture archive used only to keep
local smoke tests and readiness checks runnable from a clean checkout. It is not
the production or visual-parity web basemap; tracked app styles use the external
OpenFreeMap/OpenMapTiles source until a real full base archive is provisioned.

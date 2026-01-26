## Local Data Resources

The full BAG Geopackage (https://service.pdok.nl/lv/bag/atom/bag.xml) is already available locally.
**Path:** `/home/caslan/dev/git_repos/hh/huishype/data_sources/bag-light.gpkg`

**NOTE:**
1. **Source of Truth:** Use this local file. Do NOT download from PDOK.
2. **Huge Complete Data:** bag-light.gpkg is 7GB, it is huge for testing

### BAG Statistics
- **Total pands (buildings):** 11,310,057
- **Total verblijfsobjecten (addresses):** 9,883,310
- **Unique pands with addresses:** 6,531,425 (~58%)
- **Pands without addresses:** ~4.8M (garages, sheds, utility buildings, etc.)

### Database Seeding

The seed script reads directly from the BAG GeoPackage and populates the PostgreSQL database.

**Quick Start (Development):**
```bash
cd services/api && pnpm run db:seed
```

By default, seeds **Eindhoven area only** (~240K properties, ~2 min) for faster development cycles.

**Full Netherlands:**
```bash
cd services/api && pnpm run db:seed -- --full
```

**Options:**
- `--full` or `--netherlands` - Seed complete Netherlands (11.3M properties)
- `--limit N` - Limit to N properties (for testing)
- `--offset N` - Start from offset N
- `--skip-demolished` - Skip properties with demolished status
- `--skip-extract` - Skip ogr2ogr extraction (use existing temp database)
- `--dry-run` - Don't insert into database

**Performance:**

| Mode | Extraction | Address Loading | Processing | Total |
|------|------------|-----------------|------------|-------|
| Eindhoven (default) | ~10 sec | ~3 min | ~50 sec | ~2 min |
| Full Netherlands | ~1 min | ~3 min | ~40 min | ~45 min |

**How it works:**
1. Uses `ogr2ogr` to extract pand centroids to a temp SQLite database
   - Eindhoven mode: Applies spatial filter (20km radius from city center)
   - Full mode: Extracts all 11.3M records (708MB temp file)
2. Loads all verblijfsobject addresses into memory for fast lookup
3. Reads centroids from temp database, transforms RD New coordinates to WGS84
4. Batch inserts into PostgreSQL with upsert semantics

**Spatial Filter (Eindhoven mode):**
- Center: Eindhoven (51.4416, 5.4697 WGS84)
- RD New bounding box: X=140000-180000, Y=363000-403000
- Radius: ~20km from city center

### Sandbox Fixture (Legacy)

For local testing without full database, a GeoJSON fixture exists:

**Path:** `fixtures/eindhoven-sandbox.geojson` (171MB, 240K pands)
**Path:** `fixtures/eindhoven-addresses.json` (36MB, 147K verblijfsobjecten)

To regenerate Eindhoven sandbox:
```bash
mkdir -p fixtures && \
ogr2ogr -f "GeoJSON" \
fixtures/eindhoven-sandbox.geojson \
/home/caslan/dev/git_repos/hh/huishype/data_sources/bag-light.gpkg \
pand \
-t_srs EPSG:4326 \
-spat 5.38 51.38 5.58 51.50 \
-spat_srs EPSG:4326
```

### Why this command?
* **`pand`**: Specifies the layer to extract (buildings/panden).
* **`-spat 5.38 51.38 5.58 51.50`**: Bounding box covering the **full Eindhoven municipality** (west to east: ~5.38-5.58, south to north: ~51.38-51.50). This includes all 240,000+ buildings in Eindhoven.
* **`-spat_srs EPSG:4326`**: Tells ogr2ogr that the `-spat` coordinates are in WGS84 (the source data is in RD New/EPSG:28992).
* **`-t_srs EPSG:4326`**: The Dutch BAG data comes in a local coordinate system (RD New). This flag forces it to standard Lat/Lon (Google Maps style) immediately.


## 3D Buildings Layer
**Use case:** Render accurate 3D volumes for every building to create the immersive "toy city" aesthetic.

### Source: 3D BAG
- **Documentation:** [https://docs.3dbag.nl/en/](https://docs.3dbag.nl/en/)
- **Local Source Files:**
  - `data_sources/3dbag_nl.gpkg.zip` (19.6 GB) (The file is compressed as Seek-Optimized ZIP, see the documentation on how to access it without decompressing)
  - `data_sources/3dbag_nl.gpkg` (111.6 GB) (unzipped file in case needed. Beware, this is a very large file.)

BRT Achtergrondkaart (OGC API)
https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1

style url:
https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1/styles?f=json


### Address Resolution

The seed script uses the BAG verblijfsobject table to resolve addresses for each pand.
- **58% of pands** have a linked verblijfsobject with a real address
- **42% of pands** get a generated fallback address (typically utility buildings, garages, sheds)

Address lookup is done in-memory using a Map for O(1) lookup performance.

### Source: PDOK Locatieserver v3
- **Key API:** `/suggest` (Autocomplete) and `/lookup` (Coordinates).
- **Usage Rule:** Use this for **all** user searches. Do not use Google Places API for Dutch addresses (Locatieserver is more accurate and free).
When a user types "Beeldbuisring 41", you need to turn that text into coordinates (Lat/Lon) to fly the camera to the right house:
https://api.pdok.nl/bzk/locatieserver/search/v3_1/ui/

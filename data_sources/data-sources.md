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
- **Pands without addresses:** ~4.8M (garages, sheds, utility buildings, etc.) - **skipped during seeding**

### Database Seeding

The seed script reads from the BAG GeoPackage and populates the PostgreSQL database with all ~6.5M properties with addresses.

**Quick Start:**
```bash
cd services/api

# Full reset: drop DB, migrate, seed properties + listings
pnpm run db:reset

# Or run steps individually:
pnpm run db:migrate          # Create/update tables
pnpm run db:seed             # Seed BAG properties (~6.5M, ~5-8 min)
pnpm run db:seed-listings    # Seed listings from mirrors (~144K, ~1.3 min)
```

**Options (db:seed):**
- `--skip-extract` — Reuse existing CSV (skip ogr2ogr extraction)
- `--limit N` — Limit properties inserted
- `--offset N` — Start from offset N
- `--skip-demolished` — Skip demolished/withdrawn properties
- `--dry-run` — Don't modify database

**Note:** Pands without addresses (garages, sheds, utility buildings ~42% of BAG) are automatically skipped.

**Performance:**

| Step | Records | Time |
|------|---------|------|
| BAG property seed | ~6.5M | ~5-8 min |
| Listing seed | ~144K listings | ~1.3 min |
| **Total db:reset** | | **~6-9 min** |

**How it works:**
1. Uses `ogr2ogr` with `-t_srs EPSG:4326` to extract pand centroids to CSV (coordinate transform happens at extraction time)
2. Loads CSV into PostgreSQL via `COPY` into a staging table
3. Performs SQL upsert: `INSERT INTO properties SELECT DISTINCT ON ... ON CONFLICT`
4. Listing seed preloads all 6.5M property addresses into memory Map for O(1) lookups, batch inserts listings + price_history

Both seeds are upsert-safe and can be re-run on a populated database.


## 3D Buildings Layer
**Use case:** Render accurate 3D volumes for every building to create the immersive "toy city" aesthetic.

### Source: 3D BAG
- **Documentation:** [https://docs.3dbag.nl/en/](https://docs.3dbag.nl/en/)
- **Local Source Files:**
  - `data_sources/3dbag_nl.gpkg.zip` (19.6 GB) (The file is compressed as Seek-Optimized ZIP, see the documentation on how to access it without decompressing)
  - `data_sources/3dbag_nl.gpkg` (~104 GB) (unzipped file in case needed. Beware, this is a very large file.)

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

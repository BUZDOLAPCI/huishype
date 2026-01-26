## Local Data Resources

The full BAG Geopackage (https://service.pdok.nl/lv/bag/atom/bag.xml) is already available locally.
**Path:** `/home/caslan/dev/git_repos/hh/huishype/data_sources/bag-light.gpkg`

**NOTE:**
1. **Source of Truth:** Use this local file. Do NOT download from PDOK.
2. **Huge Complete Data:** bag-light.gpkg is 7GB, it is huge for testing
3. **Sandbox Creation:** to generate a test fixture. Run a ogr2ogr command to create your "Eindhoven Sandbox", a slice of the full 7GB gpkg file
   
Example:

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
(Note: -spat defines the bounding box for the full Eindhoven municipality, -t_srs converts coordinates to Web-standard Lat/Lon, -spat_srs tells ogr2ogr the spatial filter is in WGS84.)

### Why this command?
* **`pand`**: Specifies the layer to extract (buildings/panden).
* **`-spat 5.38 51.38 5.58 51.50`**: Bounding box covering the **full Eindhoven municipality** (west to east: ~5.38-5.58, south to north: ~51.38-51.50). This includes all 240,000+ buildings in Eindhoven.
* **`-spat_srs EPSG:4326`**: Tells ogr2ogr that the `-spat` coordinates are in WGS84 (the source data is in RD New/EPSG:28992).
* **`-t_srs EPSG:4326`**: The Dutch BAG data comes in a local coordinate system (RD New). This flag forces it to standard Lat/Lon (Google Maps style) immediately, saving the agent from having to write complex coordinate projection math later.


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


### Local Address Resolution (verblijfsobject)
The BAG verblijfsobject table contains full address information linked to pand (building) IDs.
This allows instant local address resolution without slow API calls.

**Pre-extracted Eindhoven addresses:** `fixtures/eindhoven-addresses.json` (36MB, ~147K records)

To regenerate (takes ~2 seconds):
```bash
ogr2ogr -f GeoJSON fixtures/eindhoven-addresses.json data_sources/bag-light.gpkg \
  -sql "SELECT pand_identificatie, openbare_ruimte_naam, huisnummer, huisletter, toevoeging, postcode, woonplaats_naam FROM verblijfsobject WHERE woonplaats_naam = 'Eindhoven'"
```

**Used by:** `services/api/scripts/seed.ts` - maps pand_identificatie to verblijfsobject addresses.

**Note:** Not all pands have verblijfsobjecten (e.g., garages, sheds). These get generated fallback addresses.

### Source: PDOK Locatieserver v3
- **Key API:** `/suggest` (Autocomplete) and `/lookup` (Coordinates).
- **Usage Rule:** Use this for **all** user searches. Do not use Google Places API for Dutch addresses (Locatieserver is more accurate and free).
When a user types "Beeldbuisring 41", you need to turn that text into coordinates (Lat/Lon) to fly the camera to the right house:
https://api.pdok.nl/bzk/locatieserver/search/v3_1/ui/


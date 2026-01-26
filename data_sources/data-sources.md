## Local Data Resources

The full BAG Geopackage (https://service.pdok.nl/lv/bag/atom/bag.xml) is already available locally.
**Path:** `/home/caslan/dev/git_repos/hh/huishype/input-data/bag-light.gpkg`

**NOTE:**
1. **Source of Truth:** Use this local file. Do NOT download from PDOK.
2. **Huge Complete Data:** bag-light.gpkg is 7GB, it is huge for testing
3. **Sandbox Creation:** to generate a test fixture. Run a ogr2ogr command to create your "Eindhoven Sandbox", a slice of the full 7GB gpkg file
   
Example:

   ```bash
   mkdir -p fixtures && \
   ogr2ogr -f "GeoJSON" \
   fixtures/eindhoven-sandbox.geojson \
   /home/caslan/dev/git_repos/hh/huishype/input-data/bag-light.gpkg \
   -t_srs EPSG:4326 \
   -spat 5.46 51.43 5.49 51.45 \
   -limit 500
(Note: -spat defines the bounding box for Eindhoven Strijp-S, -t_srs converts coordinates to Web-standard Lat/Lon, and -limit keeps the file tiny.)

### Why this command? (confirm this)
* **`-spat 5.46 51.43 5.49 51.45`**: I calculated these coordinates specifically for **Eindhoven (Strijp-S area)**. This ensures the "random 500 records" are actually neighbors, which is critical for testing your map clustering and neighborhood logic.
* **`-t_srs EPSG:4326`**: The Dutch BAG data comes in a local coordinate system (RD New). This flag forces it to standard Lat/Lon (Google Maps style) immediately, saving the agent from having to write complex coordinate projection math later.
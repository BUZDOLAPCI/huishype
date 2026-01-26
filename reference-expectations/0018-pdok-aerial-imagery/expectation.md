# PDOK Aerial Imagery Integration - Reference Expectation

## Overview
We need to implement a utility that generates high-resolution aerial snapshots (luchtfoto's) from the official Dutch PDOK government portal. This will serve as the default "Hero Image" for any property that does not yet have listing photos, user-uploaded photos, or expensive Google Street View calls.

## Visual Requirements
- **Resolution:** 800x600 (Retina ready for mobile cards).
- **Content:** The image must show a top-down aerial view of the specific house coordinates.
- **Fallback:** If the API fails, the UI should handle the error gracefully (e.g., show a placeholder icon), but for this expectation, a successful 200 OK image load is required.

## Technical Requirements (Critical)

### 1. Coordinate Conversion (WGS84 → RD New)
The PDOK WMS service **does not accept** standard Lat/Lon (GPS). It requires the Dutch "Rijksdriehoek" (RD New / EPSG:28992) coordinate system.

- **Library:** Use `proj4` (and `@types/proj4`)
- **Source Projection:** EPSG:4326 (WGS84)
- **Target Projection:** EPSG:28992 (RD New)
- **Proj4 Definition:** `+proj=sterea +lat_0=52.15616055555555 +lon_0=5.387638888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +units=m +towgs84=565.2369,50.0087,465.658,-0.40685,-0.35073,1.87035,4.0812 +no_defs`

### 2. URL Construction
The function must return a valid HTTPS URL for the PDOK WMS service.
- **Base URL:** `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0`
- **Layer:** `Actueel_orthoHR` (7.5cm resolution)
- **BBOX Calculation:** Create a 40x40 meter bounding box centered on the RD coordinates (`x-20`, `y-20`, `x+20`, `y+20`).

## Implementation details

Create a new file `src/lib/pdok/imagery.ts` exporting:

```typescript
export const getDutchAerialSnapshotUrl = (lat: number, lon: number): string => { ... }

Acceptance Criteria (SUFFICIENT)
Utility Exists: src/lib/pdok/imagery.ts is created and strictly typed.
Valid URL: The function returns a URL starting with https://service.pdok.nl/....
Correct Conversion: Passing the coordinates for the Dom Tower in Utrecht (52.0907, 5.1214) results in a URL that, when opened, actually shows the Dom Tower (and not the ocean or a random field).
Console Health: No console.error regarding projection failures or invalid parameters.
E2E Test: A simple test case validates that the generated URL returns a 200 status code.
The feature works in e2e test, and no bugs are perceived
Also check for seemingly unrelated bugs to this feature that you may encounter
The implementation is similar to reference-expectations/pdok-aerial-imagery/woningstats-tegenbosch-16.png, with the marker pin

Acceptance Criteria (NEEDS_WORK)
The URL returns a 400 Bad Request (usually means BBOX or SRS is wrong).
The image is blank/white (usually means coordinates are in the ocean).
The implementation relies on Google Maps or other paid APIs.
The proj4 dependency is missing or not configured correctly.

## Possible Optimizations (can be out of scope)
- Persisting these images to R2 to prevent PDOK rate limiting at scale.


Check how woningstats does it for example for deflectiespoelstraat 33:
<div id="div_img_woning" class="d-flex justify-content-center align-items-center">
                  <img id="img_woning" class="" src="https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?&amp;service=WMS&amp;request=GetMap&amp;layers=Actueel_orthoHR&amp;styles=&amp;format=image%2Fpng&amp;transparent=true&amp;version=1.1.1&amp;width=720&amp;height=480&amp;srs=EPSG:28992&amp;BBOX=159037.799,384826.388,159082.799,384856.388" style="min-height: 160px;" onerror="load_luchtfoto(image_id=this.id, marker_id=this.nextElementSibling.id, 159060.299, 384841.388)">
                  <i id="img_woning_marker" class="bi bi-geo-alt text-light mb-4" style="position:absolute;font-size:2rem;"></i>
</div>

Full woningstats html is also saved at 'reference-expectations/pdok-aerial-imagery/woningstats-deflectiespoelstraat-33-html'
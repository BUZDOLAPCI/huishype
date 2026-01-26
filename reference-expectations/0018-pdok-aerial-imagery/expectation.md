# PDOK Aerial Imagery Integration - Reference Expectation

## Overview
We need to implement a utility that generates high-resolution aerial snapshots (luchtfoto's) from the official Dutch PDOK government portal. This will serve as the default "Hero Image" for any property that does not yet have listing photos.

**Reference Image:** See `woningstats-tegenbosch-16.jpg`. The output must match this visual style: a high-res top-down view centered on the property.

## Visual Requirements
- **Resolution:** 800x600 (Retina ready).
- **Content:** Top-down aerial view centered exactly on the house coordinates.
- **Composition:** The implementation should support overlaying a marker pin (like the reference image) to indicate the specific roof/address.

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
- **Format:** `image/jpeg` or `image/png`
- **BBOX Calculation:** Create a 40x40 meter bounding box centered on the converted RD coordinates (`x-20`, `y-20`, `x+20`, `y+20`).

## Implementation Details

**Location:** `apps/app/src/lib/pdok/imagery.ts`

```typescript
// Pure utility function
export const getDutchAerialSnapshotUrl = (lat: number, lon: number, width = 800, height = 600): string => { ... }
```

Acceptance Criteria (SUFFICIENT)
Utility Exists: apps/app/src/lib/pdok/imagery.ts created and typed.

Dependencies: proj4 installed in apps/app.
Visual Verification (The "Tegenbosch" Test):
Create an E2E test apps/app/e2e/visual/reference-0018-pdok.spec.ts.
Test Case: Use coordinates for Tegenbosch 16, Eindhoven.
Target RD Coordinates: X: 157189.018, Y: 385806.139
Render: The test must render the generated URL in an <img> tag.
Verification: The screenshot captured by the test must match woningstats-tegenbosch-16.jpg (showing the same house/roof).
Console Health: Zero console errors during execution.

Acceptance Criteria (NEEDS_WORK)
URL returns 400 Bad Request.
Image shows a generic field or ocean (projection error).
Image loads but is significantly off-center compared to the reference image.
Implementation uses Google Maps or other paid APIs.

Technical Notes
The reference coordinates for Tegenbosch 16 are 157189.018, 385806.139 (RD).
Ensure your BBOX calculation around these points yields the same view.
if needed, Install proj4 via pnpm add proj4 and pnpm add -D @types/proj4.


Check how woningstats does it for example for "deflectiespoelstraat 33" address:
<div id="div_img_woning" class="d-flex justify-content-center align-items-center">
                  <img id="img_woning" class="" src="https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?&amp;service=WMS&amp;request=GetMap&amp;layers=Actueel_orthoHR&amp;styles=&amp;format=image%2Fpng&amp;transparent=true&amp;version=1.1.1&amp;width=720&amp;height=480&amp;srs=EPSG:28992&amp;BBOX=159037.799,384826.388,159082.799,384856.388" style="min-height: 160px;" onerror="load_luchtfoto(image_id=this.id, marker_id=this.nextElementSibling.id, 159060.299, 384841.388)">
                  <i id="img_woning_marker" class="bi bi-geo-alt text-light mb-4" style="position:absolute;font-size:2rem;"></i>
</div>
# Real Address Routing & URL Resolution - Reference Expectation

## Overview
We need to replace placeholder address logic with a real, hierarchical routing system that supports deep linking. The app must handle "human-readable" URLs (SEO-style) and resolve them into precise BAG IDs (`verblijfsobject_id`) using the PDOK Locatieserver.

**Target URL Structure:** `huishype.nl/{city}/{zipcode}/{street}/{house_number}`
**Example:** `/eindhoven/5651hp/deflectiespoelstraat/16`

Reference address visual styling is at reference-expectations/real-address-routing/address-styling.png and this html snippet from huispedia (https://huispedia.nl/eindhoven/5651hp/deflectiespoelstraat/33):
<div class="md:t-hidden t-flex t-flex-row">
        <h1 class="t-grow"><font dir="auto" style="vertical-align: inherit;"><font dir="auto" style="vertical-align: inherit;">Deflection Coil Street 33
            </font></font><span class="sub-title dotoverflow"><font dir="auto" style="vertical-align: inherit;"><font dir="auto" style="vertical-align: inherit;">
                5651 HP Eindhoven            </font></font></span>
        </h1>
    </div>

## Technical Goals

### 1. Expo Router File Structure
Implement a dynamic route hierarchy in `apps/app/app/` that supports optional depth.
* **Path:** `apps/app/app/[city]/[zipcode]/[street]/[housenumber]/index.tsx` (or a `[...slug]` catch-all if preferred by the agent, provided it parses correctly).
* **Behavior:**
    * `/eindhoven/` → Renders **City View** (Heatmap of city).
    * `/eindhoven/5651hp/` → Renders **Postcode View** (Neighborhood stats).
    * `/eindhoven/5651hp/deflectiespoelstraat/16` → Renders **Property Detail View** (The specific house).

Implement a dynamic route hierarchy in apps/app/app/ that supports optional depth.

Path: apps/app/app/[...address].tsx (Catch-all route recommended for flexibility) OR nested [city]/[zipcode]/....

### 2. The Resolver Service (API)
Replace the mock `generateAddress` function with a real service that queries the **PDOK Locatieserver**.

* **API Endpoint:** `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free`
* **Logic:**
    * Take the URL params.
    * Construct a query: `q=postcode:5651HP and huisnummer:16` (or `q=Eindhoven Deflectiespoelstraat 16`).
    * **Crucial:** Filter for `type:adres`.
    * **Extract ID:** Get the `id` (which corresponds to `verblijfsobject_id` in BAG).


Replace the mock generateAddress function with a real service in src/services/address-resolver.ts that queries the PDOK Locatieserver.

API Endpoint: https://api.pdok.nl/bzk/locatieserver/search/v3_1/free

Query Parameters:

q: {postcode} {house_number} (Most accurate search)

fq: type:adres (Filter strictly for addresses)

CRITICAL: fl: id,weergavenaam,centroide_ll,huisnummer,postcode,woonplaats

centroide_ll returns WGS84 (Lat/Lon).

Warning: The default centroide_rd returns RD coordinates (Meters in X/Y format) which will crash Mapbox.

Logic:

Parse URL segments.

Call PDOK Search.

Extract id (Verblijfsobject ID) and centroide_ll.

Return standardized ResolvedAddress.

### 3. Data Model (ID per Door)
Ensure the application uses the **Verblijfsobject ID** (not the Pand ID) as the primary key for the "Property Page".
* *Note:* A "Pand" (Building) can have multiple "Verblijfsobjecten" (Apartments). The URL points to a specific door (Verblijfsobject).

## Implementation Details

Create/Update `src/services/address-resolver.ts`:

```typescript
interface ResolvedAddress {
  bagId: string; // The Verblijfsobject ID
  formattedAddress: string; // "weergavenaam"
  lat: number;
  lon: number;
  details: {
    city: string;
    zip: string;
    street: string;
    number: string;
  }
}

// Should handle partials (just city) and full addresses
export const resolveUrlParams = async (params: UrlParams): Promise<ResolvedAddress | null> => {
  // Implementation using PDOK Locatieserver
}



Visual Requirements (The Test)
Deep Link Test: Opening the app with huishype://eindhoven/5651hp/deflectiespoelstraat/16 (or the web URL) should navigate directly to the Property Page.

Title Update: The page title/header should display "Deflectiespoelstraat 16" (real data), NOT "BAG Pand 0772...".

Acceptance Criteria (SUFFICIENT)
File Structure: Expo Router files created for the nested routes.
Resolution Success: The example address Deflectiespoelstraat 16 resolves to a valid coordinate and BAG ID via the service.
Fallback: If the address doesn't exist (e.g., /eindhoven/9999xx/fake/1), show a graceful 404/Search screen.
Types: Strict TypeScript interfaces for the PDOK API response.
Console Health: Zero errors during navigation.
Navigation Flow: A test verifies that simulated map interaction (tapping a node) navigates to the correct URL structure.
e2e test that Checks nodes from map and traverses their preview and detail pages to make sure they are showing correct addresses, and the URL routing with addresses work.
Check against the reference address styling at reference-expectations/real-address-routing/address-styling.png
Mocked Tests: The E2E test uses MSW to mock the PDOK API response. Do not hit the real PDOK API in tests.
View Differentiation: Navigation to /eindhoven/ renders the "City View" placeholder, not a broken Property Page.

Acceptance Criteria (NEEDS_WORK)
Uses placeholder logic.
Hardcodes the address data.
Downloads a massive CSV file instead of using the API.
Fails to distinguish between City View and Property View.
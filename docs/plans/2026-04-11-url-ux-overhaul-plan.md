# URL UX Overhaul

## Summary
Implement a canonical URL contract across web and native routing, with web map URL sync behaving like Google Maps and property pages behaving like Huispedia. Netherlands routes stay prefixless; non-NL routes use a leading country-code segment.

Canonical route set:
- `/` = map root
- `/@{lat},{lng},{zoom}z` = web map camera state with no selected property
- `/{city}` = NL map focused on that city
- `/{city}/{postcode}` = NL map focused on that postcode area
- `/{city}/{postcode}/{street}/{house}` = NL full property page
- `/map/{city}/{postcode}/{street}/{house}` = NL map with that property preview card open
- `/{city}/{postcode}/{street}/{house}/comments` = NL comments page
- `/{city}/{postcode}/{street}/{house}/guesses` = NL guesses page
- `/{countryCode}/{city}` = non-NL map focused on that city
- `/{countryCode}/{city}/{postcode}` = non-NL map focused on that postcode area
- `/{countryCode}/{city}/{postcode}/{street}/{house}` = non-NL full property page
- `/map/{countryCode}/{city}/{postcode}/{street}/{house}` = non-NL map with that property preview card open
- `/{countryCode}/{city}/{postcode}/{street}/{house}/comments` = non-NL comments page
- `/{countryCode}/{city}/{postcode}/{street}/{house}/guesses` = non-NL guesses page
- `/map` = immediate redirect to `/`

Failure handling:
- Any invalid, unresolvable, or ambiguous address-style URL replaces to `/`
- No error page is shown for bad address URLs
- Existing ID routes are not preserved

## Key Changes
### 1. Canonical URL model and helpers
Create a shared URL utility layer that becomes the only source of truth for building/parsing map and property URLs.
- Add slug builders for country, city, postcode, street, and house segments.
- Add camera path serializer/parser for `@lat,lng,zoomz`.
- Add canonical href builders for property detail, map preview, comments, and guesses.
- Add a safe internal `returnTo` normalizer that accepts only app-internal paths we generate.

Country path rules:
- NL routes are prefixless.
- Non-NL routes must prepend a lowercase ISO alpha-2 country segment such as `de`, `fr`, `gb`.
- Parsing must treat a leading supported country segment as part of the canonical address contract, not as a city slug.

Slug rules:
- City and street: lowercase, diacritics removed, punctuation collapsed to `-`, repeated `-` collapsed, trimmed.
- Postcode: normalized with the country config, spaces and separators removed for path form unless a country requires a stable separator later; lowercase in path.
- House segment: `{houseNumber}` or `{houseNumber}-{addition}`, lowercase, non-alphanumeric separators collapsed to `-`.
- Serialize camera as `@{lat},{lng},{zoom}z` using fixed precision suitable for sharing:
  `lat/lng` 7 decimals, `zoom` 2 decimals, then trim trailing zeros.

### 2. Route tree overhaul
Replace the current catch-all redirect screen with explicit canonical route wrappers.
- Root address routes handle 1 segment as city-map, 2 segments as postcode-map, and 4 segments as property-detail.
- Add explicit nested comments and guesses routes under the canonical property path.
- Add `/map/...` canonical routes for map-preview state.
- Remove placeholder city/postcode surfaces; city and postcode routes now open the actual map centered on that area.
- Keep static routes like `/feed`, `/saved`, `/profile`, `/notifications`, `/leaderboard`, `/auth`, `/user` unchanged.

Resolution behavior:
- City route: geocode the city and initialize map there, assuming NL when no country prefix is present.
- City+postcode route: geocode postcode+city and initialize map there, assuming NL when no country prefix is present.
- Full property route: resolve segments to a property id, then render the existing property experience.
- `/map/{address}`: resolve property id, initialize the map as if the user searched and selected that property.

### 3. Map URL state on web
Add a dedicated map URL sync layer to the web map screen.
- On initial load, parse `/@...`, `/{city}`, `/{city}/{postcode}`, and `/map/{address}` to boot the correct map state.
- While browsing with no selected preview card, update the URL on `moveend` only.
- Use `router.replace` for passive map-state URL changes so panning/zooming does not flood history.
- When a preview card opens, replace the current camera URL with `/map/{address}`.
- Keep `/map/{address}` while the preview card and its peek/expanded sheet state are active.
- When the preview is closed or dismissed, replace back to the latest coordinate URL for the current map camera.
- Shared `/map/{address}` links restore the existing property-centered preview behavior, not an exact historical camera.

### 4. Property/comments/guesses navigation contract
Move route pages away from raw `router.back()` defaults.
- Property page default close/back target becomes `/map/{address}`.
- Comments and guesses default close/back target becomes `/{address}`.
- Existing non-map entry points like feed, saved, profile, notifications, and leaderboard keep working by passing an explicit `returnTo` query to the canonical address URL.
- Responsive panel close behavior on web must use the resolved explicit target, not browser-history luck.

### 5. Types and reuse
Align app types and helpers with what the API already returns.
- Update app property typings to include `street`, `houseNumber`, `houseNumberAddition`, and other already-returned fields needed to build canonical URLs.
- Replace the current id-based property-route helper with canonical-address href builders.
- Route builders must derive whether to emit a country prefix from `countryCode`, omitting it only for `NL`.
- Reuse the current property detail/comments/guesses UI components after route resolution so the UI logic stays centralized.

## Test Plan
Add and update coverage for the new contract.
- Unit: camera path parse/serialize, NL slug normalization, canonical href builders, safe `returnTo` normalization.
- App/unit: route-resolution hooks for city, postcode, property, and map-preview states; property/comments/guesses back-target logic.
- Web E2E:
  `pnpm test:e2e:integration` for direct loads of `/@...`, `/{address}`, `/map/{address}`, `/comments`, `/guesses`
  `pnpm test:e2e:flows` for map browsing URL updates on `moveend`, preview-open URL swap, preview-close return to coordinate URL, `/map` redirect, bad address redirect to `/`
- Mobile coverage if shared linking is touched:
  add at least one smoke path for canonical property deep-link resolution and back behavior, then run `pnpm test:e2e:mobile`
- Full verification gate before merge:
  `pnpm test`

## Important Interface Changes
- Frontend route builders change from id-based URLs to canonical address URLs.
- Canonical address URLs are now country-aware: NL omits the country prefix, non-NL includes it.
- `returnTo` handling expands from tab-only enum behavior to validated app-internal path behavior.
- No backend API contract change is required if the app uses existing property fields already returned by `/properties` and `/properties/:id`.

## Assumptions And Defaults
- NL remains prefixless for cleaner primary-market URLs.
- Non-NL addresses use a leading country-code segment to avoid cross-country collisions.
- City/postcode address URLs are map-state URLs, not standalone content pages.
- Invalid or unresolvable address-style paths silently replace to `/`.
- `/property/:id`, `/comments/:id`, and `/guesses/:id` are removed rather than redirected.
- Web map URL syncing uses `replace`, not `push`.
- Property page, comments page, and guesses page still accept explicit `returnTo` overrides for non-map callers.

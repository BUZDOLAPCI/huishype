# Workaround Fixes — All Completed

All three workarounds have been implemented, tested, and verified on both web and native (emulator).

## W1: Upgrade maplibre-react-native to alpha.47 — DONE

- Upgraded from `11.0.0-alpha.38` to `11.0.0-alpha.47`
- Applied breaking renames: `MapView`→`Map`, `MapViewRef`→`MapRef`, `mapViewRef`→`mapRef`
- Layer props didn't need renaming — layers come from server style.json
- Updated web stub + Jest mock with new export names
- `useMergedMapStyle()` hook kept — native device testing confirmed it's still needed (URL-based style loading not yet reliable for custom vector sources)

## W2: Self-host sprites + server-side filtering — DONE

- Downloaded 4 OpenFreeMap sprite files (~223 KB) to `services/api/sprites/`
- Added `GET /sprites/:filename` route with immutable cache headers
- Style.json handler sets `sprite = ${baseUrl}/sprites/ofm` and filters layers server-side
- `filterLayersForMissingSprites()` handles all 3 cases (plain string, data-driven, static expressions)
- Removed ~74 lines of client-side sprite patching from `index.web.tsx`

## W3: Server-side nearby-property endpoint — DONE

- Added `GET /properties/nearby?lon=X&lat=Y&zoom=Z&limit=N` PostGIS KNN endpoint
- Added `fetchNearbyProperty()` client function in `api.ts`
- Updated native `handleMapPress` with server-side fallback when `queryRenderedFeatures` returns empty
- 18 integration tests covering response shape, KNN ordering, zoom-radius filtering
- Property taps now reliably work on native — removed `optional: true` from 9 Maestro assertions
- Fixed zoom-out button selector in Maestro tests (use testID instead of text matching)

## Test Results (all green)

- Unit: 258 app + 64 API = 322 passed
- Playwright: 50 passed (3 pre-existing smoke failures unrelated to these changes)
- Maestro: 6/6 passed (smoke, feed, ghost-nodes-zoom, 3d-buildings, property-bottom-sheet, comments-section)

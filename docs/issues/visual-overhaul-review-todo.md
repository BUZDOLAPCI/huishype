# Visual Overhaul Review TODO

Review date: 2026-03-22

Context:
- Reviewed current branch against `docs/superpowers/specs/2026-03-21-visual-overhaul-sprint-plan.md`
- Cross-checked against `docs/visual-references/design-overhaul/huishype-visual-overhaul.pen`
- This document captures follow-up work from the branch review

## Blocking Gaps

### 1. Final visual sign-off package is missing

The sprint plan requires per-surface artifacts under:
- `test-results/visual-overhaul/<surface>/web/*.png`
- `test-results/visual-overhaul/<surface>/android/*.png`
- `test-results/visual-overhaul/<surface>/notes.md`

Current state:
- `apps/app/e2e/visual/helpers/screenshot-harness.ts` defines this convention
- `test-results/visual-overhaul/` is empty
- visual outputs still land in legacy paths like `test-results/reference-expectations/...`
- native screenshots still land in `maestro-screenshots/...`
- no persisted `SUFFICIENT` / `NEEDS_WORK` verdict trail was found

TODO:
- migrate final acceptance capture to `test-results/visual-overhaul/...`
- add per-surface `notes.md` review records
- ensure all 15 pen acceptance targets have web + Android evidence
- make final sign-off auditable instead of split across legacy directories

### 2. Acceptance coverage does not map cleanly to all 15 pen targets

Missing or incomplete final-target coverage was found for:
- Search Results
- Saved Screen
- Profile Screen
- Social Notifications
- Community Leaderboard
- Property Detail — Full Scroll Content
- Price Guesses Page
- Comments Page

Current issue:
- existing visual tests mostly target older reference-expectations instead of the final sprint acceptance target list

TODO:
- add or rename final-vision acceptance specs so they map 1:1 to the 15 pen targets
- capture both phone-sized and carry-over wide/landscape artifacts where required by the plan

### 3. OpenAPI / generated client / mocks are out of sync with the live backend

Backend routes were added for:
- notifications
- leaderboard
- activity
- achievements
- email auth

But review found:
- exported `services/api/openapi.json` does not reflect that full surface
- `packages/api-client/generated/api.ts` is stale relative to live routes
- `packages/mocks` does not provide handler coverage for the new surface

TODO:
- regenerate `services/api/openapi.json` from the live app
- regenerate `packages/api-client/generated/api.ts`
- update `packages/mocks` handlers for the new routes
- strengthen tests so this drift is caught automatically

### 4. Multi-country address resolution is still effectively NL-defaulted

Current problem:
- frontend address resolution flow does not carry `countryCode`
- `resolveProperty(...)` is called without country context
- backend resolve endpoint defaults missing `countryCode` to `NL`

Impact:
- non-NL search results and deep links can resolve against the wrong country
- canonical `/property/[id]` routing can fail outside NL

TODO:
- thread `countryCode` through geocoder result shaping, search selection, and catch-all route resolution
- keep canonical property routing country-aware

### 5. Leaderboard featured property card is not implemented

Current state:
- leaderboard screen renders section label only
- actual featured-property card from the design is missing

TODO:
- implement the featured property card UI on `apps/app/app/leaderboard.tsx`
- verify against the leaderboard pen target

## Important Non-Blocking Corrections

### 6. Root verification script still omits mobile from `test:all`

Current state:
- `test:e2e:mobile` exists
- `test:all` still runs only unit + integration + web

TODO:
- update root verification so `test:all` includes mobile coverage when the team is ready to make that path mandatory

### 7. Visual tests still contain stale feed assumptions

Current issue:
- at least one visual test still checks for `All` and `New`
- final design uses `Trending`, `Latest`, `Recent Activity`

TODO:
- update legacy visual tests to the final feed contract
- remove obsolete assertions and screenshots

### 8. Profile accuracy metric is fake

Current implementation:
- `ACCURACY` is derived from `guessCount / commentCount`

TODO:
- either compute a real accuracy metric from backend-supported data
- or remove/hide the metric until the backend definition exists

### 9. Map header city is hardcoded

Current state:
- map header shows `Eindhoven` on web and native

TODO:
- make header location dynamic from current viewport / search context / selected location

### 10. Preview cards are missing some engagement data wiring

Current state:
- preview card UI supports like/comment pills
- map interaction conversion drops or fails to populate some engagement counts

TODO:
- ensure preview-card data includes the counts needed by the design
- verify both single-property and cluster-preview paths

### 11. Comments route has landscape panel parity issues

Current state:
- `ResponsivePanel` provides landscape panel chrome
- comments route also renders its own header inside the panel
- guesses route already handles this better

TODO:
- make comments/guesses route behavior consistent in wide/landscape panel mode

## Auth Operational Follow-Up

Auth should be treated as implementation-complete at the code/foundation level, with expected operational non-functionality until real provider configuration is supplied.

Accepted for now:
- provider keys / credentials are not configured yet
- email delivery provider is not configured yet
- flows may fail in real environments until those external prerequisites exist

Required follow-up:
- keep explicit TODOs in code where provider-side setup is still required
- once Apple keys / mail provider are available, complete operational hookup and remove any remaining placeholder behavior tied to missing provider setup

Note:
- missing external provider configuration should not be treated as a blocker in this doc by itself
- code-level incompleteness should still be tracked when it exists

## Verification Quality Follow-Up

`pnpm test:unit` passed during review, but the run still showed quality issues:
- repeated `act(...)` warnings around `AuthModal`
- API Jest worker leak / forced exit warning

TODO:
- clean up async test behavior around `AuthModal`
- fix leaking timers/handles in API tests so the verification pipeline is actually clean

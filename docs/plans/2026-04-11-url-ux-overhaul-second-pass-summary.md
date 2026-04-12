# URL UX Overhaul Second-Pass Summary

This note is for review context. It intentionally avoids repeating code-visible facts such as file lists, exact helper names, or obvious route additions/removals. It focuses on the parts that are difficult to infer from the diff alone: root causes, rationale, contract choices, and verification outcomes.

## What This Second Pass Was Actually Fixing

The first sprint largely implemented the canonical URL contract from the plan, but a few non-obvious integration issues remained:

- Native tab state could still hijack static routes like `/feed` because the map tab remained mounted offscreen and continued treating the current pathname as map-owned state.
- Feed navigation had drifted toward an unnecessary property-by-id refetch even when the card already had enough address data to construct the canonical route directly.
- Dev-client deep links wrapped by Expo were being skipped in one path even though the shared URL parser already knew how to unwrap them.
- A few tests had gone stale around the intended back/return contract and around current `PropertyDetails` typing.

None of those were plan changes. They were correctness gaps in the first implementation pass.

## Non-Obvious Root Causes

### 1. Why `/feed` could bounce back to the map on native

The problem was not in the feed screen itself. The root cause was the native map tab screen staying mounted while inactive and continuing to run route-sync logic. Because static routes like `/feed` are path-shaped strings just like canonical map paths, the map tab was incorrectly willing to "manage" them.

The important fix was to make native map-route ownership explicit: canonical map routes are managed, known static app routes are not. Without that distinction, any future static route can regress in the same way.

### 2. Why feed cards should not refetch property details in the normal case

For standard property feed cards, the canonical route should be derived from existing feed payload data. Refetching by id on tap was a workaround that masked canonical-route extraction bugs and added unnecessary latency and extra failure modes.

The remaining by-id fetch path is intentional only for activity-style entries that still do not reliably carry enough address fields to build the canonical route locally. That fetch now exists as a data-shape bridge, not as the default navigation model.

### 3. Why address parsing needed to change

One real bug surfaced from live feed data: addresses in the shape `Street 41, 5651HA City` were not being parsed into canonical route input correctly. The extraction logic was too trusting of the full display string and needed to discard the comma-delimited locality tail before matching the street and house segment.

That bug matters because it silently pushes route-building toward heavier id-based fallbacks, which is the opposite of the plan's intended architecture.

### 4. Why Expo dev-client URLs had to be handled in the shared parser path

During local native verification, deep links often arrive wrapped in Expo dev-client URLs rather than as bare app URLs. We already had a shared parser that unwraps those URLs correctly. One route-sync path was bypassing that shared parser and treating wrapped URLs as ignorable noise.

The correction was architectural, not cosmetic: all deep-link entry points should use the same parser so that dev, test, and production paths resolve through the same contract.

### 5. Why the top-level `/feed`, `/saved`, and `/profile` shim routes were removed

Those shims were extra hops, not compatibility layers. The tab-group route tree already owns those URLs. Keeping the shims makes routing harder to reason about and increases the chance of duplicate logic or inconsistent history behavior.

Removing them was a simplification, not a behavior change.

## Back/Return Contract Clarifications

Some test updates may look like behavior changes if reviewed without the plan in mind. They are not.

- Property pages default back to the canonical map-preview route for that address when there is no explicit caller override.
- Comments and guesses default back to the canonical property route for that address when there is no explicit caller override.
- When a caller passes an explicit `returnTo`, that explicit target wins over generic dismiss/back behavior on both web and native.

The important review point is that these pages now follow a route contract, not browser-history luck and not generic `router.back()` defaults.

## Why Certain Tests Changed

Several tests were updated not because the implementation weakened, but because the old expectations were no longer aligned with the actual URL contract:

- Some route tests still expected generic dismiss/back behavior where the planned contract requires a concrete canonical target.
- One placeholder-property visual test fixture used `null` where the current app type now models the field as optional/undefined.
- A few test helpers and mocks needed cleanup so the stricter canonical-route coverage would typecheck cleanly.

In other words, these test edits were mostly contract alignment and stale-fixture cleanup, not feature churn.

## Mobile E2E Harness Note

The mobile URL work exposed a startup timing issue in the Maestro wrapper flow. The main symptom was intermittent gRPC connection refusal during app/bootstrap handoff, especially right after reinstall/launch.

The fix was to add small settle delays around device readiness and before Maestro attempts. This is not product behavior; it is harness hardening needed to make the canonical deep-link smoke path reliable enough to trust as a gate.

One review-relevant caveat: detached `pnpm test:e2e:mobile` runs can report misleading outer-shell exit signals while the underlying Node harness is still running. Because of that, the decisive verification for this sprint was the underlying mobile harness command itself completing successfully, not the detached wrapper's transient shell status.

## Verification Outcome

The second pass was validated at three levels:

- Targeted unit/app tests for canonical route building, deep-link parsing, tab behavior, and back-target logic.
- Native mobile deep-link and feed-path validation through the mobile harness after the static-route guard and startup-settle fixes.
- Full repo gate with `pnpm test`.

The key point for review is that the final state is not just "tests adjusted to pass". The non-obvious regressions found during review were exercised directly and then verified again in the full gate.

## Practical Review Guidance

If you are reviewing the diff and something looks surprising, the high-value questions to ask are:

- Does this change move navigation toward canonical address routes rather than id-based fallbacks?
- Does it make route ownership more explicit between static app routes and map-managed routes?
- Does it replace implicit history behavior with deterministic route targets?
- Does it reduce duplicate routing surfaces rather than adding another layer?

That is the lens that drove the second-pass edits.

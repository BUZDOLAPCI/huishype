# URL Overhaul Review Summary

This note is for review context. It intentionally avoids walking the diff file by file. The goal is to explain the design intent behind the URL overhaul, the bugs it was built to prevent, and the contract decisions that are not obvious from the code alone.

## What This Branch Is Really Changing

The branch finishes the move from id-oriented navigation to a canonical address-based URL contract. That contract is now the primary routing surface for the app, across web and native, rather than a thin layer over legacy detail screens.

The important shift is not just “new routes exist.” It is that URLs now represent user-visible address state and map state in a way that is stable, shareable, and country-aware. NL remains prefixless for cleaner primary-market links, while non-NL routes carry an explicit country segment so the same address shape cannot collide across markets.

That contract also extends to the map experience itself. The web map is no longer just a view that happens to update the address bar; it now preserves a deliberate distinction between passive camera state, selected-property preview state, and full property detail state. That is the core reason the overhaul needed both route changes and map-state synchronization changes.

## Why The Architecture Changed

The first non-obvious problem was that the old id-based surfaces were too permissive. They made it easy for callers to navigate somewhere “close enough” without actually expressing which canonical state they meant. That is why the branch removes the legacy id routes instead of keeping them around as compatibility paths: preserving them would have left two overlapping contracts in circulation and made future regressions likely.

The second problem was history and return behavior. Several screens had previously depended on implicit browser history or generic back navigation. That is fragile in a multi-entry app where the same property can be opened from feed, saved, profile, notifications, search, or direct links. The branch replaces that with explicit, validated internal return targets so the same destination can close back to the correct canonical URL regardless of where navigation started.

The third problem was route ownership. Static app routes and map-managed routes had to be separated cleanly. If the map layer treats every path-shaped URL as something it owns, static sections can be hijacked by route sync logic. If it is too conservative, deep links and preview states stop restoring correctly. The branch’s routing work is mostly about making that ownership boundary explicit and deterministic.

## What Bugs This Was Preventing

The changes are aimed at a few real failure modes:

- Preview cards could temporarily rewrite the URL, but not reliably preserve the intended preview state or return to the correct camera state after dismissal.
- Address-based navigation could fall back to brittle id lookups even when the source data already contained enough information to build the canonical route directly.
- Shared links and deep links could resolve inconsistently depending on whether they arrived through the normal app parser, the web path, or an Expo-wrapped dev-client URL.
- Non-NL addresses needed the country prefix baked into the contract, otherwise the same street/postcode shape could be ambiguous across markets.
- The old route model made it too easy for tests and callers to encode “close/back” behavior as an accident of navigation history instead of an explicit URL target.

One subtle but important part of the branch is that it prefers preserving user intent over preserving exact historical camera state. Shared `/map/...` links restore the property-centered preview experience, not a pixel-perfect reimplementation of the author’s last viewport. That is deliberate: the preview URL should be a stable entry point, not a brittle snapshot.

## Why The Test Changes Matter

The test updates are not just cleanup. They are the proof that the intended contract is now explicit enough to exercise directly.

Route and navigation tests now encode the canonical URL behavior instead of generic back-button behavior. That matters because it catches regressions where a screen still “works” visually but returns to the wrong place when dismissed.

The integration and flow coverage also matters because the main risk in this work is not isolated parsing logic; it is contract drift between parser, route builder, map sync, and preview state. The broader test coverage is there to keep those pieces aligned.

## Review Caveats

The branch intentionally does not treat invalid or unresolvable address-style URLs as special error states. They are replaced to `/` instead. That keeps the product behavior consistent with a map-first app: bad URLs should collapse back to the main experience rather than surface a dead-end page.

The other review-relevant caveat is that not every route still needs to be resolved the same way. Canonical direct links, preview state, and explicit return targets are different concerns now, and the implementation separates them on purpose. If any of that looks redundant at first glance, it is usually because the code is preserving distinct user journeys rather than one generic navigation path.

## Bottom Line

This branch is not just a routing refactor. It is a contract rewrite that makes the URL the source of truth for address identity, country scope, and map/detail/preview state. The main value is lower ambiguity: fewer id-based fallbacks, fewer history-dependent dismissals, and fewer hidden assumptions about whether a route is map-owned or static.

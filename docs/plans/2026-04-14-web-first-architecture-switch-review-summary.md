# 2026-04-14 Web-First Architecture Switch Review Summary

This document is a reviewer-facing summary of the web-first architecture switch
on `dev/platform-split` (`ae23d65`, `switch to web-first platform split`).

It is not meant to restate the diff file-by-file. The reviewer already has the
codebase and the full patch. The goal here is to capture the architectural
intent, the boundaries that changed in practice, and the reasoning that is easy
to miss when reading a very large rename-plus-runtime diff.

## What This Change Actually Does

This branch turns the frontend from an Expo-era shared app into a web-first
product with explicit future-native handoff surfaces.

The important part is not the rename from `apps/app` to `apps/web` by itself.
The important part is that the repo stops pretending there is one active
cross-platform frontend runtime. After this change:

- the browser client is the only active product surface
- the active web stack is Vite + React Router + React 19 + web Testing Library
- Expo / React Native / React Native Web / Metro / Maestro are removed from the
  active product path
- Android and iOS stop existing as half-maintained implementations and become
  explicit future-native handoff docs only

That means a large part of the diff is intentional deletion rather than
migration churn. The branch removes compatibility burden that only existed to
preserve the old shared-runtime story.

## Main Architectural Decisions

## 1. Web is now the canonical product implementation

This branch treats the web app as the real product, not as one renderer of a
shared UI system.

The practical effect is that browser concerns now own their own implementation:

- browser routing is web-native
- browser styling is web-native
- browser interaction code is allowed to be browser-specific
- browser testing is allowed to target actual browser behavior directly

The shared boundary was tightened around things that are genuinely portable:

- API contracts
- domain types
- formatting and validation rules
- country configuration
- analytics/schema-style contracts

The intended long-term model is one product with three clients, not one UI
runtime shared across all clients.

## 2. Native was decommissioned as an active surface, not preserved in place

The branch does not try to keep the Expo/native path "almost working."

That was deliberate. Keeping generated native projects, mobile E2E, Expo
tooling, and mobile-specific runtime shims would have left the repo in a
contradictory state where web was supposedly primary but still constrained by
mobile parity scaffolding. The branch instead makes the repo honest:

- `apps/web` is current
- `apps/android/README.md` and `apps/ios/README.md` are future handoff docs
- there is no active mobile release/tooling path in daily development

This is why the diff includes many deletions that may look abrupt when viewed
locally. They are the architectural cut, not incidental cleanup.

## 3. Browser auth is cookie-session first; bearer tokens still exist, but on a separate path

One of the more subtle changes is the auth contract split.

Before the switch, the browser path behaved like a token client and relied on
browser-readable token storage. After the switch, the browser path is the usual
HTTP-only cookie-backed session model.

The non-obvious part is that token endpoints were not removed entirely. That is
intentional, not incomplete cleanup.

The branch separates two use cases:

- browser login / refresh / session state use cookie-backed browser auth
- explicit token consumers use `/auth/token/*`

The reasoning is:

- the browser should no longer behave like a generic bearer-token client
- backend and non-browser consumers still need a clean explicit token surface
- keeping token support on separate endpoints avoids dragging browser storage
  concerns back into the web app

Reviewers should read `/auth/google`, `/auth/apple`, `/auth/logout`, and
`/auth/session` as the browser contract, and `/auth/token/google`,
`/auth/token/apple`, and `/auth/token/refresh` as the non-browser/token
contract.

The later flow-spec updates in this sprint were mostly about aligning tests to
that split after the larger migration had already landed.

## 4. Shared packages were kept as contract layers, not promoted into a new UI abstraction

The branch keeps `packages/shared` and `packages/api-client`, but it does not
replace Expo-era sharing with a new homegrown cross-platform UI layer.

That distinction matters. The goal was not "still share as much frontend as
possible, just with different tools." The goal was to preserve only the parts
that should survive future Kotlin/Swift ports:

- validation
- formatting
- country-specific behavior
- generated backend contract surfaces
- map/data contract metadata

If something mainly existed to smooth over renderer differences, the branch
leans toward deleting it instead of re-implementing it in another wrapper.

## What Changed In Practice

## Web runtime and repo shape

At the repo level, the branch makes the operating model obvious:

- `apps/app` is removed
- `apps/web` is the active frontend package
- root scripts and package filters now treat `@huishype/web` as the main
  frontend target
- CI and local commands pivot to the browser workflow

This matters because a large amount of the migration value comes from making
the right path the default path. It is not just a runtime rewrite hidden behind
old package names and old scripts.

## Testing and verification model

The branch also resets what "done" means for the frontend:

- unit/component tests are browser-oriented
- Playwright is the active E2E gate
- the old mobile/Maestro expectations are removed from the active repo path

This is more than a test-tool swap. It changes what kinds of regressions the
repo is optimized to catch. The active checks now validate the real product
surface instead of a mixed web/native abstraction layer.

## Documentation and source-of-truth alignment

The docs changes are part of the implementation, not commentary around it.

Before the switch, the repo had contradictory guidance: web was effectively the
main surface, but many docs, scripts, and test assumptions still described an
Expo/native-first world. This branch resolves that contradiction by aligning:

- architecture docs
- test requirements
- root workflow docs
- web workflow docs
- deployment/env guidance

Without that alignment, the codebase would still behave like it had one active
product model while the surrounding repo told contributors to develop and test a
different one.

## Late-cycle fixes that closed the sprint

The branch already contained the main migration. The work needed at the end of
the sprint was mostly about bringing runtime behavior and test expectations into
full agreement with the new architecture.

The last set of fixes was concentrated in three places:

- auth/session flow expectations
- map/search/preview interaction expectations
- Playwright wrapper reliability

These changes are easy to misread as "test-only" work. They were not.

They mattered because some specs were still asserting Expo-era or token-era
behavior after the runtime had intentionally moved on. Updating those tests was
part of finishing the migration contract, not loosening verification.

### Auth/session alignment

The key correction was making tests and helpers distinguish browser session auth
from explicit token auth.

That means:

- browser login assertions now validate cookie-backed session state
- refresh behavior is tested against the token-refresh route only when the test
  is explicitly acting as a token client
- logout/session checks validate cookie clearing rather than stale token
  assumptions

This is important context for review because otherwise some auth-spec edits can
look like route churn rather than contract clarification.

### Map/search/preview alignment

The other major late-cycle area was map interaction behavior.

Some Playwright flows were still encoding the old assumptions that:

- search should primarily manipulate map state and leave search UI expectations
  from the older flow
- preview dismissal/reopen behavior followed older interaction sequencing
- control visibility and interaction assertions should mirror the prior runtime

The migrated web app is more direct:

- exact property search is allowed to route straight into property detail
- preview and sheet behavior are driven by the current web interaction model,
  not by preserving older cross-platform sequencing
- map control assertions need to reflect the current browser surface, not the
  old abstraction

The small runtime fixes in the preview portal and map interaction hook were
made to support that current model cleanly, not to retain compatibility with
the legacy one.

### Playwright wrapper reliability

The runner fix was small in code size but worth noting in review because it
affects trust in the suite. The interrupted-run exit handling could produce
invalid status behavior. Fixing that closes a tooling hole that would otherwise
make long browser runs less dependable during active review and iteration.

## What Reviewers Should Not Misread

## 1. The branch is intentionally opinionated against compatibility layers

If some deleted abstraction appears reusable in isolation, that is not enough
reason to preserve it. The branch repeatedly chooses direct browser
implementation over keeping wrappers whose main value was old cross-platform
portability.

## 2. Token auth still existing does not mean the browser is still token-based

The browser path moved to cookie-backed sessions. Token auth remains as an
explicit separate contract for non-browser use cases. That separation is the
point.

## 3. Test updates are part of the architecture switch

Several test changes are really contract changes. They encode the new behavior
of the product after the web-first cutover, especially around auth, search
navigation, preview handling, and control visibility.

## 4. The size of the diff is dominated by deletion and relocation

A large portion of review noise comes from removing Expo/RN-era files and
renaming the active client surface. The architectural signal is in the new
runtime boundaries, not in the raw count of moved files.

## Suggested Review Order

If the diff feels too large to read linearly, the highest-signal order is:

1. Read the architecture and workflow docs that define the new operating model.
2. Review the package/runtime cutover to `apps/web` and the root script/CI
   changes.
3. Review the auth split between browser sessions and `/auth/token/*`.
4. Review the testing model shift and the Playwright/browser flow updates.
5. Only then spend time on individual UI/runtime details.

That order makes the rest of the patch much easier to interpret, because many
individual code changes only make sense once the repo has stopped optimizing for
the old shared-runtime premise.

## Verification Snapshot

The final sprint-close verification for this branch was:

- `pnpm test:e2e:web`
- `pnpm test`

Both passed after the final auth/map/runner alignment work. The important point
for review is that the branch was not left in a partially migrated state where
the runtime moved first and the verification model lagged behind.

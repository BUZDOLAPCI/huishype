# Fastify Session Auth Architecture Plan v2

## Summary

This document replaces the ambiguous parts of the earlier high-level auth plan
with the lowest-risk approach that fits HuisHype's actual architecture.

The core decision is:

- keep Fastify as the auth owner
- keep the current API-first browser vs non-browser split
- keep the current browser provider UX shape where it already works
- move browser auth to a real opaque server session
- keep explicit JWT token routes for future native and other non-browser clients
- remove browser refresh/rotation logic from React entirely

This plan is intentionally narrower than v1. It avoids switching to a different
OAuth product model, avoids introducing a full auth framework, and avoids
keeping the browser on the current dual-JWT-cookie design longer than needed.

## Why v1 Is Not The Best Path

The earlier plan was directionally correct, but too loose in the places that
matter most:

- `@fastify/session` and `@fastify/secure-session` were treated as equivalent
- `@fastify/oauth2` and `@fastify/passport` were suggested even though the
  active web login flow is not a server-driven OAuth redirect/callback flow
- the browser target state said "server session", but verification still
  assumed recoverable short-lived browser access credentials
- CSRF was mentioned, but not turned into an explicit repo-wide browser write
  requirement

For HuisHype, the safest plan is not "pick a library family later." It is to
commit to the exact auth shape now.

## Locked Decisions

### 1. Browser auth becomes a stateful Fastify-owned session

Use `@fastify/session` for the browser session primitive.

Do not use `@fastify/secure-session` for the primary browser auth model.

Reason:

- browser auth needs server-owned invalidation and renewal semantics
- the repo already has Redis in the stack and in the API runtime
- an opaque session ID is a cleaner browser contract than encrypted session
  state in the cookie
- this removes the need for browser-visible refresh semantics entirely

Implementation target:

- one opaque browser session cookie
- session data stored server-side
- session payload kept minimal: `userId`, timestamps, and only the metadata
  needed for session handling
- Redis-backed session storage using the existing Redis infrastructure

### 2. Provider route ownership stays in Fastify

Do not adopt `@fastify/oauth2` or `@fastify/passport` as the primary browser
auth architecture.

Reason:

- the current web app already acquires a Google credential client-side and
  exchanges it with the API
- email auth already lands in a web callback route and posts the token to the
  API
- future native clients also need explicit backend-owned token endpoints
- Passport adds session serialization machinery that does not meaningfully
  simplify the current product flow
- OAuth callback helpers are best when the backend owns the redirect dance; the
  active browser product does not work that way today

Fastify keeps route ownership for:

- `/auth/google`
- `/auth/apple`
- `/auth/email/request`
- `/auth/email/verify`
- `/auth/session`
- `/auth/logout`
- `/auth/token/*`

### 3. Replace bespoke token verification, not the route model

Keep the current route model, but replace the highest-risk custom verification
code with focused libraries.

Chosen direction:

- Google ID token verification: `google-auth-library`
- Apple ID token verification: `jose`

Do not keep:

- Google `tokeninfo` fetch verification as the long-term production path
- handwritten Apple JWKS fetch + signature verification as the long-term
  production path

Do not introduce `openid-client` unless HuisHype later chooses a real
server-driven OIDC/code-flow architecture.

### 4. `/auth/token/*` remains first-class and separate

The browser session rewrite must not collapse browser and future native auth
back into one mixed model.

Locked contract:

- browser: opaque cookie-backed server session
- native/non-browser: explicit bearer-token contract on `/auth/token/*`

The JWT token model remains valid for:

- future Kotlin/Swift clients
- CLI or script consumers
- explicit API clients that are not using browser cookie sessions

### 5. CSRF becomes an explicit required workstream

Use `@fastify/csrf-protection` for cookie-authenticated browser mutation
requests, together with existing origin enforcement.

Important:

- the plugin is a tool, not the full security story
- origin checks remain required
- all cookie-authenticated mutating routes must be covered, not just auth routes

This matters because the repo currently uses root-domain `SameSite=Lax` cookies
for browser auth, which is not sufficient on its own for same-site/subdomain
threats.

## End State

When this migration is complete:

- the browser has no refresh timer
- the browser does not call `/auth/refresh`
- the browser does not coordinate 401 refresh recovery
- the browser does not model "access token" at all
- `AuthProvider` becomes a thin session consumer
- Fastify owns browser login, session inspection, session renewal policy, and
  logout
- `/auth/token/*` continues to issue and refresh JWTs for non-browser clients
- Google and Apple token validation use maintained verification libraries
- all cookie-authenticated writes have explicit CSRF and origin protection

## Browser Contract

The browser contract should be reduced to these operations:

- `GET /auth/session`
- `POST /auth/google`
- `POST /auth/apple` if the active web client keeps Apple sign-in enabled
- `POST /auth/email/request`
- `POST /auth/email/verify`
- `POST /auth/logout`

Browser behavior:

- bootstrap by fetching `/auth/session`
- if authenticated, render the signed-in UI
- if unauthenticated, render the signed-out UI
- on Google login, exchange the browser-obtained Google credential with
  `/auth/google`
- on magic-link completion, let the callback route submit the email token to
  `/auth/email/verify`
- on logout, call `/auth/logout`

The browser must not:

- schedule token refresh
- retry requests by first calling refresh
- carry an in-memory access token abstraction
- treat `/auth/token/*` as part of the browser auth lifecycle

## Session Semantics

### Browser session cookie

Target properties:

- HTTP-only
- `Secure` in production
- root path
- domain aligned with the current deployment model
- `SameSite=Lax`

The cookie value should be only an opaque session identifier.

### Server session lifecycle

Target policy:

- session TTL stored and enforced server-side
- rolling renewal handled by Fastify/session store policy, not by browser
  timers
- current-session logout destroys the current server session
- session expiration returns unauthenticated browser state rather than a
  browser refresh attempt

Use the current 7-day refresh-token horizon as the initial browser session TTL
to minimize product-policy churn during migration. Revisit only after the new
model is stable.

### Authoritative session inspection

`GET /auth/session` becomes the single authoritative browser auth inspection
endpoint.

It should return:

- whether a valid browser session exists
- the serialized user when authenticated
- session expiry metadata if the UI needs it
- the CSRF token for subsequent browser-authenticated mutations

The browser should not need a second "who am I" auth endpoint.

## CSRF Model

Use `@fastify/csrf-protection` with `@fastify/session`.

Target browser model:

- authenticated browser bootstrap gets a CSRF token from `/auth/session`
- browser mutating requests send the CSRF token in a header
- protected mutating routes enforce CSRF validation
- origin checks remain enabled on browser-sensitive auth routes and are added
  where needed for broader cookie-authenticated writes

Protect at minimum:

- logout
- comments
- guesses
- likes
- any future cookie-authenticated POST/PUT/PATCH/DELETE routes

Read-only routes do not need CSRF enforcement.

## Backend Workstreams

### 1. Introduce the new browser session primitive

- register `@fastify/session`
- back it with Redis using the existing API Redis wiring
- add the new opaque browser session cookie
- define session TTL and rolling behavior
- keep the stored session payload minimal

### 2. Move browser routes to the session primitive

- update `/auth/google` to create the server session instead of issuing browser
  JWT cookies
- update `/auth/apple` the same way if active on web
- update `/auth/email/verify` to create the server session
- update `/auth/logout` to destroy the server session
- update `/auth/session` to read from the server session

### 3. Replace provider verification internals

- Google: replace `tokeninfo` verification with `google-auth-library`
- Apple: replace custom JWT/JWKS verification with `jose`
- keep user creation, account linking, username generation, and profile rules
  in HuisHype code

### 4. Preserve explicit token routes

Do not rewrite `/auth/token/*` onto the browser session model.

Keep explicit JWT issuance/refresh/logout for non-browser clients:

- `/auth/token/google`
- `/auth/token/apple`
- `/auth/token/email/verify`
- `/auth/token/refresh`
- `/auth/token/logout`

This code path can continue using the current JWT pair and refresh revocation
model until a native client forces a different decision.

### 5. Add browser-write CSRF enforcement

- register `@fastify/csrf-protection`
- define the standard browser CSRF header
- thread CSRF validation through cookie-authenticated write routes
- keep origin checks for auth-sensitive flows

## Frontend Workstreams

### 1. Simplify `AuthProvider`

Remove:

- refresh timer logic
- `/auth/refresh` usage
- browser "access token" state
- browser 401-to-refresh orchestration

Keep:

- session bootstrap from `/auth/session`
- sign-in methods that call the browser auth endpoints
- logout
- email token verification

### 2. Simplify API client behavior for the browser

For the browser-authenticated path:

- use `credentials: 'include'`
- stop treating 401 as a signal to refresh browser auth
- do not auto-attach bearer tokens for browser requests

`packages/api-client` may still retain explicit bearer-token support for
non-browser consumers, but that path must stay separate from browser session
behavior.

### 3. Keep the callback route thin

The web callback route should only:

- read the email token from the URL
- submit it to `/auth/email/verify`
- render success/failure state
- redirect after completion

It must not become a generic auth-orchestration route for Google unless the
product later changes to a backend-driven OAuth redirect model.

## Phased Delivery

### Phase 1. Lock contracts

- approve this auth shape
- freeze browser vs non-browser endpoint boundaries
- choose final cookie name and session TTL
- define CSRF header/response contract

### Phase 2. Build the server session path

- wire `@fastify/session` with Redis
- convert browser session routes to the new model
- keep token routes unchanged
- expose session + CSRF state from `/auth/session`

### Phase 3. Replace provider verification internals

- land `google-auth-library`
- land `jose`
- remove the old production verification paths

### Phase 4. Remove browser refresh machinery

- delete browser refresh timer code
- delete browser `/auth/refresh` usage
- remove browser 401 refresh coupling from the web client
- deprecate and then remove browser-only assumptions around access credentials

### Phase 5. Expand CSRF coverage

- cover logout and all cookie-authenticated writes
- add tests for missing/invalid CSRF tokens
- verify origin handling alongside CSRF handling

### Phase 6. Documentation cleanup

- update active auth docs
- document the browser session contract and token contract separately
- remove the old "browser access credential refresh" language from active docs

## Rejected Options

### Rejected: keep browser auth on dual JWT cookies

This leaves the web app owning refresh timing, race handling, and recovery
logic. That is exactly the complexity this migration is supposed to remove.

### Rejected: `@fastify/secure-session` as the primary browser auth primitive

It is viable technology, but it is the wrong default for this use case. The
browser auth model here wants server-side invalidation and a truly opaque
browser contract.

### Rejected: `@fastify/passport`

It adds a strategy/session abstraction layer that does not buy enough for the
current provider set or the current API-first flow shape.

### Rejected: `@fastify/oauth2` as the default provider integration

That would steer the implementation toward server-managed redirect flows that
do not match the active web product contract.

## Risks And Tradeoffs

- A stateful session store adds Redis dependency to browser auth, so store
  availability and TTL behavior now matter directly for login/session health.
- During migration, browser and token auth paths will temporarily coexist and
  must stay clearly separated.
- CSRF rollout must be broad and deliberate. Protecting only auth routes would
  leave real gaps.
- The current refresh-token revocation table still needs cleanup strategy as
  long as explicit token flows remain on the JWT-refresh model.

These tradeoffs are acceptable because they buy a much simpler and more stable
browser auth contract.

## Verification

### Backend

- integration tests for browser login establishing a server session
- integration tests for `/auth/session` authenticated and unauthenticated states
- integration tests for logout destroying the server session
- integration tests for missing/invalid/expired sessions
- integration tests for CSRF enforcement on cookie-authenticated write routes
- integration tests for `/auth/token/*` remaining unchanged

### Frontend

- web tests for session bootstrap on page load
- web tests for signed-out state after expired or missing server session
- web tests proving no browser refresh timer remains
- web tests proving no browser auth retry path depends on refresh
- callback route tests for email magic-link completion

### End-to-end

- Playwright coverage for Google sign-in
- Playwright coverage for email magic-link sign-in
- Playwright coverage for logout
- Playwright coverage for authenticated write requests failing correctly without
  a valid CSRF token

## Done State

This migration is done when:

- the browser auth contract is a real Fastify-owned server session
- `/auth/session` is the only browser session inspection endpoint that matters
- the active web client has no refresh timer and no browser refresh flow
- provider verification no longer depends on the current handwritten production
  logic
- `/auth/token/*` remains explicit and documented for non-browser clients
- CSRF protection is enforced across cookie-authenticated browser writes
- active docs describe the final split clearly and consistently

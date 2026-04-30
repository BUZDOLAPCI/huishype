# 2026-04 Social Following + Map Semantics Sprint Runbook

## Status

This sprint is shipped. This runbook records the completed architecture, runtime
contracts, and verification points for the social-following map cutover.

Normal app tile usage is Martin-backed through the Fastify `/tiles` gateway.
Public property tiles, private read-state tiles, private following tiles, base
tiles, styles, sprites, fonts, buildings, and trees are all served through that
gateway so app clients keep a single tile origin and cache policy boundary.

## Architecture

The shipped map stack has four separate surfaces:

- Public base tiles: `/tiles/base` TileJSON and `/tiles/base/{z}/{x}/{y}` tile
  bytes, backed by the Natural Earth/base PMTiles archive.
- Public property tiles: `/tiles/public_property_nodes` TileJSON and
  `/tiles/public_property_nodes/{z}/{x}/{y}` Martin function tiles.
- Private read-state tiles: signed `/tiles/sessions` templates for
  `/tiles/private_read_property_nodes/{z}/{x}/{y}`.
- Private following tiles: signed `/tiles/sessions` templates for
  `/tiles/private_following_property_nodes/{z}/{x}/{y}`.

The public and private tile paths are intentionally separate. Public tile
templates never receive viewer identity. Private read and following tiles do not
send `Authorization` or `x-session-id` headers from MapLibre tile requests;
viewer state is encoded into a short-lived signed tile-session token issued by
the API control plane.

Web style clients load `martin/styles/huishype.json` through
`/tiles/style/huishype`. Native style clients load
`martin/styles/huishype-native.json` through `/tiles/style/huishype-native`.
The Fastify style resource handler rewrites relative sprite, glyph, TileJSON,
and tile URLs to the request origin.

## Base Tiles

Base map metadata is fixed to the base archive contract:

- source: `base`
- TileJSON: `/tiles/base`
- tile template: `/tiles/base/{z}/{x}/{y}`
- min zoom: `0`
- max zoom: `14`
- bounds: `[-180, -85, 180, 85]`

The API TileJSON, web style source metadata, and native style source metadata
all advertise max zoom 14. Higher zoom map views rely on MapLibre overzooming
the z14 base archive, while property, building, and tree sources keep their own
zoom contracts.

## Public Property Tiles

Public property tiles remain anonymous/shared:

- TileJSON: `/tiles/public_property_nodes`
- tile template: `/tiles/public_property_nodes/{z}/{x}/{y}`
- min zoom: `7`
- max zoom: `22`
- promote id: `primary_property_id`
- cache policy: public gateway cache policy

Public map filters are serialized into the public tile URL. The public activity
contract is:

- `today`
- `10d`
- `30d`
- `all-time`

The public activity filter is orthogonal to market-state and price filters. It
does not imply following scope and does not carry viewer identity.

Grouped public tile and `/properties/nearby` payloads use composition fields
instead of legacy activity-score fields. The canonical grouped fields are:

- `nodeClass`
- `groupKind`
- `primaryPropertyId`
- `pointCount`
- `propertyIds`
- `previewPropertyIds`
- `coordinate`
- `bbox`
- `activeListingCount`
- `socialCount`
- `recentSocialCount`
- `socialScoreTotal`
- `socialScoreMax`
- `recentSocialScoreTotal`
- `commentCount`

Tile styling keys semantic color and pulse behavior from composition fields,
not from `point_count` alone.

## Private Tile Sessions

Private tiles are requested through signed sessions created by
`POST /tiles/sessions`.

The request selects a `scope`:

- `read` signs templates for `read-properties`
- `following` signs templates for `following-properties`

The response returns:

- `token`
- `tokenType`
- `scope`
- `audience`
- `expiresAt`
- `ttlSeconds`
- `tileTemplate`
- `cacheBustedTileTemplate`
- `tiles.template`
- `tiles.replacementTemplate`

The token claims include the audience, expiry, issue time, session id, path
prefix, viewer identity, and the relevant read/follow version. Tile requests
that lack a valid token, use a mismatched path prefix, use the wrong audience,
or carry an expired token return `401`.

Gateway proxying strips spoofable trusted parameters from incoming tile request
URLs and injects the trusted values from verified token claims before forwarding
to Martin. Private tile responses use `private, no-store`.

## Following Map Behavior

Following mode is app-only viewer state. It is not serialized into public tile
URLs, public nearby URLs, shared public cache keys, or public property filters.

The shipped following map has two personalized data paths:

- Private following tiles from `/tiles/private_following_property_nodes/{z}/{x}/{y}`
  via signed following tile sessions.
- Grouped nearby data from authenticated `GET /properties/following-nearby`.

Private following tiles provide scalable personalized map rendering through the
same Martin tile gateway as public properties. The authenticated nearby route
provides grouped, canonical preview data around the current map focus so taps,
cards, and sheet previews use the same grouped property contract as the public
nearby flow.

`/properties/following-nearby` returns only properties with qualifying activity
from followed users and intersects that set with active market-state, price, and
activity filters. Qualifying activity includes followed-user property likes,
comments, and price guesses. The response uses the canonical grouped shape and
does not degrade to public behavior for signed-out requests.

## Activity Surfaces

Activity API surfaces share the normalized activity item contract:

- `GET /activity?scope=public`
- `GET /activity?scope=following`
- `GET /users/me/activity`

Public and following activity feeds exclude private save events. The self
activity route includes the viewer's private save events. Personalized scopes
return `401` without a valid viewer.

The map activity time filter contract is `today|10d|30d|all-time`. App state,
URL state, API query parsing, mocks, generated clients, and tests use that
contract consistently.

## Follow Graph And Profile Contracts

The follow graph is stored in `user_follows` with:

- `follower_user_id`
- `followed_user_id`
- `created_at`
- composite primary key on `(follower_user_id, followed_user_id)`
- self-follow protection
- newest-first indexes for follower and followed list reads

Relationship state is `self | none | following | followed_by | mutual`.
Optional-auth profile reads return relationship and follower/following counts.
Anonymous profile reads return `relationship='none'`. Signed-in profile reads
send auth when available so optional-auth relationship state resolves for the
viewer.

`PUT /users/:id/follow` and `DELETE /users/:id/follow` return the updated
relationship payload. `GET /users/me/followers` and
`GET /users/me/following` are authenticated self-list routes ordered
newest-first.

## Cache Boundaries

Anonymous and authenticated data never share query keys where response shape can
depend on viewer state. This applies to profile relationship fields, following
activity, private read-state tiles, private following tiles, and following
nearby results.

Public property tiles, public nearby, public property detail, and public
activity filters remain shared anonymous-safe surfaces. Private tile sessions
and following nearby are authenticated control-plane/API surfaces and use
viewer-specific cache keys.

## Verification

The shipped architecture is covered by:

- tile gateway integration tests for style resources, TileJSON metadata,
  private tile-session signing, trusted parameter injection, and Martin proxying
- map projection integration tests for public, read-state, and following tile
  filter parity
- properties integration tests for public nearby and authenticated
  `/properties/following-nearby`
- activity integration tests for public, following, and self activity contracts
- app tests for public map filters, following mode, signed tile sessions,
  grouped preview behavior, and web/native map screen behavior
- Martin config validation for checked-in Martin styles and source config

The canonical repo gate remains `pnpm test`.

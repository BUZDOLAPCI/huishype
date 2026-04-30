# Martin / MVT Map Architecture

_Last reviewed: 2026-04-29_

## Current Status

The dynamic HuisHype map tile migration now uses Martin-backed MVT through
PostGIS functions and the Fastify `/tiles` gateway. The old concern that
Martin would lose live social/property clustering is addressed by projection
tables plus `martin_tiles.*` SQL tile functions. Dynamic map tiles use MVT
because Martin and PostgreSQL can generate MVT directly from live projections.

## Why Martin

Martin is a Rust-based tile server by MapLibre. It can serve vector tiles directly from PostGIS tables and functions, plus handle font and sprite serving — replacing a lot of custom Node.js tile code. Benefits: better tile performance, built-in caching (512MB LRU), connection pooling, Prometheus metrics, and separation of concerns between tile serving and business logic.

## MLT (MapLibre Tiles) Status

MLT is the next-gen vector tile format (column-oriented, up to 6x smaller than MVT). Our MapLibre forks already include MLT decoding and our custom shaders are unaffected (MLT changes decoding, not rendering).

HuisHype keeps dynamic property/read/following tiles on Martin-served MVT:

- No way to dynamically generate MLT from PostGIS — Martin and PostgreSQL only produce MVT. Our dynamic clustering tiles have no MLT path without switching to pre-built tile archives.
- MLT-only dynamic clustering is unavailable from PostGIS, so dynamic
  property/read/following tiles use Martin-served MVT.
- MapLibre Native can't decode FastPFOR-compressed MLT yet (maplibre-native PR #4146, open)

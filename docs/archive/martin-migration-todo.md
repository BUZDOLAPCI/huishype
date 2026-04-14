# Martin / MLT Migration

*Last reviewed: 2026-03-21*

## Why Martin

Martin is a Rust-based tile server by MapLibre. It can serve vector tiles directly from PostGIS tables and functions, plus handle font and sprite serving — replacing a lot of custom Node.js tile code. Benefits: better tile performance, built-in caching (512MB LRU), connection pooling, Prometheus metrics, and separation of concerns between tile serving and business logic.

## MLT (MapLibre Tiles) — not yet

MLT is the next-gen vector tile format (column-oriented, up to 6x smaller than MVT). Our MapLibre forks already include MLT decoding and our custom shaders are unaffected (MLT changes decoding, not rendering).

**Why not now (as of 2026-03-21):**

- No way to dynamically generate MLT from PostGIS — Martin and PostgreSQL only produce MVT. Our dynamic clustering tiles have no MLT path without switching to pre-built tile archives.
- Dynamic Clustering: the tiles.ts does on-the-fly clustering based on activity scores. Since Martin can't "ask" PostGIS for an MLT (it only knows ST_AsMVT), you would lose your live social activity features if you moved to a static MLT workflow today.
- MapLibre Native can't decode FastPFOR-compressed MLT yet (maplibre-native PR #4146, open)

**Revisit when**: Martin gains MLT encoding from PostGIS or something similar, or when the Overture/FastPFOR bugs are resolved and we can use pre-built MLT for static layers alongside dynamic MVT for property tiles.

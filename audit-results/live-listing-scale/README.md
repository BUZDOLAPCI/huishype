# Live listing publication scale check

This benchmark uses **100,000 actual synthetic canonical listings, 100,000 listing-backed properties, and 1,000,000 unrelated synthetic properties** in an isolated local PostgreSQL/PostGIS database. It does not load production records or claim a measured 41-million-property runtime.

The listing distribution is 30% tightly clustered Amsterdam points, 20% points straddling a zoom-10 tile edge, and 50% spread across ten Dutch cities. Twelve distinct tiles cover zooms 0, 5 and 10. Queue expansion and publication cover every affected tile at every zoom from 0 through 10. Group membership is retained completely, and publication produces the actual stored MVT payload.

## Findings

Final measured results are recorded in `after-index-fix.json`. The earlier `before-index-fix.json` preserves the query plan that scanned all 1.1 million properties for the world tile. The corrected production query uses a parameterized `properties_pkey` lookup for each source property. Its `OFFSET 0` boundary surrounds only the ID lookup; spatial predicates remain outside that boundary. This avoids both a whole-table hash join and repeated spatial scans for small tiles. Candidate IDs retain the source CTE cardinality rather than being reduced by a redundant `DISTINCT` estimate.

The benchmark rejects any sample plan using a property access path other than the primary-key index, severe candidate cardinality underestimation, incomplete world-tile membership, failed tile publication, outstanding queue demand, or a projected queue drain exceeding 15 minutes. The expiry phase additionally requires zero active listings and zero published nodes after all synthetic listings expire.

## Measured results

| Operation | Result |
| --- | ---: |
| Source change request for 100,000 listings | 7.03 s |
| Expand 100,000 property requests | 2.70 s; 58 distinct tiles |
| Publish all 58 queued tiles | 44.79 s; 0 failed, 0 pending |
| Same drain with worker interval gaps | 63.50 s, excluding the preceding expansion |
| Expire all 100,000 listings | 18.45 s |
| Expiry and publication combined | 55.19 s; 0 failed, 0 pending |
| Expiry including projected interval gaps | 81.50 s |
| World tile grouping / publication | 1.425 s / 0.173 s |
| Zoom-5 grouping / publication | 1.448 s / 0.143 s |
| Zoom-10 grouping plus publication, ten distinct samples | 0.453–0.846 s |
| Largest complete cluster membership | 100,000 IDs; 4,000,153 bytes of stored JSON text |
| Largest sampled encoded MVT | 36,713 bytes |
| Process maximum RSS over final run | 480,956 KiB (469.7 MiB) |
| Largest expansion statement | 55 distinct tiles; 275 parameters |
| End of expiry | 0 active listings; 0 published nodes |

The initial publication projects to about 66 seconds including expansion, and expiry to about 82 seconds including expiration. Adding a worst-case 30-second wait for the next sweep leaves both below two minutes on this fixture. Both are well below the 15-minute target under the measured workload assumptions. These are workload-specific measurements and scheduling projections, not a production SLA.

Before the query fix the same 58-tile drain took 121.68 seconds (139.74 seconds including projected interval gaps). The final world-tile candidate estimate is approximately 101,502 rows versus 100,000 actual rows. Every sampled property lookup uses `properties_pkey` with 100,000 loops; none traverses the unrelated background property heap. `intermediate-spatial-plan.json` preserves the rejected intermediate plan which instead repeated a spatial index scan per source ID for Groningen.

This run used Node 25.6.1 on a 32-logical-CPU host with approximately 126 GiB RAM, PostgreSQL shared buffers of 128 MiB, work memory of 4 MiB, and up to two parallel workers per gather. The worker itself ran serially. CPU availability and storage/cache behavior affect timing; there was no competing application benchmark. The result JSON records source-file SHA-256 hashes, PostgreSQL buffer/timing plans, per-stage grouping timings, memory snapshots and every queue pass. This run uses the migration-0063 queue/publication implementation; subsequent migration-0064 publication telemetry was being developed separately and is not included in these timings. The final production query hash is `c071a5c19a022b4e020f06eccb17fad10022875fec3e7a8496ff687dd203023f`.

## Reproduce

Use a disposable local database ending in `_scale_test`, migrated through the app's current migrations (including canonical price metadata and the durable listing tile queue). The script refuses a non-loopback URL or a database containing unrelated properties. Existing repository dependencies are required.

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/benchmark_scale_test'
export NODE_ENV=test
pnpm --filter @huishype/api exec tsx scripts/benchmark-live-listing-scale.ts \
  --mode prepare --rows 100000 --background-rows 1000000 \
  --json-out /tmp/live-listing-prepare.json
pnpm --filter @huishype/api exec tsx scripts/benchmark-live-listing-scale.ts \
  --mode measure --rows 100000 --background-rows 1000000 --drain --expire \
  --json-out /tmp/live-listing-measure.json
pnpm --filter @huishype/api exec tsx scripts/benchmark-live-listing-scale.ts \
  --mode cleanup --json-out /tmp/live-listing-cleanup.json
```

Preparation is resumable with the same row counts. Use a fresh database when changing counts. Increase `--background-rows` for a larger base-table check; the script allows up to 50 million background properties. Run with no competing benchmark or database maintenance. The measurement promotes a synthetic empty initial coverage using the real promotion guard, generates 100,000 source-change requests, expands them through the real durable queue, measures uncached grouping/publication, then drains all queued tiles. Representative tile publication occurs before the full drain and therefore warms some database pages; timings are not cold-cache claims. Expiry invokes the real availability expiry batches and drains their tile requests, without another ingest event.

## Interpretation limits

The source-first property lookup count is bounded by the 100,000 source IDs, not by unrelated address rows. A 41-million-row table still has a larger index and a different cache/storage cost, so this plan evidence does not constitute a 41-million-row timing guarantee. Social source tables were empty, and geographically broader source coverage would dirty more tiles. The benchmark measures the live map pipeline; it excludes whole-pyramid rebuilds and separate materialized-view maintenance.

Worker scheduling projections use a serial worker, at most 50 tiles per pass, a 60-second pass loop budget, a 120-second individual tile budget, and a 30-second fixed interval which skips overlapping passes. Tight-loop runtime is measured; interval gaps are calculated from those measured pass durations. An event arriving just after a sweep may add up to one additional 30-second interval. Competing work, continuous new revisions, crash recovery and lease delays can increase latency.

The measured NL distribution produces at most 55 distinct dirty tiles per 5,000-property expansion batch, or 275 bind parameters. Production expansion additionally chunks its VALUES statements at 2,000 tiles (10,000 parameters), and publication chunks node insertion at 500 nodes. These guards bound SQL parameter counts when geographically broader source batches create more work. The final fixture contains at most 31 output nodes in a sampled tile, so it exercises ordinary publication rather than the 500-node chunk boundary.

import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { hostname, cpus, totalmem } from 'node:os';
import { sql } from 'drizzle-orm';
import { db, closeConnection } from '../src/db/index.js';
import { createDefaultMapFilters } from '../src/services/map-filters.js';
import {
  buildCanonicalGroupsForTileUncached,
  buildGroupingCandidateScopeCtes,
  getGroupingBufferUnits,
  PROPERTY_TILE_EXTENT,
} from '../src/services/property-grouping.js';
import {
  computeListingAffectedTiles,
  expandListingTilePropertyUpdates,
  runListingTileUpdates,
} from '../src/services/listing-tile-updates.js';
import {
  getDefaultPropertyTilePyramidSlot,
  publishListingUpdatedPyramidTile,
} from '../src/services/property-tile-pyramid.js';
import { expireListingAvailability } from '../src/services/listing-lifecycle-maintenance.js';
import type { PropertyTileStageTiming } from '../src/services/property-tile-runtime.js';

// Only synthetic data in a dedicated local *_scale_test database. Preparation,
// measurement and cleanup are separate so operators can avoid competing loads.
const args = process.argv.slice(2);
const arg = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const rows = Number(arg('--rows', '100000'));
const backgroundRows = Number(arg('--background-rows', '1000000'));
const mode = arg('--mode', 'measure');
const jsonOut = arg('--json-out', '/tmp/live-listing-scale.json');
const budgetMs = Number(arg('--budget-ms', '120000'));
type TileId = { z: number; x: number; y: number };
const marker = 'hh-live-scale:';
const record: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  rows,
  backgroundRows,
  mode,
  environment: {
    host: hostname(),
    cpuCount: cpus().length,
    hostMemoryBytes: totalmem(),
    node: process.version,
  },
  limitations: [
    'Synthetic 100k listing source, not literal production 41m addresses.',
    'No external requests or production data.',
    'Projected drain time assumes one serial worker and representative measured per-zoom cost.',
  ],
};
const samples: Array<{ name: string; lon: number; lat: number }> = [
  { name: 'Amsterdam dense', lon: 4.8952, lat: 52.3702 },
  { name: 'Utrecht', lon: 5.1214, lat: 52.0907 },
  { name: 'Rotterdam', lon: 4.4777, lat: 51.9244 },
  { name: 'Eindhoven', lon: 5.4793, lat: 51.4416 },
  { name: 'Groningen', lon: 6.5665, lat: 53.2194 },
  { name: 'Maastricht', lon: 5.69, lat: 50.8514 },
  { name: 'Nijmegen', lon: 5.8528, lat: 51.8425 },
  { name: 'Leeuwarden', lon: 5.7999, lat: 53.2012 },
  { name: 'The Hague', lon: 4.3007, lat: 52.0705 },
  { name: 'Haarlem', lon: 4.6462, lat: 52.3874 },
  { name: 'Tile edge', lon: 5.2734375, lat: 52.26815737376817 },
];
function tileAt(lon: number, lat: number, z: number): TileId {
  const n = 2 ** z;
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
  };
}
function bufferedBounds(tile: TileId) {
  const n = 2 ** tile.z,
    b = getGroupingBufferUnits() / PROPERTY_TILE_EXTENT;
  const latitude = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return {
    minLon: ((tile.x - b) / n) * 360 - 180,
    maxLon: ((tile.x + 1 + b) / n) * 360 - 180,
    minLat: latitude(tile.y + 1 + b),
    maxLat: latitude(tile.y - b),
  };
}
async function guard() {
  const address = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
    !address.pathname.endsWith('_scale_test')
  ) {
    throw new Error('Benchmark requires explicit local DATABASE_URL ending in _scale_test');
  }
  if (
    ![rows, backgroundRows].every(Number.isInteger) ||
    rows < 1 ||
    rows > 1_000_000 ||
    backgroundRows < 0 ||
    backgroundRows > 50_000_000
  )
    throw new Error('Invalid synthetic row counts');
  const existing = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM properties WHERE national_id IS NULL OR national_id NOT LIKE ${`${marker}%`}`
  );
  if (existing[0].count !== 0)
    throw new Error('Dedicated benchmark database contains unrelated properties');
}
async function prepare() {
  const start = performance.now();
  const count = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM properties`
  );
  record.preexistingSyntheticProperties = count[0].count;
  await db.execute(
    sql`CREATE UNLOGGED TABLE IF NOT EXISTS benchmark_live_listing_points(id uuid PRIMARY KEY, scenario text, lon float8, lat float8)`
  );
  await db.execute(sql`INSERT INTO benchmark_live_listing_points
    SELECT md5(${marker} || 'listing:' || i)::uuid,
      CASE WHEN i <= ${Math.floor(rows * 0.3)} THEN 'dense' WHEN i <= ${Math.floor(rows * 0.5)} THEN 'edge' ELSE 'city' END,
      CASE WHEN i <= ${Math.floor(rows * 0.3)} THEN 4.8952 + (i%100-50)*0.00005
        WHEN i <= ${Math.floor(rows * 0.5)} THEN 5.2734375 + (i%100-50)*0.00001
        ELSE (ARRAY[4.8952,5.1214,4.4777,5.4793,6.5665,5.6900,5.8528,5.7999,4.3007,4.6462])[1+(i%10)] + ((i/10)%100-50)*0.001 END,
      CASE WHEN i <= ${Math.floor(rows * 0.3)} THEN 52.3702 + ((i/100)%100-50)*0.00003
        WHEN i <= ${Math.floor(rows * 0.5)} THEN 52.26815737376817 + ((i/100)%100-50)*0.00001
        ELSE (ARRAY[52.3702,52.0907,51.9244,51.4416,53.2194,50.8514,51.8425,53.2012,52.0705,52.3874])[1+(i%10)] + ((i/1000)%100-25)*0.0007 END
    FROM generate_series(1,${rows}) i ON CONFLICT(id) DO NOTHING`);
  await db.execute(sql`INSERT INTO properties(id,country_code,national_id,street,house_number,city,postal_code,geometry)
    SELECT id,'NL',${marker} || replace(id::text,'-',''),'Synthetic listing',1,'Synthetic NL','1234AB',ST_SetSRID(ST_MakePoint(lon,lat),4326)
    FROM benchmark_live_listing_points ON CONFLICT(id) DO NOTHING`);
  console.log(
    JSON.stringify({ stage: 'listing properties seeded', elapsedMs: performance.now() - start })
  );
  for (let offset = 0; offset < backgroundRows; offset += 100_000) {
    await db.execute(sql`INSERT INTO properties(id,country_code,national_id,street,house_number,city,postal_code,geometry)
      SELECT md5(${marker} || 'background:' || i)::uuid,'NL',${marker} || 'background:' || i,
        'Synthetic background',1,'Synthetic EU','9999ZZ',
        ST_SetSRID(ST_MakePoint(-10+(i%10000)*0.0035,40+((i/10000)%1000)*0.02),4326)
      FROM generate_series(${offset + 1}::int,${Math.min(backgroundRows, offset + 100_000)}::int) i ON CONFLICT(id) DO NOTHING`);
    console.log(
      JSON.stringify({
        stage: 'background seeded',
        count: Math.min(backgroundRows, offset + 100_000),
        elapsedMs: performance.now() - start,
      })
    );
  }
  await db.execute(sql`INSERT INTO canonical_listings(id,property_id,source_name,primary_source_listing_id,canonical_url,status,status_source,verification_state,origin_summary,asking_price,price_type,price_period,price_unit,price_condition,last_positive_availability_at,availability_expires_at,active_eligible)
    SELECT md5(${marker} || 'canonical:' || id)::uuid,id,'funda',id::text,'https://example.test/synthetic/'||id,
      'active','mirror','validated','mirror',400000,'sale','total','listing','asking',now(),now()+interval '30 days',true
    FROM benchmark_live_listing_points ON CONFLICT(id) DO NOTHING`);
  await db.execute(sql`ANALYZE properties`);
  await db.execute(sql`ANALYZE canonical_listings`);
  await db.execute(sql`ANALYZE listing_tile_property_updates`);
  record.prepareMs = performance.now() - start;
  record.tableSizes = Array.from(
    await db.execute(
      sql`SELECT relname,pg_total_relation_size(relid)::bigint AS total_bytes,n_live_tup FROM pg_stat_user_tables WHERE relname IN ('properties','canonical_listings','listing_tile_property_updates')`
    )
  );
}
async function measure() {
  const requestStart = performance.now();
  await db.execute(
    sql`UPDATE canonical_listings SET asking_price=asking_price+1,last_positive_availability_at=now(),availability_expires_at=now()+interval '30 days',active_eligible=true WHERE property_id IN (SELECT id FROM benchmark_live_listing_points)`
  );
  record.request100kChangesMs = performance.now() - requestStart;
  record.codeHashes = Object.fromEntries(
    await Promise.all(
      ['property-grouping.ts', 'property-tile-pyramid.ts', 'listing-tile-updates.ts'].map(
        async (name) => [
          name,
          createHash('sha256')
            .update(await readFile(new URL(`../src/services/${name}`, import.meta.url)))
            .digest('hex'),
        ]
      )
    )
  );
  record.databaseSettings = Array.from(
    await db.execute(
      sql`SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_parallel_workers_per_gather','jit')`
    )
  );
  const stored = Array.from(
    await db.execute<{ id: string; lon: number; lat: number }>(
      sql`SELECT id::text,lon,lat FROM benchmark_live_listing_points`
    )
  );
  if (stored.length !== rows) throw new Error('Prepared listing count differs from --rows');
  const dirty = new Map<string, TileId>();
  const dirtyStart = performance.now();
  let maxBatchDirtyTiles = 0;
  for (let offset = 0; offset < stored.length; offset += 5000) {
    const batch = new Set<string>();
    for (const point of stored.slice(offset, offset + 5000))
      for (const tile of computeListingAffectedTiles(point.lon, point.lat, 10)) {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        dirty.set(key, tile);
        batch.add(key);
      }
    maxBatchDirtyTiles = Math.max(maxBatchDirtyTiles, batch.size);
  }
  record.dirtyWork = {
    computeMs: performance.now() - dirtyStart,
    totalTiles: dirty.size,
    maxBatchDirtyTiles,
    expansionBindParametersMax: maxBatchDirtyTiles * 5,
    perZoom: Object.fromEntries(
      Array.from({ length: 11 }, (_, z) => [
        z,
        [...dirty.values()].filter((tile) => tile.z === z).length,
      ])
    ),
  };
  const versionId = randomUUID(),
    slot = getDefaultPropertyTilePyramidSlot();
  record.versionId = versionId;
  const initialTiles: TileId[] = [];
  for (let z = 0; z <= 10; z++) {
    const northwest = tileAt(4, 54, z),
      southeast = tileAt(7, 50, z);
    for (let x = northwest.x; x <= southeast.x; x++)
      for (let y = northwest.y; y <= southeast.y; y++) initialTiles.push({ z, x, y });
  }
  await db.execute(sql`INSERT INTO property_tile_pyramid_versions(id,coverage_id,filter_signature,max_zoom,pyramid_kind,config_hash,build_inputs_hash,source_watermark_hash,status,validated_at,coverage_snapshot_json,expected_tile_count,validated_tile_count)
    VALUES(${versionId},${slot.coverageId},${slot.filterSignature},${slot.maxZoom},${slot.pyramidKind},'synthetic-scale',${versionId},${versionId},'validated',now(),
      '{"bounds":{"minLon":4,"minLat":50,"maxLon":7,"maxLat":54},"minZoom":0,"maxZoom":10}'::jsonb,${initialTiles.length},${initialTiles.length})`);
  await db.execute(sql`SELECT ensure_property_tile_pyramid_version_partitions(${versionId}::uuid)`);
  await db.execute(sql`INSERT INTO property_tile_pyramid_tiles(version_id,z,x,y,tile_status,validation_status,node_count,etag,validated_at)
    VALUES ${sql.join(
      initialTiles.map(
        (tile) =>
          sql`(${versionId},${tile.z},${tile.x},${tile.y},'valid_empty','validated',0,${`empty-${versionId}`},now())`
      ),
      sql`, `
    )}`);
  const current = await db.execute<{ current_version_id: string }>(
    sql`SELECT current_version_id FROM property_tile_pyramid_current WHERE coverage_id=${slot.coverageId} AND filter_signature=${slot.filterSignature} AND max_zoom=${slot.maxZoom} AND pyramid_kind=${slot.pyramidKind}`
  );
  await db.execute(
    sql`SELECT promote_property_tile_pyramid_version(${versionId}::uuid,${current[0]?.current_version_id ?? null}::uuid,'synthetic scale bootstrap','benchmark')`
  );
  const expandStart = performance.now();
  let expanded = 0;
  for (;;) {
    const batch = await expandListingTilePropertyUpdates(5000);
    expanded += batch;
    if (batch < 5000) break;
  }
  record.expansion = {
    ms: performance.now() - expandStart,
    expandedProperties: expanded,
    queuedTiles: Array.from(
      await db.execute(
        sql`SELECT z,count(*)::int AS count FROM listing_tile_updates GROUP BY z ORDER BY z`
      )
    ),
  };
  const results: Array<Record<string, unknown>> = [];
  record.tiles = results;
  const seen = new Set<string>();
  for (const z of [0, 5, 10])
    for (const sample of samples) {
      const tile = tileAt(sample.lon, sample.lat, z),
        key = `${z}/${tile.x}/${tile.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const filters = createDefaultMapFilters();
      const plan = Array.from(
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('statement_timeout',${String(budgetMs)},true)`);
          return tx.execute(sql`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON,SETTINGS)
          WITH ${buildGroupingCandidateScopeCtes([bufferedBounds(tile)], filters, z, { liveListingUpdates: true })}
          SELECT count(*) FROM candidate_properties`);
        })
      );
      const planSummary = summarizePlan(plan);
      const item: Record<string, unknown> = { ...tile, name: sample.name, plan, planSummary };
      results.push(item);
      await writeFile(jsonOut, JSON.stringify(record, null, 2));
      if (
        planSummary.some(
          (node) =>
            node['Relation Name'] === 'properties' && node['Index Name'] !== 'properties_pkey'
        )
      )
        throw new Error(`Non-primary property access for ${key}`);
    }
  for (const item of results) {
    const tile = { z: Number(item.z), x: Number(item.x), y: Number(item.y) };
    const filters = createDefaultMapFilters();
    const stages: PropertyTileStageTiming[] = [];
    const start = performance.now(),
      before = process.memoryUsage();
    try {
      const groups = await buildCanonicalGroupsForTileUncached(tile, filters, {
        liveListingUpdates: true,
        clusterPropertyIdRetention: 'complete',
        runtimeBudgetMs: budgetMs,
        statementTimeoutMs: budgetMs,
        onStageTiming: (timing) => stages.push(timing),
      });
      item.groupMs = performance.now() - start;
      item.nodeInsertBindUpperEstimate = groups.length * 45;
      item.groups = groups.length;
      item.members = groups.reduce((sum, g) => sum + g.pointCount, 0);
      item.maxGroupMembers = Math.max(0, ...groups.map((g) => g.pointCount));
      const pubStart = performance.now();
      await db.transaction((tx) =>
        publishListingUpdatedPyramidTile(tx, { versionId, tile, groups, revision: '1' })
      );
      item.publishMs = performance.now() - pubStart;
      const manifests = await db.execute(
        sql`SELECT node_count,octet_length(payload) AS payload_bytes FROM property_tile_pyramid_tiles WHERE version_id=${versionId} AND z=${tile.z} AND x=${tile.x} AND y=${tile.y}`
      );
      item.manifest = manifests[0];
    } catch (error) {
      item.error = String(error);
      item.errorCause = error instanceof Error && error.cause ? String(error.cause) : null;
    }
    item.elapsedMs = performance.now() - start;
    item.stages = stages;
    item.memoryBefore = before;
    item.memoryAfter = process.memoryUsage();
    item.maxRssKiB = process.resourceUsage().maxRSS;
    console.log(
      JSON.stringify({
        ...tile,
        name: item.name,
        groupMs: item.groupMs,
        publishMs: item.publishMs,
        groups: item.groups,
        members: item.members,
        error: item.error,
      })
    );
    await writeFile(jsonOut, JSON.stringify(record, null, 2));
  }
  if (args.includes('--drain'))
    for (const phase of ['initial', ...(args.includes('--expire') ? ['expiry'] : [])]) {
      record.largestStoredClustersBeforeExpiry ??= Array.from(
        await db.execute(
          sql`SELECT point_count,octet_length(node_summary_json::text) AS summary_bytes FROM property_tile_pyramid_nodes WHERE version_id=${versionId} AND node_summary_json IS NOT NULL ORDER BY point_count DESC LIMIT 5`
        )
      );
      const drainStart = performance.now();
      let expiredCount = 0;
      if (phase === 'expiry') {
        await db.execute(
          sql`UPDATE canonical_listings SET availability_expires_at=now()-interval '1 day' WHERE property_id IN (SELECT id FROM benchmark_live_listing_points)`
        );
        for (;;) {
          const count = await expireListingAvailability(10000);
          expiredCount += count;
          if (count < 10000) break;
        }
      }
      const expiryMs = performance.now() - drainStart;
      const passes: Array<Record<string, unknown>> = [];
      let pending = 1;
      while (pending > 0 && performance.now() - drainStart < 15 * 60 * 1000) {
        const passStart = performance.now();
        const outcome = await runListingTileUpdates(50);
        const state = await db.execute<{ pending: number }>(
          sql`SELECT count(*)::int AS pending FROM listing_tile_updates WHERE requested_revision > published_revision OR published_version_id IS DISTINCT FROM ${versionId}::uuid`
        );
        pending = state[0].pending;
        const pass = { ...outcome, ms: performance.now() - passStart, pending };
        passes.push(pass);
        console.log(JSON.stringify({ stage: 'full queue drain', phase, ...pass }));
        if (outcome.failedTiles > 0 || (outcome.publishedTiles === 0 && pending > 0)) break;
      }
      const scheduledMs = passes.reduce(
        (sum, pass, index) =>
          sum +
          (index === passes.length - 1
            ? Number(pass.ms)
            : Math.ceil(Number(pass.ms) / 30_000) * 30_000),
        0
      );
      record[phase === 'initial' ? 'fullQueueDrain' : 'expiryQueueDrain'] = {
        expiredCount,
        expiryMs,
        ms: performance.now() - drainStart,
        pending,
        passes,
        scheduledMs: scheduledMs + expiryMs,
        workerCadence: {
          intervalMs: 30_000,
          maxTilesPerPass: 50,
          loopBudgetMs: 60_000,
          singleTileBudgetMs: 120_000,
        },
        failures: Array.from(
          await db.execute(
            sql`SELECT z,x,y,last_error FROM listing_tile_updates WHERE last_error IS NOT NULL`
          )
        ),
      };
    }
  if (args.includes('--expire'))
    record.expiryProjection = {
      activeListings: Number(
        (
          await db.execute(
            sql`SELECT count(*) AS count FROM canonical_listings WHERE active_eligible`
          )
        )[0].count
      ),
      publishedNodes: Number(
        (
          await db.execute(
            sql`SELECT count(*) AS count FROM property_tile_pyramid_nodes WHERE version_id=${versionId}`
          )
        )[0].count
      ),
    };
  const byZoom = Object.fromEntries([0, 5, 10].map((z) => [z, results.filter((r) => r.z === z)]));
  record.largestStoredClusters = Array.from(
    await db.execute(
      sql`SELECT point_count,octet_length(node_summary_json::text) AS summary_bytes FROM property_tile_pyramid_nodes WHERE version_id=${versionId} AND node_summary_json IS NOT NULL ORDER BY point_count DESC LIMIT 5`
    )
  );
  record.projectedDrain = {
    assumptions:
      'Each dirty tile rebuilt serially once; nearest measured zoom sample mean used for unsampled levels. Excludes competing workloads and future snapshot/social growth.',
    ms: [...dirty.values()].reduce(
      (sum, tile) => {
        const sampleZ = tile.z < 3 ? 0 : tile.z < 8 ? 5 : 10;
        const costs = byZoom[sampleZ].map((r) => Number(r.elapsedMs));
        return sum + costs.reduce((a, b) => a + b, 0) / costs.length;
      },
      Number((record.expansion as { ms: number }).ms)
    ),
  };
}
function summarizePlan(plan: unknown): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node['Relation Name'] === 'properties' || node['CTE Name'] === 'candidate_properties') {
      nodes.push(
        Object.fromEntries(
          [
            'Node Type',
            'Relation Name',
            'CTE Name',
            'Index Name',
            'Plan Rows',
            'Actual Rows',
            'Actual Loops',
            'Actual Total Time',
          ]
            .filter((key) => key in node)
            .map((key) => [key, node[key]])
        )
      );
    }
    Object.values(node).forEach(visit);
  }
  visit(plan);
  return nodes;
}
function validateMeasurements() {
  const failures: string[] = [];
  const tiles = record.tiles as Array<Record<string, unknown>>;
  if (!tiles?.length) failures.push('No measured sample tiles');
  for (const tile of tiles ?? []) {
    if (tile.error) failures.push(`Tile ${tile.z}/${tile.x}/${tile.y}: ${tile.error}`);
    tile.planSummary = summarizePlan(tile.plan);
    for (const node of tile.planSummary as Array<Record<string, unknown>>) {
      if (node['Relation Name'] === 'properties' && node['Index Name'] !== 'properties_pkey')
        failures.push(
          `Tile ${tile.z}/${tile.x}/${tile.y}: property lookup does not use properties_pkey`
        );
      if (
        node['CTE Name'] === 'candidate_properties' &&
        Number(node['Actual Rows']) > 1000 &&
        Number(node['Plan Rows']) < Number(node['Actual Rows']) / 10
      )
        failures.push('Candidate estimate is more than ten times below actual rows');
    }
  }
  if (Number(tiles?.find((tile) => tile.z === 0)?.members) !== rows)
    failures.push('World tile did not retain complete listing membership');
  for (const key of ['fullQueueDrain', 'expiryQueueDrain']) {
    const drain = record[key] as
      | { pending: number; failures: unknown[]; scheduledMs: number }
      | undefined;
    if (
      drain &&
      (drain.pending !== 0 || drain.failures.length || drain.scheduledMs > 15 * 60 * 1000)
    )
      failures.push(
        `${key} failed, remained pending, or exceeded 15-minute projected worker cadence`
      );
  }
  if (record.expiryProjection) {
    const state = record.expiryProjection as { activeListings: number; publishedNodes: number };
    if (state.activeListings !== 0 || state.publishedNodes !== 0)
      failures.push('Expired listings remain active or published');
  }
  record.validation = { passed: failures.length === 0, failures };
  if (failures.length) throw new Error(failures.join('; '));
}
async function cleanup() {
  await db.execute(sql`DELETE FROM properties WHERE national_id LIKE ${`${marker}%`}`);
  await db.execute(sql`DELETE FROM listing_tile_property_updates`);
  await db.execute(sql`DELETE FROM listing_tile_updates`);
  await db.execute(sql`DELETE FROM property_tile_pyramid_current`);
  await db.execute(
    sql`DELETE FROM property_tile_pyramid_versions WHERE config_hash='synthetic-scale'`
  );
  await db.execute(sql`DROP TABLE IF EXISTS benchmark_live_listing_points`);
}
try {
  await guard();
  if (mode === 'prepare') await prepare();
  else if (mode === 'measure') {
    await measure();
    validateMeasurements();
  } else if (mode === 'cleanup') await cleanup();
  else throw new Error('Use --mode prepare|measure|cleanup');
  await writeFile(jsonOut, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify({ mode, jsonOut, complete: true, maxRssKiB: process.resourceUsage().maxRSS })
  );
} catch (error) {
  record.error = String(error);
  console.error(error);
  await writeFile(jsonOut, JSON.stringify(record, null, 2));
  process.exitCode = 1;
} finally {
  await closeConnection();
}

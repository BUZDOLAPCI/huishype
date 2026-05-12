import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSummary, isExpectedStatus, type BenchmarkRow } from './benchmark-property-tiles.ts';

function benchmarkRow(overrides: Partial<BenchmarkRow> = {}): BenchmarkRow {
  return {
    city: 'Amsterdam',
    semanticGroup: 'low-zoom',
    z: 10,
    x: 527,
    y: 340,
    phase: 'cold',
    status: 200,
    bytes: 128,
    elapsedClientMs: 25,
    xTileCache: 'precomputed',
    xTileGenerationTime: '5ms',
    xTileQueueTime: '0ms',
    xTileCoalesced: 'false',
    xTileBudgetMs: '500',
    xHuisHypeTileStatus: 'pyramid-promoted',
    ...overrides,
  };
}

test('benchmark treats unavailable pyramid 204 responses as failures', () => {
  const row = benchmarkRow({
    status: 204,
    bytes: 0,
    xTileCache: 'pyramid-unavailable',
    xHuisHypeTileStatus: 'pyramid-build-active',
  });

  assert.equal(isExpectedStatus(row), false);

  const summary = buildSummary([row], {
    baseUrl: 'http://127.0.0.1:3100',
    warmPasses: 1,
    timeoutMs: 60_000,
  });

  assert.equal(summary.byPhase.find((phase) => phase.phase === 'cold')?.okStatuses, 0);
  assert.deepEqual(summary.unexpectedStatuses, [row]);
  assert.deepEqual(summary.failures, [
    'Amsterdam 10/527/340 cold unavailable pyramid tile status=204 tile_status=pyramid-build-active',
    'Low-zoom pyramid benchmark precondition failed: 1 tile request(s) returned X-Tile-Cache=pyramid-unavailable (tile statuses: pyramid-build-active). benchmark:property-tiles:gate requires a promoted current property tile pyramid before measuring low-zoom public tiles. If status is pyramid-build-active or pyramid-build-enqueued, start/verify the worker with "docker compose --profile worker up -d worker" or "pnpm --filter @huishype/worker dev", wait for promotion, then rerun. Readiness probe: curl -I http://127.0.0.1:3100/tiles/properties/10/527/340.pbf should report X-Tile-Cache=precomputed.',
  ]);
});

test('benchmark still treats normal empty 204 tiles as successful', () => {
  const row = benchmarkRow({
    status: 204,
    bytes: 0,
    xTileCache: 'precomputed',
    xHuisHypeTileStatus: 'pyramid-empty',
  });

  assert.equal(isExpectedStatus(row), true);
});

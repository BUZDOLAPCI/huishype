import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiModuleUrl } from './api-runtime.js';
import { ensureWorkerRuntimeEnv, loadWorkerConfig } from './config.js';

test('ensureWorkerRuntimeEnv defaults missing NODE_ENV to development', () => {
  const env: NodeJS.ProcessEnv = {};

  ensureWorkerRuntimeEnv(env);

  assert.equal(env.NODE_ENV, 'development');
});

test('ensureWorkerRuntimeEnv preserves an explicit NODE_ENV', () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };

  ensureWorkerRuntimeEnv(env);

  assert.equal(env.NODE_ENV, 'production');
});

test('loadWorkerConfig uses defaults when env vars are missing', () => {
  const config = loadWorkerConfig({});

  assert.equal(config.ingestConcurrency, 4);
  assert.equal(config.maintenanceConcurrency, 1);
  assert.equal(config.officialValuationHydrationConcurrency, 1);
  assert.equal(config.propertyTileSnapshotConcurrency, 1);
  assert.equal(config.recoveryBatchLimit, 100);
  assert.equal(config.skippedBatchRecoveryLimit, 1);
  assert.equal(config.recoverySweepIntervalMs, 30_000);
  assert.equal(config.healthLogIntervalMs, 60_000);
  assert.equal(config.staleProcessingAfterMs, 600_000);
  assert.equal(config.shutdownTimeoutMs, 15_000);
});

test('loadWorkerConfig parses explicit overrides', () => {
  const config = loadWorkerConfig({
    WORKER_INGEST_CONCURRENCY: '8',
    WORKER_MAINTENANCE_CONCURRENCY: '2',
    WORKER_OFFICIAL_VALUATION_HYDRATION_CONCURRENCY: '1',
    WORKER_PROPERTY_TILE_SNAPSHOT_CONCURRENCY: '1',
    WORKER_RECOVERY_BATCH_LIMIT: '50',
    WORKER_SKIPPED_BATCH_RECOVERY_LIMIT: '3',
    WORKER_RECOVERY_SWEEP_INTERVAL_MS: '15000',
    WORKER_HEALTH_LOG_INTERVAL_MS: '45000',
    WORKER_STALE_PROCESSING_AFTER_MS: '300000',
    WORKER_SHUTDOWN_TIMEOUT_MS: '9000',
  });

  assert.equal(config.ingestConcurrency, 8);
  assert.equal(config.maintenanceConcurrency, 2);
  assert.equal(config.officialValuationHydrationConcurrency, 1);
  assert.equal(config.propertyTileSnapshotConcurrency, 1);
  assert.equal(config.recoveryBatchLimit, 50);
  assert.equal(config.skippedBatchRecoveryLimit, 3);
  assert.equal(config.recoverySweepIntervalMs, 15_000);
  assert.equal(config.healthLogIntervalMs, 45_000);
  assert.equal(config.staleProcessingAfterMs, 300_000);
  assert.equal(config.shutdownTimeoutMs, 9_000);
});

test('loadWorkerConfig rejects invalid integers', () => {
  assert.throws(
    () => loadWorkerConfig({ WORKER_INGEST_CONCURRENCY: '0' }),
    /WORKER_INGEST_CONCURRENCY must be a positive integer/,
  );
});

test('resolveApiModuleUrl uses src artifacts when running from worker source', () => {
  const moduleUrl = 'file:///home/caslan/dev/git_repos/hh/huishype/services/worker/src/api-runtime.ts';

  assert.equal(
    resolveApiModuleUrl('services/ingest/jobs.js', moduleUrl),
    'file:///home/caslan/dev/git_repos/hh/huishype/services/api/src/services/ingest/jobs.js',
  );
  assert.equal(
    resolveApiModuleUrl('services/property-tile-snapshots.js', moduleUrl),
    'file:///home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-tile-snapshots.js',
  );
});

test('resolveApiModuleUrl uses dist artifacts when running from worker dist', () => {
  const moduleUrl = 'file:///app/services/worker/dist/api-runtime.js';

  assert.equal(
    resolveApiModuleUrl('services/ingest/jobs.js', moduleUrl),
    'file:///app/services/api/dist/services/ingest/jobs.js',
  );
});

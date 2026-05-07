const DEFAULT_INGEST_CONCURRENCY = 4;
const DEFAULT_MAINTENANCE_CONCURRENCY = 1;
const DEFAULT_CANDIDATE_HANDOFF_CONCURRENCY = 2;
const DEFAULT_OFFICIAL_VALUATION_HYDRATION_CONCURRENCY = 1;
const DEFAULT_PROPERTY_TILE_PYRAMID_CONCURRENCY = 1;
const DEFAULT_RECOVERY_BATCH_LIMIT = 100;
const DEFAULT_SKIPPED_BATCH_RECOVERY_LIMIT = 1;
const DEFAULT_RECOVERY_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_HEALTH_LOG_INTERVAL_MS = 60_000;
const DEFAULT_STALE_PROCESSING_AFTER_MS = 10 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

export interface WorkerConfig {
  ingestConcurrency: number;
  maintenanceConcurrency: number;
  candidateHandoffConcurrency: number;
  officialValuationHydrationConcurrency: number;
  propertyTilePyramidConcurrency: number;
  recoveryBatchLimit: number;
  skippedBatchRecoveryLimit: number;
  recoverySweepIntervalMs: number;
  healthLogIntervalMs: number;
  staleProcessingAfterMs: number;
  shutdownTimeoutMs: number;
}

export function ensureWorkerRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.NODE_ENV) {
    env.NODE_ENV = 'development';
  }
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value == null || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${value}"`);
  }

  return parsed;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    ingestConcurrency: parsePositiveInt(
      env.WORKER_INGEST_CONCURRENCY,
      DEFAULT_INGEST_CONCURRENCY,
      'WORKER_INGEST_CONCURRENCY',
    ),
    maintenanceConcurrency: parsePositiveInt(
      env.WORKER_MAINTENANCE_CONCURRENCY,
      DEFAULT_MAINTENANCE_CONCURRENCY,
      'WORKER_MAINTENANCE_CONCURRENCY',
    ),
    candidateHandoffConcurrency: parsePositiveInt(
      env.WORKER_CANDIDATE_HANDOFF_CONCURRENCY,
      DEFAULT_CANDIDATE_HANDOFF_CONCURRENCY,
      'WORKER_CANDIDATE_HANDOFF_CONCURRENCY',
    ),
    officialValuationHydrationConcurrency: parsePositiveInt(
      env.WORKER_OFFICIAL_VALUATION_HYDRATION_CONCURRENCY,
      DEFAULT_OFFICIAL_VALUATION_HYDRATION_CONCURRENCY,
      'WORKER_OFFICIAL_VALUATION_HYDRATION_CONCURRENCY',
    ),
    propertyTilePyramidConcurrency: parsePositiveInt(
      env.WORKER_PROPERTY_TILE_PYRAMID_CONCURRENCY,
      DEFAULT_PROPERTY_TILE_PYRAMID_CONCURRENCY,
      'WORKER_PROPERTY_TILE_PYRAMID_CONCURRENCY',
    ),
    recoveryBatchLimit: parsePositiveInt(
      env.WORKER_RECOVERY_BATCH_LIMIT,
      DEFAULT_RECOVERY_BATCH_LIMIT,
      'WORKER_RECOVERY_BATCH_LIMIT',
    ),
    skippedBatchRecoveryLimit: parsePositiveInt(
      env.WORKER_SKIPPED_BATCH_RECOVERY_LIMIT,
      DEFAULT_SKIPPED_BATCH_RECOVERY_LIMIT,
      'WORKER_SKIPPED_BATCH_RECOVERY_LIMIT',
    ),
    recoverySweepIntervalMs: parsePositiveInt(
      env.WORKER_RECOVERY_SWEEP_INTERVAL_MS,
      DEFAULT_RECOVERY_SWEEP_INTERVAL_MS,
      'WORKER_RECOVERY_SWEEP_INTERVAL_MS',
    ),
    healthLogIntervalMs: parsePositiveInt(
      env.WORKER_HEALTH_LOG_INTERVAL_MS,
      DEFAULT_HEALTH_LOG_INTERVAL_MS,
      'WORKER_HEALTH_LOG_INTERVAL_MS',
    ),
    staleProcessingAfterMs: parsePositiveInt(
      env.WORKER_STALE_PROCESSING_AFTER_MS,
      DEFAULT_STALE_PROCESSING_AFTER_MS,
      'WORKER_STALE_PROCESSING_AFTER_MS',
    ),
    shutdownTimeoutMs: parsePositiveInt(
      env.WORKER_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      'WORKER_SHUTDOWN_TIMEOUT_MS',
    ),
  };
}

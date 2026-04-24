const DEFAULT_INGEST_CONCURRENCY = 4;
const DEFAULT_MAINTENANCE_CONCURRENCY = 1;
const DEFAULT_RECOVERY_BATCH_LIMIT = 100;
const DEFAULT_RECOVERY_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_HEALTH_LOG_INTERVAL_MS = 60_000;
const DEFAULT_STALE_PROCESSING_AFTER_MS = 10 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const DEFAULT_LISTING_WATCH_SWEEP_LIMIT = 25;
const DEFAULT_LISTING_WATCH_RETRY_BASE_DELAY_MS = 5 * 60_000;
const DEFAULT_LISTING_WATCH_RETRY_MAX_DELAY_MS = 6 * 60 * 60_000;

export interface WorkerConfig {
  ingestConcurrency: number;
  maintenanceConcurrency: number;
  recoveryBatchLimit: number;
  recoverySweepIntervalMs: number;
  healthLogIntervalMs: number;
  staleProcessingAfterMs: number;
  shutdownTimeoutMs: number;
  listingWatchSweepLimit: number;
  listingWatchRetryBaseDelayMs: number;
  listingWatchRetryMaxDelayMs: number;
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
    recoveryBatchLimit: parsePositiveInt(
      env.WORKER_RECOVERY_BATCH_LIMIT,
      DEFAULT_RECOVERY_BATCH_LIMIT,
      'WORKER_RECOVERY_BATCH_LIMIT',
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
    listingWatchSweepLimit: parsePositiveInt(
      env.WORKER_LISTING_WATCH_SWEEP_LIMIT,
      DEFAULT_LISTING_WATCH_SWEEP_LIMIT,
      'WORKER_LISTING_WATCH_SWEEP_LIMIT',
    ),
    listingWatchRetryBaseDelayMs: parsePositiveInt(
      env.WORKER_LISTING_WATCH_RETRY_BASE_DELAY_MS,
      DEFAULT_LISTING_WATCH_RETRY_BASE_DELAY_MS,
      'WORKER_LISTING_WATCH_RETRY_BASE_DELAY_MS',
    ),
    listingWatchRetryMaxDelayMs: parsePositiveInt(
      env.WORKER_LISTING_WATCH_RETRY_MAX_DELAY_MS,
      DEFAULT_LISTING_WATCH_RETRY_MAX_DELAY_MS,
      'WORKER_LISTING_WATCH_RETRY_MAX_DELAY_MS',
    ),
  };
}

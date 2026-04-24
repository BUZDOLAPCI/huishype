import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface IngestJobsModule {
  INGEST_BATCH_QUEUE: string;
  MAINTENANCE_QUEUE: string;
}

export interface IngestQueueModule {
  closeIngestQueues(): Promise<void>;
  enqueueIngestBatch(batchId: string): Promise<void>;
  requestLatestListingsRefresh(data: {
    requestedBy: 'ingest-batch' | 'listing-submit' | 'validation-outcome' | 'worker-sweep';
    batchId?: string;
  }): Promise<void>;
}

export interface IngestProcessorModule {
  processIngestBatch(options: {
    batchId: string;
    maxAttempts?: number;
    logger?: {
      info(payload: Record<string, unknown>, message: string): void;
      warn(payload: Record<string, unknown>, message: string): void;
      error(payload: Record<string, unknown>, message: string): void;
    };
    enqueueMaintenanceRefresh?: (data: {
      requestedBy: 'ingest-batch' | 'listing-submit' | 'worker-sweep';
      batchId?: string;
    }) => Promise<void>;
  }): Promise<{
    status: 'completed' | 'noop';
    ingested: number;
    updated: number;
    skipped: number;
  }>;
  refreshLatestListingsMaintenance(
    refreshViews: (() => Promise<void>) | Array<() => Promise<void>>,
    options?: {
      logger?: {
        info(payload: Record<string, unknown>, message: string): void;
        warn(payload: Record<string, unknown>, message: string): void;
        error(payload: Record<string, unknown>, message: string): void;
      };
    },
  ): Promise<number>;
}

export interface IngestStoreModule {
  collectRecoveryDispatchWork(
    staleProcessingBefore: Date,
    limit?: number,
  ): Promise<{
    staleProcessingBatchIds: string[];
    recoverableBatchIds: string[];
    maintenancePending: boolean;
  }>;
  markBatchQueued(batchId: string): Promise<void>;
}

export interface ListingsViewModule {
  refreshLatestListingsView(): Promise<void>;
  refreshPriceGuessStartMarketSummaries(): Promise<void>;
}

export interface ListingReconciliationModule {
  processDueListingValidationWatches(options: {
    limit: number;
    retryDelayMs?: (attemptCount: number) => number;
  }): Promise<{
    claimedCount: number;
    terminalCount: number;
    retryableCount: number;
    results: Array<
      | {
          outcome: 'terminal';
          watchId: string;
          state: string;
          maintenanceBatchId: string;
        }
      | {
          outcome: 'retryable';
          watchId: string;
          state: 'retryable_error';
          attemptCount: number;
          nextAttemptAt: Date;
          error: string;
        }
    >;
  }>;
}

export interface ApiDbModule {
  closeConnection(): Promise<void>;
}

export interface RedisConnectionLike {
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface ApiRedisModule {
  createRedisConnection(): Promise<RedisConnectionLike>;
  closeRedisConnection(): Promise<void>;
}

export function resolveApiModuleRoot(moduleUrl: string = import.meta.url): 'src' | 'dist' {
  const modulePath = fileURLToPath(moduleUrl);
  const workerSrcSegment = `${path.sep}services${path.sep}worker${path.sep}src${path.sep}`;
  const workerDistSegment = `${path.sep}services${path.sep}worker${path.sep}dist${path.sep}`;

  if (modulePath.includes(workerDistSegment)) {
    return 'dist';
  }

  if (modulePath.includes(workerSrcSegment)) {
    return 'src';
  }

  return path.extname(modulePath) === '.js' ? 'dist' : 'src';
}

export function resolveApiModuleUrl(relativePath: string, moduleUrl: string = import.meta.url): string {
  return new URL(`../../api/${resolveApiModuleRoot(moduleUrl)}/${relativePath}`, moduleUrl).href;
}

async function importApiModule<T>(relativePath: string): Promise<T> {
  return import(resolveApiModuleUrl(relativePath)) as Promise<T>;
}

export function loadIngestJobsModule(): Promise<IngestJobsModule> {
  return importApiModule<IngestJobsModule>('services/ingest/jobs.js');
}

export function loadIngestQueueModule(): Promise<IngestQueueModule> {
  return importApiModule<IngestQueueModule>('services/ingest/queue.js');
}

export function loadIngestProcessorModule(): Promise<IngestProcessorModule> {
  return importApiModule<IngestProcessorModule>('services/ingest/processor.js');
}

export function loadIngestStoreModule(): Promise<IngestStoreModule> {
  return importApiModule<IngestStoreModule>('services/ingest/store.js');
}

export function loadListingsViewModule(): Promise<ListingsViewModule> {
  return importApiModule<ListingsViewModule>('services/listings-view.js');
}

export function loadListingReconciliationModule(): Promise<ListingReconciliationModule> {
  return importApiModule<ListingReconciliationModule>('services/listing-reconciliation.js');
}

export function loadApiDbModule(): Promise<ApiDbModule> {
  return importApiModule<ApiDbModule>('db/index.js');
}

export function loadApiRedisModule(): Promise<ApiRedisModule> {
  return importApiModule<ApiRedisModule>('lib/redis.js');
}

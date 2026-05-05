import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface IngestJobsModule {
  INGEST_BATCH_QUEUE: string;
  MAINTENANCE_QUEUE: string;
  PROPERTY_TILE_SNAPSHOT_QUEUE: string;
  PROPERTY_TILE_SNAPSHOT_REFRESH_JOB: string;
}

export interface OfficialValuationJobsModule {
  OFFICIAL_VALUATION_HYDRATION_QUEUE: string;
}

export interface CandidateHandoffJobsModule {
  CANDIDATE_HANDOFF_QUEUE: string;
}

export interface IngestQueueModule {
  closeIngestQueues(): Promise<void>;
  enqueueIngestBatch(batchId: string): Promise<void>;
  requestLatestListingsRefresh(data: {
    requestedBy:
      | 'ingest-batch'
      | 'listing-submit'
      | 'official-valuation'
      | 'worker-sweep';
    batchId?: string;
  }): Promise<void>;
  enqueuePropertyTileSnapshotRefresh(data: { reason: string }): Promise<unknown>;
}

export interface CandidateHandoffQueueModule {
  closeCandidateHandoffQueues(): Promise<void>;
  enqueueCandidateHandoff(handoffId: string): Promise<void>;
}

export interface CandidateHandoffStoreModule {
  collectDueCandidateHandoffIds(limit?: number): Promise<string[]>;
}

export interface CandidateHandoffProcessorModule {
  processCandidateHandoffJob(options: {
    handoffId: string;
    logger?: {
      info(payload: Record<string, unknown>, message: string): void;
      warn(payload: Record<string, unknown>, message: string): void;
      error(payload: Record<string, unknown>, message: string): void;
    };
  }): Promise<Record<string, unknown>>;
}

export interface PropertyTileSnapshotsModule {
  executePropertyTileSnapshotRefresh(options?: {
    reason?: string;
    leaseOwner?: string;
  }): Promise<Record<string, unknown>>;
  requestPropertyTileSnapshotRefresh(input: {
    reason: string;
    throttleMs?: number;
  }): Promise<{
    enqueued: boolean;
    throttled: boolean;
    enqueueStatus?: 'enqueued' | 'retried' | 'coalesced' | 'skipped';
    skippedReason?: 'throttled' | 'disabled';
    queueJobId?: string;
    queueJobState?: string | null;
  }>;
  shouldRequestPropertyTileSnapshotRefresh(): Promise<{
    shouldEnqueue: boolean;
    reason: string;
  }>;
}

export interface OfficialValuationQueueModule {
  closeOfficialValuationQueues(): Promise<void>;
  enqueueOfficialValuationHydration(data: {
    jobId: string;
    propertyId: string;
    source: 'woz';
    valuationYear: number;
  }): Promise<void>;
}

export interface OfficialValuationStoreModule {
  collectDueOfficialValuationHydrationJobs(limit?: number): Promise<
    Array<{
      id: string;
      propertyId: string;
      source: 'woz';
      valuationYear: number;
    }>
  >;
  markOfficialValuationHydrationJobQueued(jobId: string): Promise<void>;
}

export interface OfficialValuationProcessorModule {
  processOfficialValuationHydrationJob(options: {
    jobId: string;
    logger?: {
      info(payload: Record<string, unknown>, message: string): void;
      warn(payload: Record<string, unknown>, message: string): void;
      error(payload: Record<string, unknown>, message: string): void;
    };
  }): Promise<Record<string, unknown>>;
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
      skippedBatchRecoveryLimit?: number;
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

export function loadOfficialValuationJobsModule(): Promise<OfficialValuationJobsModule> {
  return importApiModule<OfficialValuationJobsModule>('services/official-valuations/jobs.js');
}

export function loadCandidateHandoffJobsModule(): Promise<CandidateHandoffJobsModule> {
  return importApiModule<CandidateHandoffJobsModule>('services/candidate-handoffs/jobs.js');
}

export function loadIngestQueueModule(): Promise<IngestQueueModule> {
  return importApiModule<IngestQueueModule>('services/ingest/queue.js');
}

export function loadCandidateHandoffQueueModule(): Promise<CandidateHandoffQueueModule> {
  return importApiModule<CandidateHandoffQueueModule>('services/candidate-handoffs/queue.js');
}

export function loadCandidateHandoffStoreModule(): Promise<CandidateHandoffStoreModule> {
  return importApiModule<CandidateHandoffStoreModule>('services/candidate-handoffs/store.js');
}

export function loadCandidateHandoffProcessorModule(): Promise<CandidateHandoffProcessorModule> {
  return importApiModule<CandidateHandoffProcessorModule>('services/candidate-handoffs/processor.js');
}

export function loadPropertyTileSnapshotsModule(): Promise<PropertyTileSnapshotsModule> {
  return importApiModule<PropertyTileSnapshotsModule>('services/property-tile-snapshots.js');
}

export function loadOfficialValuationQueueModule(): Promise<OfficialValuationQueueModule> {
  return importApiModule<OfficialValuationQueueModule>('services/official-valuations/queue.js');
}

export function loadOfficialValuationStoreModule(): Promise<OfficialValuationStoreModule> {
  return importApiModule<OfficialValuationStoreModule>('services/official-valuations/store.js');
}

export function loadOfficialValuationProcessorModule(): Promise<OfficialValuationProcessorModule> {
  return importApiModule<OfficialValuationProcessorModule>('services/official-valuations/processor.js');
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

export function loadApiDbModule(): Promise<ApiDbModule> {
  return importApiModule<ApiDbModule>('db/index.js');
}

export function loadApiRedisModule(): Promise<ApiRedisModule> {
  return importApiModule<ApiRedisModule>('lib/redis.js');
}

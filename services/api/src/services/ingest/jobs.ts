export const INGEST_BATCH_QUEUE = 'ingest-batches';
export const INGEST_BATCH_JOB = 'ingest-batch';
export const MAINTENANCE_QUEUE = 'ingest-maintenance';
export const REFRESH_LATEST_LISTINGS_JOB = 'refresh-latest-active-listings';

export interface IngestBatchJobData {
  batchId: string;
}

export interface MaintenanceRefreshJobData {
  requestedBy: 'ingest-batch' | 'listing-submit' | 'validation-outcome' | 'worker-sweep';
  batchId?: string;
}

export const INGEST_BATCH_QUEUE = 'ingest-batches';
export const INGEST_BATCH_JOB = 'ingest-batch';
export const MAINTENANCE_QUEUE = 'ingest-maintenance';
export const REFRESH_LATEST_LISTINGS_JOB = 'refresh-latest-active-listings';
export const PROPERTY_TILE_SNAPSHOT_QUEUE = 'property-tile-snapshots';
export const PROPERTY_TILE_SNAPSHOT_REFRESH_JOB = 'refresh-property-tile-snapshots';
export const PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_ID = 'property-tile-snapshot-refresh-public-default-low-zoom';

export interface IngestBatchJobData {
  batchId: string;
}

export interface MaintenanceRefreshJobData {
  requestedBy:
    | 'ingest-batch'
    | 'listing-submit'
    | 'official-valuation'
    | 'worker-sweep';
  batchId?: string;
}

export interface PropertyTileSnapshotRefreshJobData {
  reason: string;
}

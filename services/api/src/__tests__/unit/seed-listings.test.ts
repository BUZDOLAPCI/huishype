import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const acceptIngestBatchMock = jest.fn(async () => ({ batchId: 'accepted-batch-1' }));
const processIngestBatchMock = jest.fn(async () => ({
  status: 'completed' as 'completed' | 'noop',
  ingested: 1,
  updated: 0,
  skipped: 0,
}));
const encodeOpaqueIngestCursorMock = jest.fn((input: { listingKey: string }) => `cursor:${input.listingKey}`);
const getIngestWatermarkMock = jest.fn(async () => ({ cursor: null }));
const refreshLatestListingsMaintenanceMock = jest.fn(async () => 0);
const refreshLatestListingsViewMock = jest.fn(async () => undefined);
const refreshPriceGuessStartMarketSummariesMock = jest.fn(async () => undefined);
const closeConnectionMock = jest.fn(async () => undefined);
const dotenvConfigMock = jest.fn();

jest.unstable_mockModule('dotenv', () => ({
  default: {
    config: dotenvConfigMock,
  },
}));

jest.unstable_mockModule('../../services/ingest/index.js', () => ({
  acceptIngestBatch: acceptIngestBatchMock,
  encodeOpaqueIngestCursor: encodeOpaqueIngestCursorMock,
  getIngestWatermark: getIngestWatermarkMock,
  processIngestBatch: processIngestBatchMock,
  refreshLatestListingsMaintenance: refreshLatestListingsMaintenanceMock,
}));

jest.unstable_mockModule('../../services/listings-view.js', () => ({
  refreshLatestListingsView: refreshLatestListingsViewMock,
  refreshPriceGuessStartMarketSummaries: refreshPriceGuessStartMarketSummariesMock,
}));

jest.unstable_mockModule('../../db/index.js', () => ({
  closeConnection: closeConnectionMock,
}));

const sourceHighWatermark = new Date('2026-01-02T03:04:05.000Z');
const seedListingsScriptModulePath = ['..', '..', '..', 'scripts', 'seed-listings.js'].join('/');

interface SeedListingsTestModule {
  __seedListingsTest: {
    executeSource(
      source: 'funda',
      mirrorDb: unknown,
      options: ReturnType<typeof createOptions>,
      summary: ReturnType<typeof createSummary>,
    ): Promise<unknown>;
  };
}

let mirrorDbMock: jest.Mock;

function createMirrorDb(): jest.Mock {
  return jest.fn(async () => {
    const callIndex = mirrorDbMock.mock.calls.length;
    if (callIndex === 1) {
      return [{
        count: '2',
        full_count: '2',
        oldest_timestamp: sourceHighWatermark,
        high_watermark: sourceHighWatermark,
      }];
    }

    return [
      {
        id: 1,
        funda_id: '12345678',
        pararius_id: null,
        listing_url: '',
        price_type: 'sale',
        asking_price_cents: '45000000',
        living_area_m2: 80,
        num_rooms: 3,
        energy_label: 'A',
        status: 'available',
        photo_urls: null,
        first_seen_at: sourceHighWatermark,
        last_seen_at: sourceHighWatermark,
        last_changed_at: sourceHighWatermark,
        street: 'Vestdijk',
        house_number: '1',
        house_number_addition: null,
        postal_code: '5611CA',
        city: 'Eindhoven',
        latitude: 51.438,
        longitude: 5.475,
      },
      {
        id: 2,
        funda_id: '22345678',
        pararius_id: null,
        listing_url: '',
        price_type: 'sale',
        asking_price_cents: '55000000',
        living_area_m2: 90,
        num_rooms: 4,
        energy_label: 'B',
        status: 'available',
        photo_urls: null,
        first_seen_at: sourceHighWatermark,
        last_seen_at: sourceHighWatermark,
        last_changed_at: sourceHighWatermark,
        street: 'Vestdijk',
        house_number: '2',
        house_number_addition: null,
        postal_code: '5611CA',
        city: 'Eindhoven',
        latitude: 51.438,
        longitude: 5.475,
      },
    ];
  });
}

function createOptions() {
  return {
    dryRun: false,
    source: 'funda',
    scope: null,
    reason: null,
    repair: false,
    batchSize: 1,
    fetchSize: 2,
    maxSkipped: 0,
    maxSkipRatio: 0.1,
    maxAffectedCanonical: 0,
    maxStaleRows: 0,
  } as const;
}

function createSummary() {
  return {
    sourceName: 'funda',
    scopeKey: 'full-mirror',
    scopeMode: 'whole_mirror',
    dryRun: false,
    repairMode: false,
    replayReason: null,
    mirrorSnapshotId: `funda:full-mirror:2:${sourceHighWatermark.toISOString()}`,
    sourceRunId: `seed-listings:funda:full-mirror:${sourceHighWatermark.toISOString()}:2:replay`,
    sourceHighWatermark: sourceHighWatermark.toISOString(),
    oldestSourceTimestamp: sourceHighWatermark.toISOString(),
    newestSourceTimestamp: sourceHighWatermark.toISOString(),
    existingCursor: null,
    mirrorListingCount: 2,
    fullMirrorListingCount: 2,
    excludedMirrorListingCount: 0,
    preparedListingCount: 2,
    skippedBeforeIngestCount: 0,
    diagnosticListingCount: 0,
    transitionCounts: {
      projectable: 2,
      diagnostic: 0,
      skipped: 0,
      completion: 1,
      staleObservations: 0,
      reactivationCandidates: 0,
      duplicateCanonicalCandidates: 0,
      terminalLifecycleChanges: 0,
      absenceWithoutCompletion: 0,
      readModelRefreshes: 1,
    },
    affectedCanonicalCount: 0,
    staleObservationCount: 0,
    reactivationCandidateCount: 0,
    duplicateCanonicalCandidateCount: 0,
    terminalLifecycleChangeCount: 0,
    absenceWithoutCompletionCount: 0,
    readModelRefreshCount: 1,
    batchCount: 2,
    processedBatchCount: 0,
    ingestedCount: 0,
    updatedCount: 0,
    skippedByProcessorCount: 0,
    staleForProjection: false,
    thresholds: {
      maxSkipped: 0,
      maxSkipRatio: 0.1,
      maxAffectedCanonical: 0,
      maxStaleRows: 0,
      skipRatio: 0,
      violations: [],
    },
    executionAssessment: {
      executeAllowed: true,
      repairExecuteAllowed: true,
      abortReasons: [],
    },
    limitations: [],
    excludedMirrorRange: null,
    examples: {
      skippedBeforeIngest: [],
      diagnosticListings: [],
      projectableListings: [],
      staleRows: [],
    },
  } as const;
}

describe('seed listings execute replay', () => {
  beforeEach(() => {
    jest.resetModules();
    acceptIngestBatchMock.mockClear();
    processIngestBatchMock.mockReset();
    processIngestBatchMock.mockResolvedValue({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });
    encodeOpaqueIngestCursorMock.mockClear();
    refreshLatestListingsMaintenanceMock.mockClear();
    mirrorDbMock = createMirrorDb();
  });

  it('fails hard on a noop processor result before accepting later replay batches', async () => {
    processIngestBatchMock.mockResolvedValueOnce({
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });
    const { __seedListingsTest } = await import(seedListingsScriptModulePath) as SeedListingsTestModule;

    await expect(
      __seedListingsTest.executeSource('funda', mirrorDbMock, createOptions(), createSummary()),
    ).rejects.toThrow(
      'The accepted batch was likely not claimable; refusing to advance the local replay cursor or accept later batches.',
    );

    expect(acceptIngestBatchMock).toHaveBeenCalledTimes(1);
    expect(processIngestBatchMock).toHaveBeenCalledTimes(1);
    expect(refreshLatestListingsMaintenanceMock).not.toHaveBeenCalled();
  });
});

import {
  OfficialValuationNotFoundError,
  OfficialValuationRateLimitError,
  OfficialValuationUnsupportedError,
} from './errors.js';
import { getOfficialValuationSourceConfig } from './registry.js';
import { getOfficialValuationSourceClient } from './source-client.js';
import {
  claimOfficialValuationHydrationJob,
  markOfficialValuationHydrationFailed,
  markOfficialValuationHydrationRetryable,
  markOfficialValuationHydrationSucceeded,
  markOfficialValuationSourceFailure,
  markOfficialValuationSourceSuccess,
  releaseOfficialValuationSourceRequest,
  reserveOfficialValuationSourceRequest,
} from './store.js';
import { requestLatestListingsRefresh } from '../ingest/queue.js';
import { requestPropertyTileSnapshotRefresh } from '../property-tile-snapshots.js';

export type OfficialValuationProcessorLogger = {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
};

export type OfficialValuationHydrationProcessResult =
  | { status: 'completed'; valuation: number; valuationYear: number }
  | { status: 'noop'; reason: string }
  | { status: 'retryable'; reason: string; nextAttemptAt: string }
  | { status: 'failed'; reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processOfficialValuationHydrationJob(options: {
  jobId: string;
  logger?: OfficialValuationProcessorLogger;
}): Promise<OfficialValuationHydrationProcessResult> {
  const claimed = await claimOfficialValuationHydrationJob(options.jobId);
  if (!claimed) {
    return { status: 'noop', reason: 'not_due_or_already_claimed' };
  }

  const config = getOfficialValuationSourceConfig(claimed.source);
  if (!config.countries.includes(claimed.property.countryCode)) {
    await markOfficialValuationHydrationFailed({
      jobId: claimed.id,
      error: `${claimed.source} is unsupported for ${claimed.property.countryCode}`,
    });
    return { status: 'failed', reason: 'unsupported_country' };
  }

  const reservation = await reserveOfficialValuationSourceRequest(claimed.source);
  if (!reservation.allowed) {
    await markOfficialValuationHydrationRetryable({
      jobId: claimed.id,
      source: claimed.source,
      attemptCount: claimed.attemptCount,
      error: reservation.reason,
      nextAttemptAt: reservation.nextAttemptAt,
    });
    return {
      status: 'retryable',
      reason: reservation.reason,
      nextAttemptAt: reservation.nextAttemptAt.toISOString(),
    };
  }

  try {
    const result = await getOfficialValuationSourceClient(claimed.source).fetchCurrentValuation(
      claimed.property,
      config,
    );

    if (!result) {
      await markOfficialValuationHydrationFailed({
        jobId: claimed.id,
        error: 'Official valuation source returned no valuation',
      });
      await markOfficialValuationSourceSuccess(claimed.source);
      return { status: 'failed', reason: 'source_returned_no_valuation' };
    }

    const maintenanceRequest = await markOfficialValuationHydrationSucceeded(claimed.id, result);
    await markOfficialValuationSourceSuccess(claimed.source);
    try {
      await requestLatestListingsRefresh({
        requestedBy: 'official-valuation',
        batchId: maintenanceRequest.batchId,
      });
    } catch (error) {
      options.logger?.warn(
        {
          jobId: claimed.id,
          source: claimed.source,
          maintenanceBatchId: maintenanceRequest.batchId,
          error: errorMessage(error),
        },
        'Failed to enqueue latest listings refresh after official valuation hydration',
      );
    }
    try {
      await requestPropertyTileSnapshotRefresh({ reason: 'official-valuation' });
    } catch (error) {
      options.logger?.warn(
        {
          jobId: claimed.id,
          source: claimed.source,
          maintenanceBatchId: maintenanceRequest.batchId,
          error: errorMessage(error),
        },
        'Failed to request property tile snapshot refresh after official valuation hydration',
      );
    }
    return {
      status: 'completed',
      valuation: result.valuation,
      valuationYear: result.valuationYear,
    };
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof OfficialValuationUnsupportedError || error instanceof OfficialValuationNotFoundError) {
      await markOfficialValuationHydrationFailed({ jobId: claimed.id, error: message });
      await markOfficialValuationSourceFailure({ source: claimed.source, error: message });
      return { status: 'failed', reason: message };
    }

    const retryAt = error instanceof OfficialValuationRateLimitError ? error.retryAt : undefined;
    await markOfficialValuationHydrationRetryable({
      jobId: claimed.id,
      source: claimed.source,
      attemptCount: claimed.attemptCount,
      error: message,
      nextAttemptAt: retryAt,
    });
    await markOfficialValuationSourceFailure({
      source: claimed.source,
      error: message,
      rateLimited: error instanceof OfficialValuationRateLimitError,
      retryAt,
    });
    options.logger?.warn(
      { jobId: claimed.id, source: claimed.source, error: message },
      'Official valuation hydration will retry',
    );
    return {
      status: 'retryable',
      reason: message,
      nextAttemptAt: (retryAt ?? new Date()).toISOString(),
    };
  } finally {
    try {
      await releaseOfficialValuationSourceRequest(claimed.source);
    } catch (error) {
      options.logger?.error(
        { jobId: claimed.id, source: claimed.source, error: errorMessage(error) },
        'Failed to release official valuation source reservation',
      );
    }
  }
}

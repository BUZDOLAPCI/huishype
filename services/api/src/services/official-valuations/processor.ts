import {
  OfficialValuationNotFoundError,
  OfficialValuationRateLimitError,
  OfficialValuationTemporarySourceError,
  OfficialValuationUnsupportedError,
} from './errors.js';
import { getOfficialValuationSourceConfig } from './registry.js';
import type { OfficialValuationSource } from './contracts.js';
import type { OfficialValuationSourceRequestRuntime } from './source-client.js';
import { getOfficialValuationSourceClient } from './source-client.js';
import {
  claimOfficialValuationHydrationJob,
  markOfficialValuationHydrationFailed,
  markOfficialValuationHydrationRetryable,
  markOfficialValuationHydrationSucceeded,
  markOfficialValuationSourceRateLimited,
  markOfficialValuationSourceSuccess,
  markOfficialValuationSourceTemporaryFailure,
  releaseOfficialValuationSourceRequest,
  reserveOfficialValuationSourceRequest,
  type OfficialValuationSourceObservedHeaders,
} from './store.js';
import { requestLatestListingsRefresh } from '../ingest/queue.js';
import { safeRequestPropertyTilePyramidBuild } from '../property-tile-pyramid.js';

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

function parseRetryAt(response: Response): Date | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return new Date(Date.now() + seconds * 1_000);
    }

    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }

  const reset =
    response.headers.get('x-rate-limit-reset') ??
    response.headers.get('Kadaster-RateLimit-DayLimit-Reset');
  if (!reset) {
    return undefined;
  }

  const resetNumber = /^\d+$/.test(reset) ? Number.parseInt(reset, 10) : NaN;
  if (Number.isFinite(resetNumber)) {
    return new Date(resetNumber > 10_000_000_000 ? resetNumber : resetNumber * 1_000);
  }

  const resetDate = Date.parse(reset);
  return Number.isFinite(resetDate) ? new Date(resetDate) : undefined;
}

function observedHeaders(response: Response): OfficialValuationSourceObservedHeaders {
  return {
    retryAfter: response.headers.get('retry-after'),
    rateLimitReset:
      response.headers.get('x-rate-limit-reset') ??
      response.headers.get('Kadaster-RateLimit-DayLimit-Reset'),
  };
}

function createSourceRequestRuntime(): OfficialValuationSourceRequestRuntime {
  return {
    async fetchJson(
      source: OfficialValuationSource,
      request: () => Promise<Response>,
    ): Promise<Record<string, unknown>> {
      const reservation = await reserveOfficialValuationSourceRequest(source);
      if (!reservation.allowed) {
        throw new OfficialValuationRateLimitError(reservation.reason, reservation.nextAttemptAt);
      }

      try {
        const response = await request();
        const headers = observedHeaders(response);
        if (response.status === 429) {
          const retryAt = parseRetryAt(response);
          const nextAttemptAt = await markOfficialValuationSourceRateLimited({
            source,
            error: 'WOZ source rate limited the request',
            retryAt,
            observedStatus: response.status,
            observedHeaders: headers,
          });
          throw new OfficialValuationRateLimitError(
            'WOZ source rate limited the request',
            nextAttemptAt,
            {
              observedStatus: response.status,
              observedHeaders: {
                'retry-after': headers.retryAfter ?? null,
                'x-rate-limit-reset': headers.rateLimitReset ?? null,
              },
            },
          );
        }

        if (response.status === 404) {
          await markOfficialValuationSourceSuccess(source, {
            status: response.status,
            headers,
          });
          throw new OfficialValuationNotFoundError('WOZ valuation not found for property', {
            observedStatus: response.status,
          });
        }

        if (!response.ok) {
          const nextAttemptAt = await markOfficialValuationSourceTemporaryFailure({
            source,
            error: `WOZ source returned HTTP ${response.status}`,
            observedStatus: response.status,
            observedHeaders: headers,
          });
          throw new OfficialValuationTemporarySourceError(
            `WOZ source returned HTTP ${response.status}`,
            { observedStatus: response.status },
            nextAttemptAt,
          );
        }

        await markOfficialValuationSourceSuccess(source, {
          status: response.status,
          headers,
        });
        return (await response.json()) as Record<string, unknown>;
      } catch (error) {
        if (
          error instanceof OfficialValuationRateLimitError ||
          error instanceof OfficialValuationNotFoundError ||
          error instanceof OfficialValuationTemporarySourceError
        ) {
          throw error;
        }

        const nextAttemptAt = await markOfficialValuationSourceTemporaryFailure({
          source,
          error: errorMessage(error),
        });
        throw new OfficialValuationTemporarySourceError(
          errorMessage(error),
          {},
          nextAttemptAt,
        );
      } finally {
        await releaseOfficialValuationSourceRequest(source);
      }
    },
  };
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

  try {
    const result = await getOfficialValuationSourceClient(claimed.source).fetchCurrentValuation(
      claimed.property,
      config,
      createSourceRequestRuntime(),
    );

    if (!result) {
      await markOfficialValuationHydrationFailed({
        jobId: claimed.id,
        error: 'Official valuation source returned no valuation',
      });
      return { status: 'failed', reason: 'source_returned_no_valuation' };
    }

    const maintenanceRequest = await markOfficialValuationHydrationSucceeded(claimed.id, result);
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
    await safeRequestPropertyTilePyramidBuild(
      { reason: 'official-valuation' },
      options.logger ?? { warn: () => undefined },
      {
        jobId: claimed.id,
        source: claimed.source,
        maintenanceBatchId: maintenanceRequest.batchId,
      },
    );
    return {
      status: 'completed',
      valuation: result.valuation,
      valuationYear: result.valuationYear,
    };
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof OfficialValuationUnsupportedError || error instanceof OfficialValuationNotFoundError) {
      await markOfficialValuationHydrationFailed({ jobId: claimed.id, error: message });
      return { status: 'failed', reason: message };
    }

    const retryAt = error instanceof OfficialValuationRateLimitError ? error.retryAt : undefined;
    const temporaryRetryAt =
      error instanceof OfficialValuationTemporarySourceError ? error.retryAt : undefined;
    await markOfficialValuationHydrationRetryable({
      jobId: claimed.id,
      source: claimed.source,
      attemptCount: claimed.attemptCount,
      error: message,
      nextAttemptAt: retryAt ?? temporaryRetryAt,
    });
    options.logger?.warn(
      { jobId: claimed.id, source: claimed.source, error: message },
      'Official valuation hydration will retry',
    );
    return {
      status: 'retryable',
      reason: message,
      nextAttemptAt: (retryAt ?? temporaryRetryAt ?? new Date()).toISOString(),
    };
  }
}

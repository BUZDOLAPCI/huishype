import { enqueueOfficialValuationHydration } from './queue.js';
import { requestLatestListingsRefresh } from '../ingest/queue.js';
import {
  acceptOfficialValuationHydrationRequest,
  getCurrentOfficialValuationStatus,
  type HydrationRequestResult,
} from './store.js';
import type { HydrateOfficialValuationRequest } from './contracts.js';
import { safeRequestPropertyTilePyramidBuild } from '../property-tile-pyramid.js';

function isOfficialValuationHydrationQueueDisabled(): boolean {
  return process.env.PLAYWRIGHT_DISABLE_OFFICIAL_VALUATION_HYDRATION_QUEUE === '1';
}

export async function requestOfficialValuationHydration(input: {
  propertyId: string;
  request: HydrateOfficialValuationRequest;
  submittedByUserId: string | null;
  logger?: {
    warn(payload: Record<string, unknown>, message: string): void;
  };
}): Promise<HydrationRequestResult | null> {
  if (isOfficialValuationHydrationQueueDisabled()) {
    const current = await getCurrentOfficialValuationStatus({
      propertyId: input.propertyId,
      source: input.request.source,
    });

    if (!current) {
      return null;
    }

    const hasCurrentVerifiedValuation =
      current.officialValuationVerified &&
      current.officialValuationYear === current.expectedValuationYear;

    return {
      status: hasCurrentVerifiedValuation ? 'already_cached' : 'pending',
      propertyId: current.propertyId,
      source: current.source,
      valuationYear: current.expectedValuationYear,
      cachedValuation: current.officialValuation,
      cachedValuationYear: current.officialValuationYear,
      cachedVerified: current.officialValuationVerified,
      job: current.job
        ? {
            id: current.job.id,
            state: current.job.state,
            nextAttemptAt: current.job.nextAttemptAt,
          }
        : null,
      dispatchJob: null,
      maintenanceRequest: null,
    };
  }

  const result = await acceptOfficialValuationHydrationRequest({
    propertyId: input.propertyId,
    source: input.request.source,
    observed: null,
    submittedByUserId: input.submittedByUserId,
  });

  if (result?.maintenanceRequest) {
    try {
      await requestLatestListingsRefresh({
        requestedBy: 'official-valuation',
        batchId: result.maintenanceRequest.batchId,
      });
    } catch (error) {
      input.logger?.warn(
        {
          err: error,
          propertyId: result.propertyId,
          source: result.source,
          maintenanceBatchId: result.maintenanceRequest.batchId,
        },
        'Failed to enqueue latest listings refresh after official valuation cache update',
      );
    }
    await safeRequestPropertyTilePyramidBuild(
      { reason: 'official-valuation' },
      input.logger ?? { warn: () => undefined },
      {
        propertyId: result.propertyId,
        source: result.source,
        maintenanceBatchId: result.maintenanceRequest.batchId,
      },
    );
  }

  if (result?.dispatchJob) {
    await enqueueOfficialValuationHydration(result.dispatchJob);
  }

  return result;
}

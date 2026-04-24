import { enqueueOfficialValuationHydration } from './queue.js';
import { requestLatestListingsRefresh } from '../ingest/queue.js';
import {
  acceptOfficialValuationHydrationRequest,
  type HydrationRequestResult,
} from './store.js';
import {
  getClientObservedValuation,
  type HydrateOfficialValuationRequest,
} from './contracts.js';

export async function requestOfficialValuationHydration(input: {
  propertyId: string;
  request: HydrateOfficialValuationRequest;
  submittedByUserId: string | null;
  logger?: {
    warn(payload: Record<string, unknown>, message: string): void;
  };
}): Promise<HydrationRequestResult | null> {
  const result = await acceptOfficialValuationHydrationRequest({
    propertyId: input.propertyId,
    source: input.request.source,
    observed: getClientObservedValuation(input.request),
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
  }

  if (result?.dispatchJob) {
    await enqueueOfficialValuationHydration(result.dispatchJob);
  }

  return result;
}

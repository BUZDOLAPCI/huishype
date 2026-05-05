import type { ListingCandidateHandoff } from '../../db/index.js';
import {
  CandidateHandoffPermanentError,
  deliverCandidateHandoffToSourceService,
} from './source-service-client.js';
import {
  DEFAULT_CANDIDATE_HANDOFF_MAX_ATTEMPTS,
  claimCandidateHandoff,
  markCandidateHandoffDelivered,
  markCandidateHandoffFailed,
} from './store.js';

type ProcessorLogger = {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
};

export type CandidateHandoffProcessorDependencies = {
  claimCandidateHandoff: typeof claimCandidateHandoff;
  deliverCandidateHandoffToSourceService: typeof deliverCandidateHandoffToSourceService;
  markCandidateHandoffDelivered: typeof markCandidateHandoffDelivered;
  markCandidateHandoffFailed: typeof markCandidateHandoffFailed;
};

const defaultDependencies: CandidateHandoffProcessorDependencies = {
  claimCandidateHandoff,
  deliverCandidateHandoffToSourceService,
  markCandidateHandoffDelivered,
  markCandidateHandoffFailed,
};

export async function processCandidateHandoffJob(options: {
  handoffId: string;
  maxAttempts?: number;
  logger?: ProcessorLogger;
  dependencies?: CandidateHandoffProcessorDependencies;
}): Promise<Record<string, unknown>> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const maxAttempts = options.maxAttempts ?? DEFAULT_CANDIDATE_HANDOFF_MAX_ATTEMPTS;
  const handoff = await dependencies.claimCandidateHandoff(options.handoffId);

  if (!handoff) {
    options.logger?.info({ handoffId: options.handoffId }, 'Candidate handoff was not due for delivery');
    return {
      status: 'noop',
      handoffId: options.handoffId,
    };
  }

  try {
    const response = await dependencies.deliverCandidateHandoffToSourceService(handoff);
    await dependencies.markCandidateHandoffDelivered(handoff.id);
    options.logger?.info(
      {
        handoffId: handoff.id,
        sourceName: handoff.sourceName,
        response,
      },
      'Candidate handoff delivered to source service',
    );
    return {
      status: 'delivered',
      handoffId: handoff.id,
      sourceName: handoff.sourceName,
      attemptCount: handoff.attemptCount,
    };
  } catch (error) {
    const permanent = error instanceof CandidateHandoffPermanentError;
    const state = await dependencies.markCandidateHandoffFailed(
      handoff as Pick<ListingCandidateHandoff, 'id' | 'attemptCount'>,
      error as Error,
      { permanent, maxAttempts },
    );
    const logPayload = {
      handoffId: handoff.id,
      sourceName: handoff.sourceName,
      state,
      attemptCount: handoff.attemptCount,
      error: (error as Error).message,
    };
    if (state === 'dead_letter') {
      options.logger?.error(logPayload, 'Candidate handoff moved to dead letter');
    } else {
      options.logger?.warn(logPayload, 'Candidate handoff delivery failed; retry scheduled');
    }

    return {
      status: state,
      handoffId: handoff.id,
      sourceName: handoff.sourceName,
      attemptCount: handoff.attemptCount,
    };
  }
}

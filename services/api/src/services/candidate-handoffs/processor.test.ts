import { describe, expect, it, jest } from '@jest/globals';
import type { ListingCandidateHandoff } from '../../db/index.js';
import { CandidateHandoffPermanentError, CandidateHandoffTemporaryError } from './source-service-client.js';
import { processCandidateHandoffJob, type CandidateHandoffProcessorDependencies } from './processor.js';

function candidate(overrides: Partial<ListingCandidateHandoff> = {}): ListingCandidateHandoff {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    previewResultId: '00000000-0000-4000-8000-000000000002',
    canonicalListingId: '00000000-0000-4000-8000-000000000003',
    observationId: '00000000-0000-4000-8000-000000000004',
    sourceName: 'funda',
    propertyId: '00000000-0000-4000-8000-000000000005',
    submittedBy: '00000000-0000-4000-8000-000000000006',
    sourceUrlRaw: 'https://www.funda.nl/detail/123/',
    sourceUrlCanonical: 'https://www.funda.nl/detail/123/',
    sourceListingId: '123',
    previewFacts: {},
    matchEvidence: {},
    state: 'pending',
    attemptCount: 1,
    lastAttemptAt: new Date('2026-05-05T10:00:00Z'),
    nextAttemptAt: null,
    lastError: null,
    createdAt: new Date('2026-05-05T09:00:00Z'),
    updatedAt: new Date('2026-05-05T10:00:00Z'),
    ...overrides,
  };
}

function dependencies(overrides: Partial<CandidateHandoffProcessorDependencies> = {}): CandidateHandoffProcessorDependencies {
  return {
    claimCandidateHandoff: jest.fn(async () => candidate()),
    deliverCandidateHandoffToSourceService: jest.fn(async () => ({ state: 'queued' })),
    markCandidateHandoffDelivered: jest.fn(async () => undefined),
    markCandidateHandoffFailed: jest.fn(async () => 'retryable_error' as const),
    ...overrides,
  };
}

describe('candidate handoff processor', () => {
  it('delivers a due handoff and marks it delivered', async () => {
    const claimed = candidate({ id: 'handoff-1' });
    const deps = dependencies({
      claimCandidateHandoff: jest.fn(async () => claimed),
    });

    const result = await processCandidateHandoffJob({
      handoffId: 'handoff-1',
      dependencies: deps,
    });

    expect(result).toMatchObject({
      status: 'delivered',
      handoffId: 'handoff-1',
      sourceName: 'funda',
    });
    expect(deps.deliverCandidateHandoffToSourceService).toHaveBeenCalledWith(claimed);
    expect(deps.markCandidateHandoffDelivered).toHaveBeenCalledWith('handoff-1');
    expect(deps.markCandidateHandoffFailed).not.toHaveBeenCalled();
  });

  it('schedules a retry for temporary source-service failures', async () => {
    const claimed = candidate({ id: 'handoff-2', attemptCount: 2 });
    const error = new CandidateHandoffTemporaryError('source service unavailable');
    const deps = dependencies({
      claimCandidateHandoff: jest.fn(async () => claimed),
      deliverCandidateHandoffToSourceService: jest.fn(async () => {
        throw error;
      }),
    });

    const result = await processCandidateHandoffJob({
      handoffId: 'handoff-2',
      dependencies: deps,
    });

    expect(result).toMatchObject({
      status: 'retryable_error',
      handoffId: 'handoff-2',
    });
    expect(deps.markCandidateHandoffFailed).toHaveBeenCalledWith(
      claimed,
      error,
      { permanent: false, maxAttempts: 5 },
    );
  });

  it('dead-letters permanent source-service rejections', async () => {
    const claimed = candidate({ id: 'handoff-3' });
    const error = new CandidateHandoffPermanentError('unsupported candidate');
    const deps = dependencies({
      claimCandidateHandoff: jest.fn(async () => claimed),
      deliverCandidateHandoffToSourceService: jest.fn(async () => {
        throw error;
      }),
      markCandidateHandoffFailed: jest.fn(async () => 'dead_letter' as const),
    });

    const result = await processCandidateHandoffJob({
      handoffId: 'handoff-3',
      dependencies: deps,
    });

    expect(result).toMatchObject({
      status: 'dead_letter',
      handoffId: 'handoff-3',
    });
    expect(deps.markCandidateHandoffFailed).toHaveBeenCalledWith(
      claimed,
      error,
      { permanent: true, maxAttempts: 5 },
    );
  });
});

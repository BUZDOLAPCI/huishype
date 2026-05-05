import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { config } from '../../config.js';
import type { ListingCandidateHandoff } from '../../db/index.js';
import {
  CandidateHandoffPermanentError,
  CandidateHandoffTemporaryError,
  deliverCandidateHandoffToSourceService,
} from './source-service-client.js';

type MutableSourceServices = {
  fundaBaseUrl: string;
  fundaApiKey: string;
  parariusBaseUrl: string;
  parariusApiKey: string;
};

const sourceServicesConfig = config.sourceServices as MutableSourceServices;
const originalSourceServicesConfig = {
  fundaBaseUrl: config.sourceServices.fundaBaseUrl,
  fundaApiKey: config.sourceServices.fundaApiKey,
  parariusBaseUrl: config.sourceServices.parariusBaseUrl,
  parariusApiKey: config.sourceServices.parariusApiKey,
};

function candidate(overrides: Partial<ListingCandidateHandoff> = {}): ListingCandidateHandoff {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    previewResultId: '00000000-0000-4000-8000-000000000002',
    canonicalListingId: '00000000-0000-4000-8000-000000000003',
    observationId: '00000000-0000-4000-8000-000000000004',
    sourceName: 'funda',
    propertyId: '00000000-0000-4000-8000-000000000005',
    submittedBy: '00000000-0000-4000-8000-000000000006',
    sourceUrlRaw: 'https://www.funda.nl/detail/koop/eindhoven/huis-test/123/',
    sourceUrlCanonical: 'https://www.funda.nl/detail/123/',
    sourceListingId: '123',
    previewFacts: {
      askingPrice: 525000,
      currency: 'EUR',
      listingType: 'sale',
      title: 'Preview title',
      imageUrl: 'https://cdn.example.com/thumb.jpg',
    },
    matchEvidence: {
      propertyId: '00000000-0000-4000-8000-000000000005',
      propertyMatchKind: 'source_exact',
      sourceListingAliases: [{ kind: 'tiny_id', value: '123' }],
    },
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

function jsonResponse(payload: unknown, status = 202): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('candidate handoff source-service client', () => {
  beforeEach(() => {
    sourceServicesConfig.fundaBaseUrl = 'https://funda-source.test';
    sourceServicesConfig.fundaApiKey = 'funda-key';
    sourceServicesConfig.parariusBaseUrl = 'https://pararius-source.test';
    sourceServicesConfig.parariusApiKey = 'pararius-key';
  });

  afterEach(() => {
    sourceServicesConfig.fundaBaseUrl = originalSourceServicesConfig.fundaBaseUrl;
    sourceServicesConfig.fundaApiKey = originalSourceServicesConfig.fundaApiKey;
    sourceServicesConfig.parariusBaseUrl = originalSourceServicesConfig.parariusBaseUrl;
    sourceServicesConfig.parariusApiKey = originalSourceServicesConfig.parariusApiKey;
    jest.restoreAllMocks();
  });

  it('posts Funda handoffs to the listing candidate endpoint', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ state: 'queued', created: true }),
    );

    await deliverCandidateHandoffToSourceService(candidate());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://funda-source.test/api/v1/listings/candidates',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer funda-key' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-test/123/',
      canonicalUrl: 'https://www.funda.nl/detail/123/',
      sourceCandidateId: '00000000-0000-4000-8000-000000000001',
      huishypePreviewId: '00000000-0000-4000-8000-000000000002',
      huishypePropertyId: '00000000-0000-4000-8000-000000000005',
      listingType: 'sale',
      previewFacts: {
        price: 525000,
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      },
      aliases: [{ kind: 'tiny_id', value: '123' }],
    });
  });

  it('posts Pararius handoffs to the candidate intake endpoint', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ state: 'queued', created: true }),
    );

    await deliverCandidateHandoffToSourceService(candidate({
      sourceName: 'pararius',
      sourceUrlRaw: 'https://www.pararius.com/apartment-for-rent/eindhoven/123',
      sourceUrlCanonical: 'https://www.pararius.com/apartment-for-rent/eindhoven/123',
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://pararius-source.test/api/v1/candidates/intake',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer pararius-key' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      previewStatus: 'success',
      sourceName: 'pararius',
      propertyId: '00000000-0000-4000-8000-000000000005',
      sourceCandidateId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('classifies retryable and permanent source-service errors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 503));
    await expect(deliverCandidateHandoffToSourceService(candidate())).rejects.toBeInstanceOf(
      CandidateHandoffTemporaryError,
    );

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'unsupported' }, 422));
    await expect(deliverCandidateHandoffToSourceService(candidate())).rejects.toBeInstanceOf(
      CandidateHandoffPermanentError,
    );
  });
});

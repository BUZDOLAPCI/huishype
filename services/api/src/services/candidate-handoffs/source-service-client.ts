import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import type { ListingCandidateHandoff } from '../../db/index.js';

type SourceName = 'funda' | 'pararius';

const sourceCandidateResponseSchema = z.object({
  state: z.string().min(1).optional(),
  created: z.boolean().optional(),
}).passthrough();

export class CandidateHandoffTemporaryError extends Error {}
export class CandidateHandoffPermanentError extends Error {}

function isSourceName(sourceName: string): sourceName is SourceName {
  return sourceName === 'funda' || sourceName === 'pararius';
}

function getSourceServiceBaseUrl(sourceName: SourceName): string {
  return sourceName === 'funda'
    ? config.sourceServices.fundaBaseUrl
    : config.sourceServices.parariusBaseUrl;
}

function getSourceServiceApiKey(sourceName: SourceName): string {
  return sourceName === 'funda'
    ? config.sourceServices.fundaApiKey.trim()
    : config.sourceServices.parariusApiKey.trim();
}

function getSourceServiceCandidatePath(sourceName: SourceName): string {
  return sourceName === 'funda'
    ? '/api/v1/listings/candidates'
    : '/api/v1/candidates/intake';
}

function getSourceServiceRequestTimeoutMs(): number {
  const timeoutMs = config.sourceServices.requestTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 15_000;
  }
  return Math.floor(timeoutMs);
}

function normalizeListingType(value: unknown): 'sale' | 'rent' | 'unknown' {
  return value === 'sale' || value === 'rent' ? value : 'unknown';
}

function getPreviewString(facts: Record<string, unknown>, primary: string, fallback?: string): string | null {
  const value = facts[primary] ?? (fallback ? facts[fallback] : null);
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getPreviewPrice(facts: Record<string, unknown>): number | null {
  const value = facts.askingPrice ?? facts.price;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPreviewFactsForSource(handoff: ListingCandidateHandoff): Record<string, unknown> {
  const facts = handoff.previewFacts;
  const listingType = normalizeListingType(facts.listingType ?? facts.priceType);
  const thumbnailUrl = getPreviewString(facts, 'thumbnailUrl', 'imageUrl');

  return {
    price: getPreviewPrice(facts),
    currency: getPreviewString(facts, 'currency') ?? 'EUR',
    priceType: listingType,
    title: getPreviewString(facts, 'title'),
    description: getPreviewString(facts, 'description'),
    thumbnailUrl,
    raw: facts,
  };
}

function getAliases(handoff: ListingCandidateHandoff): Array<{ kind: string; value: string }> {
  const aliases = handoff.matchEvidence.sourceListingAliases;
  if (!Array.isArray(aliases)) return [];

  return aliases.filter((alias): alias is { kind: string; value: string } => {
    return Boolean(
      alias
      && typeof alias === 'object'
      && 'kind' in alias
      && 'value' in alias
      && typeof alias.kind === 'string'
      && typeof alias.value === 'string'
      && alias.kind.length > 0
      && alias.value.length > 0,
    );
  });
}

function getIdempotencyKey(handoff: ListingCandidateHandoff): string {
  return createHash('sha256')
    .update([
      handoff.sourceName,
      handoff.id,
      handoff.previewResultId ?? '',
      handoff.sourceUrlCanonical,
    ].join(':'))
    .digest('hex');
}

function buildCandidatePayload(handoff: ListingCandidateHandoff): Record<string, unknown> {
  const listingType = normalizeListingType(handoff.previewFacts.listingType ?? handoff.previewFacts.priceType);
  const common = {
    rawUrl: handoff.sourceUrlRaw,
    normalizedUrl: handoff.sourceUrlCanonical,
    canonicalUrl: handoff.sourceUrlCanonical,
    sourceListingId: handoff.sourceListingId,
    sourceCandidateId: handoff.id,
    huishypePreviewId: handoff.previewResultId,
    listingType,
    submittedAt: handoff.createdAt.toISOString(),
    previewFacts: getPreviewFactsForSource(handoff),
    matchEvidence: handoff.matchEvidence,
    idempotencyKey: getIdempotencyKey(handoff),
  };

  if (handoff.sourceName === 'funda') {
    return {
      ...common,
      sourceListingIdKind: null,
      huishypePropertyId: handoff.propertyId,
      aliases: getAliases(handoff),
    };
  }

  return {
    ...common,
    previewStatus: 'success',
    sourceName: 'pararius',
    propertyId: handoff.propertyId,
  };
}

export async function deliverCandidateHandoffToSourceService(
  handoff: ListingCandidateHandoff,
): Promise<Record<string, unknown>> {
  if (!isSourceName(handoff.sourceName)) {
    throw new CandidateHandoffPermanentError(`Unsupported source service for candidate handoff: ${handoff.sourceName}`);
  }

  const apiKey = getSourceServiceApiKey(handoff.sourceName);
  if (!apiKey) {
    throw new CandidateHandoffTemporaryError(
      `Source service API key is not configured for ${handoff.sourceName}; set ${handoff.sourceName.toUpperCase()}_SOURCE_SERVICE_API_KEY`,
    );
  }

  const path = getSourceServiceCandidatePath(handoff.sourceName);
  const timeoutMs = getSourceServiceRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${getSourceServiceBaseUrl(handoff.sourceName)}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildCandidatePayload(handoff)),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CandidateHandoffTemporaryError(
        `Source service candidate handoff ${path} timed out after ${timeoutMs}ms`,
      );
    }
    throw new CandidateHandoffTemporaryError(`Source service candidate handoff failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = `Source service candidate handoff ${path} returned ${response.status}`;
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new CandidateHandoffTemporaryError(message);
    }
    throw new CandidateHandoffPermanentError(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CandidateHandoffTemporaryError(`Source service candidate handoff ${path} returned invalid JSON`);
  }

  const parsed = sourceCandidateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CandidateHandoffTemporaryError(`Source service candidate handoff ${path} returned an unexpected payload`);
  }

  return parsed.data;
}

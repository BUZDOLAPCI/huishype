import {
  classifyLegacySeededListingValidationOutcome,
  isLegacySeededListingObservationProfileCandidate,
} from '../../services/legacy-seeded-listing-cleanup.js';
import type {
  ListingValidationResponse,
  SupportedListingSourceResolution,
} from '../../services/listing-source-resolution.js';

const supportedResolution: SupportedListingSourceResolution = {
  supported: true,
  sourceName: 'funda',
  rawUrl: 'https://www.funda.nl/detail/12345678/',
  canonicalUrl: 'https://www.funda.nl/detail/12345678/',
  sourceListingId: '12345678',
  sourceListingIdKind: 'tiny_id',
  aliases: [{ kind: 'tiny_id', value: '12345678' }],
  listingPath: '/detail/12345678/',
  reasonCode: null,
};

function validation(overrides: Partial<ListingValidationResponse>): ListingValidationResponse {
  return {
    state: 'matched',
    sourceName: 'funda',
    rawUrl: supportedResolution.rawUrl,
    canonicalUrl: supportedResolution.canonicalUrl,
    sourceListingId: supportedResolution.sourceListingId,
    sourceListingIdKind: supportedResolution.sourceListingIdKind,
    aliases: supportedResolution.aliases,
    ...overrides,
  };
}

describe('legacy seeded listing cleanup guards', () => {
  it('selects only legacy seed observation profiles', () => {
    expect(isLegacySeededListingObservationProfileCandidate({
      hasLegacySeedEvidence: true,
      hasIngestBackedEvidence: false,
      hasNonLegacyEvidence: false,
    })).toBe(true);

    expect(isLegacySeededListingObservationProfileCandidate({
      hasLegacySeedEvidence: true,
      hasIngestBackedEvidence: true,
      hasNonLegacyEvidence: false,
    })).toBe(false);

    expect(isLegacySeededListingObservationProfileCandidate({
      hasLegacySeedEvidence: true,
      hasIngestBackedEvidence: false,
      hasNonLegacyEvidence: true,
    })).toBe(false);
  });

  it('applies only strong source-backed validation outcomes', () => {
    expect(classifyLegacySeededListingValidationOutcome(
      validation({ state: 'matched', sourceStatus: 'available' }),
      supportedResolution,
    )).toMatchObject({ action: 'apply', reason: 'matched_status' });

    expect(classifyLegacySeededListingValidationOutcome(
      validation({ state: 'not_found', sourceStatus: 'not_found' }),
      supportedResolution,
    )).toMatchObject({ action: 'apply', reason: 'not_found' });

    expect(classifyLegacySeededListingValidationOutcome(
      validation({
        state: 'invalid',
        sourceStatus: 'invalid',
        matchedPropertyEvidence: { matchKind: 'source_mismatch' },
      }),
      supportedResolution,
    )).toMatchObject({ action: 'apply', reason: 'explicit_property_mismatch' });
  });

  it('skips temporary and weak outcomes', () => {
    for (const state of ['blocked', 'parser_error', 'retryable_error', 'unsupported'] as const) {
      expect(classifyLegacySeededListingValidationOutcome(
        validation({ state }),
        supportedResolution,
      )).toMatchObject({ action: 'skip', reason: state });
    }

    expect(classifyLegacySeededListingValidationOutcome(
      validation({ state: 'matched', sourceStatus: 'unknown' }),
      supportedResolution,
    )).toMatchObject({ action: 'skip', reason: 'matched_without_strong_status:unknown' });

    expect(classifyLegacySeededListingValidationOutcome(
      validation({
        state: 'invalid',
        sourceStatus: 'invalid',
        matchedPropertyEvidence: { matchKind: 'source_unmatched' },
      }),
      supportedResolution,
    )).toMatchObject({ action: 'skip', reason: 'invalid' });
  });
});

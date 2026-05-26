import { describe, expect, it } from '@jest/globals';
import { ingestBatchRequestSchema } from './contracts.js';
import { encodeOpaqueIngestCursor } from './cursor.js';

function cursor(listingKey: string): string {
  return encodeOpaqueIngestCursor({
    changedAt: '2026-04-06T13:00:00.000Z',
    listingKey,
  });
}

describe('ingest batch contracts', () => {
  it('applies candidate relaxed validation row-by-row in mixed batches', () => {
    const parsed = ingestBatchRequestSchema.safeParse({
      sourceName: 'funda',
      idempotencyKey: 'mixed-candidate-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('mixed-candidate-valid'),
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/candidate/1/',
          mirrorListingId: 'candidate-row',
          sourceCandidateId: 'candidate-1',
          reasonCode: 'validation_pending',
          matchEvidence: { source: 'candidate-preview', score: 0.72 },
          askingPrice: null,
          priceType: 'unknown',
          status: 'active',
        },
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/mirror/1/',
          mirrorListingId: 'mirror-row',
          askingPrice: 475000,
          priceType: 'sale',
          status: 'active',
          address: {
            countryCode: 'NL',
            street: 'Mixed Cursorlaan',
            postalCode: '5611AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.listings?.[0]).toMatchObject({
      reasonCode: 'validation_pending',
      matchEvidence: { source: 'candidate-preview', score: 0.72 },
    });
  });

  it('does not let one candidate row bypass validation for normal mirror rows', () => {
    const parsed = ingestBatchRequestSchema.safeParse({
      sourceName: 'funda',
      idempotencyKey: 'mixed-candidate-invalid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('mixed-candidate-invalid'),
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/candidate/2/',
          mirrorListingId: 'candidate-row',
          sourceCandidateId: 'candidate-2',
          askingPrice: null,
          priceType: 'unknown',
          status: 'active',
        },
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/mirror/2/',
          mirrorListingId: 'mirror-row',
          askingPrice: 475000,
          priceType: 'unknown',
          status: 'active',
        },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['listings', 1, 'priceType'],
      }),
      expect.objectContaining({
        path: ['listings', 1, 'address'],
      }),
    ]));
  });

  it('accepts addressless terminal lifecycle evidence with source identity only', () => {
    const parsed = ingestBatchRequestSchema.safeParse({
      sourceName: 'funda',
      idempotencyKey: 'terminal-identity-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('terminal-identity-valid'),
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/terminal/12345678/',
          canonicalUrl: 'https://www.funda.nl/detail/12345678/',
          mirrorListingId: 'terminal-row',
          sourceListingId: '12345678',
          askingPrice: null,
          priceType: 'unknown',
          lifecycleStatus: 'not_found',
          status: 'active',
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('still rejects active addressless mirror rows without a complete address', () => {
    const parsed = ingestBatchRequestSchema.safeParse({
      sourceName: 'funda',
      idempotencyKey: 'active-addressless-invalid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('active-addressless-invalid'),
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/active/12345679/',
          canonicalUrl: 'https://www.funda.nl/detail/12345679/',
          mirrorListingId: 'active-addressless-row',
          sourceListingId: '12345679',
          askingPrice: 475000,
          priceType: 'sale',
          lifecycleStatus: 'available',
          status: 'active',
        },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['listings', 0, 'address'] }),
    ]));
  });

  it('accepts source-service provenance on batches and individual observations', () => {
    const parsed = ingestBatchRequestSchema.parse({
      sourceName: 'funda',
      idempotencyKey: 'provenance-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('provenance-valid'),
      sourceProvenance: 'replay',
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/provenance/1/',
          mirrorListingId: 'provenance-row',
          askingPrice: 475000,
          priceType: 'sale',
          sourceProvenance: 'crawler_discovered',
          status: 'active',
          address: {
            countryCode: 'NL',
            street: 'Provenance Cursorlaan',
            postalCode: '5611AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    expect(parsed.sourceProvenance).toBe('replay');
    expect(parsed.listings?.[0]?.sourceProvenance).toBe('crawler_discovered');
  });

  it('normalizes legacy scraper provenance for processor consumption', () => {
    const parsed = ingestBatchRequestSchema.parse({
      sourceName: 'funda',
      idempotencyKey: 'legacy-provenance-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('legacy-provenance-valid'),
      provenance: 'import',
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/provenance/2/',
          mirrorListingId: 'legacy-provenance-row',
          askingPrice: 475000,
          priceType: 'sale',
          provenance: 'crawler_discovered',
          status: 'active',
          address: {
            countryCode: 'NL',
            street: 'Legacy Provenancelaan',
            postalCode: '5611AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    expect(parsed.sourceProvenance).toBe('import');
    expect(parsed.listings?.[0]?.sourceProvenance).toBe('crawler_discovered');
    expect(parsed).not.toHaveProperty('provenance');
    expect(parsed.listings?.[0]).not.toHaveProperty('provenance');
  });

  it('prefers sourceProvenance over legacy provenance when both are present', () => {
    const parsed = ingestBatchRequestSchema.parse({
      sourceName: 'funda',
      idempotencyKey: 'preferred-provenance-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('preferred-provenance-valid'),
      sourceProvenance: 'replay',
      provenance: 'import',
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/provenance/3/',
          mirrorListingId: 'preferred-provenance-row',
          askingPrice: 475000,
          priceType: 'sale',
          sourceProvenance: 'user_submitted',
          provenance: 'crawler_discovered',
          status: 'active',
          address: {
            countryCode: 'NL',
            street: 'Preferred Provenancelaan',
            postalCode: '5611AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    expect(parsed.sourceProvenance).toBe('replay');
    expect(parsed.listings?.[0]?.sourceProvenance).toBe('user_submitted');
  });

  it('accepts source lifecycle dates as dates or ISO datetimes and normalizes to UTC', () => {
    const parsed = ingestBatchRequestSchema.parse({
      sourceName: 'funda',
      idempotencyKey: 'source-lifecycle-dates-valid',
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: cursor('source-lifecycle-dates-valid'),
      listings: [
        {
          sourceUrl: 'https://www.funda.nl/detail/koop/eindhoven/source-dates/12345678/',
          mirrorListingId: 'source-lifecycle-row',
          askingPrice: 475000,
          priceType: 'sale',
          status: 'sold',
          lifecycleStatus: 'sold',
          listedAt: '2026-04-01',
          soldAt: '2026-04-10T13:14:15+02:00',
          withdrawnAt: '2026-04-12T08:00:00Z',
          address: {
            countryCode: 'NL',
            street: 'Source Datelaan',
            postalCode: '5611AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    expect(parsed.listings?.[0]).toMatchObject({
      listedAt: '2026-04-01T00:00:00.000Z',
      soldAt: '2026-04-10T11:14:15.000Z',
      withdrawnAt: '2026-04-12T08:00:00.000Z',
    });
  });
});

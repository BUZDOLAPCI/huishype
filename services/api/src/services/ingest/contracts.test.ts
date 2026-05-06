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
});

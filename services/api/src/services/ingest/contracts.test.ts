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
});

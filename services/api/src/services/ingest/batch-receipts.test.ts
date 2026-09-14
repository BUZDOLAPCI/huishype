import { describe, expect, it } from '@jest/globals';
import { ingestBatchRequestSchema } from './contracts.js';
import { encodeOpaqueIngestCursor } from './cursor.js';
import { ingestBatchPayloadHash, v2BatchReceiptMetadata } from './batch-receipts.js';

const raw = {
  sourceName: 'funda', ingestVersion: 2, writerGeneration: 1,
  idempotencyKey: 'receipt-fixture', batchSequence: 0,
  cursorEnd: encodeOpaqueIngestCursor({ changedAt: '2000-01-01T00:00:01.000Z', listingKey: '1' }),
  records: [{ kind: 'facts', eventId: 'e92cdbcd-8d42-42e9-9b65-7a7b0570e97e', sequence: 1,
    observedAt: '2026-09-01T00:00:00.000Z', collector: 'direct', evidenceStrength: 'detail',
    identity: { sourceListingId: 'source-stable-id', sourceListingIdKind: 'global_id' },
    facts: { askingPrice: null, address: { countryCode: 'NL', houseNumberAddition: null } } }],
};

describe('permanent compact batch proof', () => {
  it('hashes normalized defaults and JSON key order consistently across serialization', () => {
    const first = ingestBatchRequestSchema.parse(raw);
    const reordered = JSON.parse(JSON.stringify(first), (_key, value: unknown) => value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse()) : value);
    expect(ingestBatchPayloadHash(first)).toBe(ingestBatchPayloadHash(reordered));
    expect(ingestBatchPayloadHash(first)).toBe(ingestBatchPayloadHash(ingestBatchRequestSchema.parse({ ...raw, cursorStart: null })));
    expect(v2BatchReceiptMetadata(first)).toEqual({ writerGeneration: 1, firstSequence: 1, lastSequence: 1, payloadHash: ingestBatchPayloadHash(first) });
  });
  it('distinguishes sparse omission, explicit null, changed evidence and transport identity', () => {
    const first = ingestBatchRequestSchema.parse(raw);
    for (const changed of [
      { ...raw, records: [{ ...raw.records[0], facts: { address: raw.records[0]!.facts.address } }] },
      { ...raw, records: [{ ...raw.records[0], observedAt: '2026-09-02T00:00:00.000Z' }] },
      { ...raw, idempotencyKey: 'another-batch' },
    ]) expect(ingestBatchPayloadHash(ingestBatchRequestSchema.parse(changed))).not.toBe(ingestBatchPayloadHash(first));
  });
});

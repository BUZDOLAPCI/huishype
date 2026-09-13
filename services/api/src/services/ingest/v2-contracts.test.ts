import { describe, expect, it } from '@jest/globals';
import { ingestBatchRequestSchema } from './contracts.js';
import { ingestEvidenceV2Schema } from './v2-contracts.js';
import { encodeOpaqueIngestCursor } from './cursor.js';
import { mergeListingFacts } from './field-merge.js';
import { evidencePayloadHash } from './v2-processor.js';
import { validateEvidenceTimes } from './v2-writer.js';

const evidence = {
  eventId: 'event-one', sequence: 1, observedAt: '2026-09-13T10:00:00.000Z',
  collector: 'realtyapi' as const, evidenceStrength: 'inventory' as const,
  identity: { sourceListingId: '123', sourceListingIdKind: 'global_id', aliases: [] },
};
const batch = { sourceName: 'funda', ingestVersion: 2, writerGeneration: 1, idempotencyKey: 'wire-one', batchSequence: 0,
  cursorEnd: encodeOpaqueIngestCursor({ changedAt: '2000-01-01T00:00:01.000Z', listingKey: '00000000000000000001' }) };

describe('Funda v2 evidence contract', () => {
  it('preserves incomplete addresses, unpriced facts and explicit clears separately from omission', () => {
    const value = ingestBatchRequestSchema.parse({ ...batch, records: [{ ...evidence, kind: 'facts', facts: {
      askingPrice: null, address: { latitude: 52, longitude: 5 }, numRooms: 2.5,
    } }] });
    expect(value.records?.[0]).toMatchObject({ facts: { askingPrice: null, address: { latitude: 52, longitude: 5 }, numRooms: 2.5 } });
    expect(value.records?.[0]).not.toHaveProperty('facts.thumbnailUrl');
  });
  it('accepts partial scan references on positive evidence but demands verified complete absence', () => {
    expect(ingestEvidenceV2Schema.parse({ ...evidence, kind: 'sighting', inventoryManifestId: 'partial-scan' })).toHaveProperty('inventoryManifestId', 'partial-scan');
    expect(ingestEvidenceV2Schema.safeParse({ ...evidence, kind: 'absence', inventoryManifestId: 'partial-scan' }).success).toBe(false);
    expect(ingestEvidenceV2Schema.safeParse({ ...evidence, kind: 'absence', inventoryManifest: {
      id: 'scan', scopeKey: 'province', completedAt: evidence.observedAt, coverageStatus: 'failed', verified: false,
    } }).success).toBe(false);
  });
  it('rejects untyped aliases, mixed versions, sequence gaps and fabricated future observation clocks', () => {
    expect(ingestEvidenceV2Schema.safeParse({ ...evidence, identity: { ...evidence.identity, sourceListingIdKind: 'whatever' }, kind: 'sighting' }).success).toBe(false);
    expect(ingestBatchRequestSchema.safeParse({ ...batch, records: [
      { ...evidence, kind: 'sighting' }, { ...evidence, eventId: 'two', sequence: 3, kind: 'sighting' },
    ] }).success).toBe(false);
    const parsed = ingestBatchRequestSchema.parse({ ...batch, records: [{ ...evidence, kind: 'sighting' }] });
    expect(() => validateEvidenceTimes(parsed, new Date('2026-09-13T09:50:00Z'))).toThrow('clock skew');
  });
  it('merges each address field, preserves omissions, permits explicit clears and rejects stale overwrites', () => {
    const first = mergeListingFacts({}, {}, { askingPrice: 500000, thumbnailUrl: 'https://images.example/home.jpg', address: { street: 'Main', houseNumber: 1 } }, evidence);
    const second = mergeListingFacts(first.facts, first.fieldEvidence, { askingPrice: null, address: { postalCode: '1234AB' } }, { ...evidence, eventId: 'two', observedAt: '2026-09-14T10:00:00Z' });
    expect(second.facts).toMatchObject({ askingPrice: null, thumbnailUrl: 'https://images.example/home.jpg', address: { street: 'Main', houseNumber: 1, postalCode: '1234AB' } });
    const stale = mergeListingFacts(second.facts, second.fieldEvidence, { askingPrice: 100, address: { street: 'Wrong' } }, { ...evidence, observedAt: '2026-09-12T10:00:00Z' });
    expect(stale.facts).toEqual(second.facts);
  });
  it('uses evidence strength for same-time field facts and stable content hashes for replays', () => {
    const first = mergeListingFacts({}, {}, { askingPrice: 500000 }, { ...evidence, evidenceStrength: 'detail' });
    expect(mergeListingFacts(first.facts, first.fieldEvidence, { askingPrice: 100 }, { ...evidence, eventId: 'zzz' }).facts.askingPrice).toBe(500000);
    const record = ingestEvidenceV2Schema.parse({ ...evidence, kind: 'facts', facts: { askingPrice: 500000 } });
    expect(evidencePayloadHash(record)).toEqual(evidencePayloadHash({ ...record }));
    expect(evidencePayloadHash(record)).not.toEqual(evidencePayloadHash(ingestEvidenceV2Schema.parse({ ...record, facts: { askingPrice: 100 } })));
  });
  it('permanently normalizes Pararius v1 completion as a local export without verified remote absence', () => {
    const parsed = ingestBatchRequestSchema.parse({ sourceName: 'pararius', idempotencyKey: 'v1', batchSequence: 0, cursorEnd: batch.cursorEnd,
      completions: [{ scopeKey: 'all', sourceRunCompletedAt: evidence.observedAt, sourceHighWatermark: evidence.observedAt, coverageStatus: 'complete' }],
    });
    expect(parsed.completions?.[0]).toMatchObject({ coverageStatus: 'partial', diagnostics: { remoteCoverageVerified: false, upstreamCoverageStatus: 'complete' } });
    expect(ingestBatchRequestSchema.parse(parsed)).toEqual(parsed);
  });
});

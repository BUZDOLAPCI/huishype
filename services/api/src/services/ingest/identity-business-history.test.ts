import { describe, expect, it } from '@jest/globals';
import { businessHistoryFields, businessHistorySampleKey } from './identity-business-history.js';
import { ingestEvidenceV2Schema } from './v2-contracts.js';

function record(patch: Record<string, unknown>) {
  return ingestEvidenceV2Schema.parse({ eventId: 'receipt', sequence: 1,
    observedAt: '2026-01-01T00:00:00Z', collector: 'realtyapi', evidenceStrength: 'detail',
    identity: { sourceListingId: 'source-listing', sourceListingIdKind: 'global_id', aliases: [] }, ...patch });
}

describe('actual identity business field samples', () => {
  it('keeps sparse economics and address changes without materializing omitted fields', () => {
    expect(businessHistoryFields(record({ kind: 'facts', facts: {
      askingPrice: 500, currency: 'EUR', address: { postalCode: '1234AB', houseNumberAddition: null },
    } }))).toEqual([
      { fieldPath: 'address.postalCode', value: '1234AB' },
      { fieldPath: 'address.houseNumberAddition', value: null },
      { fieldPath: 'askingPrice', value: 500 }, { fieldPath: 'currency', value: 'EUR' },
    ]);
    expect(businessHistoryFields(record({ kind: 'facts', facts: { priceUnit: 'm2', currency: null } })))
      .toEqual([{ fieldPath: 'priceUnit', value: 'm2' }, { fieldPath: 'currency', value: null }]);
  });

  it('records explicit address clears as null samples of all eight components', () => {
    const samples = businessHistoryFields(record({ kind: 'facts', facts: { address: null, askingPrice: null } }));
    expect(samples).toHaveLength(9);
    expect(samples.every(sample => sample.value === null)).toBe(true);
    expect(samples.find(sample => sample.fieldPath === 'address.houseNumberAddition')).toBeDefined();
  });

  it('retains available/conditional samples while absence stays operational evidence', () => {
    expect(businessHistoryFields(record({ kind: 'sighting', availability: 'conditional' })))
      .toEqual([{ fieldPath: 'lifecycleStatus', value: 'conditional' }]);
    expect(businessHistoryFields(record({ kind: 'absence', inventoryManifest: {
      id: 'scan', scopeKey: 'scope', completedAt: '2026-01-01T00:00:00Z', coverageStatus: 'complete', verified: true,
    } }))).toEqual([]);
  });

  it('deduplicates replay receipt IDs by actual field provenance, not transport order', () => {
    const original = { identityId: 'identity', fieldPath: 'askingPrice', value: 500,
      observedAt: '2026-01-01T01:00:00+01:00', collector: 'realtyapi', evidenceStrength: 'detail', eventId: 'old', generation: 1, sequence: 5 };
    const replay = { ...original, observedAt: '2026-01-01T00:00:00Z', eventId: 'new', generation: 2, sequence: 1 };
    expect(businessHistorySampleKey(original)).toBe(businessHistorySampleKey(replay));
    expect(businessHistorySampleKey({ ...original, value: 600 })).not.toBe(businessHistorySampleKey(original));
    expect(businessHistorySampleKey({ ...original, value: null })).not.toBe(businessHistorySampleKey(original));
    expect(businessHistorySampleKey({ ...original, evidenceStrength: 'inventory' })).not.toBe(businessHistorySampleKey(original));
  });
});

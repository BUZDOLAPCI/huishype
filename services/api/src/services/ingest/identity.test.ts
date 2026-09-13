import { describe, expect, it } from '@jest/globals';
import { conflictsWithStablePrimary, normalizeIdentityAliases, planIdentityReconciliation, type LegacyIdentityRow } from './identity.js';

function row(id: string, overrides: Partial<LegacyIdentityRow> = {}): LegacyIdentityRow {
  return {
    listingTable: 'canonical_listings', id, propertyId: 'property-a',
    primaryId: id, primaryIdType: 'tiny_id', aliases: [], status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'), snapshot: { status: 'active' }, ...overrides,
  };
}

describe('typed listing identity reconciliation', () => {
  it('keeps equal digits in distinct ID namespaces distinct', () => {
    expect(planIdentityReconciliation([
      row('tiny', { primaryId: '123' }), row('global', { primaryId: '123', primaryIdType: 'global_id' }),
    ])).toHaveLength(2);
  });

  it('joins only explicit aliases and retains the deterministic canonical survivor', () => {
    const input = [row('b', { aliases: [{ kind: 'global_id', value: 'global' }] }),
      row('a', { primaryId: 'global', primaryIdType: 'global_id' }),
      row('legacy', { listingTable: 'listings', primaryId: 'global', primaryIdType: 'global_id' })];
    const groups = planIdentityReconciliation(input);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.survivor!.id).toBe('a');
    expect(groups[0]!.conflict).toBeNull();
    expect(input.every((entry) => entry.status === 'active')).toBe(true);
  });

  it('accepts explicitly verified tiny-ID aliases for the same global listing', () => {
    const groups = planIdentityReconciliation([
      row('global', { primaryId: 'global', primaryIdType: 'global_id',
        aliases: [{ kind: 'tiny_id', value: 'search-id' }, { kind: 'tiny_id', value: 'detail-id' }] }),
      row('search', { primaryId: 'search-id' }), row('detail', { primaryId: 'detail-id' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.conflict).toBeNull();
  });

  it('quarantines transitive alias links across properties rather than selecting a survivor', () => {
    const groups = planIdentityReconciliation([
      row('a', { aliases: [{ kind: 'global_id', value: 'shared' }] }),
      row('b', { aliases: [{ kind: 'global_id', value: 'shared' }, { kind: 'detail_id', value: 'detail' }] }),
      row('c', { primaryId: 'detail', primaryIdType: 'detail_id', propertyId: 'property-b' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.conflict).toBe('conflicting_property_links');
    expect(groups[0]!.survivor).toBeNull();
  });

  it('does not guess which conflicting factual lifecycle state is true', () => {
    const groups = planIdentityReconciliation([
      row('a', { aliases: [{ kind: 'global_id', value: 'shared' }] }),
      row('b', { primaryId: 'shared', primaryIdType: 'global_id', status: 'sold' }),
    ]);
    expect(groups[0]!.conflict).toBe('conflicting_status_evidence');
    expect(groups[0]!.survivor).toBeNull();
    expect(groups[0]!.rows.map((entry) => entry.status).sort()).toEqual(['active', 'sold']);
  });

  it('preserves genuine relistings even with the same property and reused URL', () => {
    const aliases = [{ kind: 'canonical_path', value: '/detail/koop/example/' }];
    const groups = planIdentityReconciliation([row('old', { aliases, status: 'sold' }), row('new', { aliases })]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.conflict === null)).toBe(true);
  });

  it('does not collapse different global IDs merely because a public ID or URL is reused', () => {
    expect(conflictsWithStablePrimary({ kind: 'global_id', value: 'new-global' }, [
      { kind: 'global_id', value: 'old-global' }, { kind: 'tiny_id', value: 'same-public' },
    ])).toBe(true);
    expect(conflictsWithStablePrimary({ kind: 'global_id', value: 'same-global' }, [
      { kind: 'global_id', value: 'same-global' }, { kind: 'tiny_id', value: 'public-one' }, { kind: 'tiny_id', value: 'public-two' },
    ])).toBe(false);
    const [group] = planIdentityReconciliation([
      row('one', { primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: 'reused' }] }),
      row('two', { primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: 'reused' }] }),
    ]);
    expect(group.conflict).toBe('conflicting_source_identities');
    expect(group.survivor).toBeNull();
  });

  it('retains source-only legacy evidence without inventing a canonical property link', () => {
    const groups = planIdentityReconciliation([row('legacy', { listingTable: 'listings' })]);
    expect(groups[0]!.survivor).toBeNull();
    expect(groups[0]!.rows).toHaveLength(1);
  });

  it('deduplicates exact typed aliases and rejects blank identities', () => {
    expect(normalizeIdentityAliases([{ kind: 'tiny_id', value: ' 1 ' }, { kind: 'tiny_id', value: '1' },
      { kind: 'global_id', value: '1' }])).toEqual([{ kind: 'global_id', value: '1' }, { kind: 'tiny_id', value: '1' }]);
    expect(() => normalizeIdentityAliases([{ kind: 'tiny_id', value: ' ' }])).toThrow('Invalid source identity alias');
  });
});

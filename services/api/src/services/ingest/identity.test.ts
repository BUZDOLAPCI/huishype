import { describe, expect, it } from '@jest/globals';
import type { DbTransaction } from '../../db/index.js';
import { sourceListingIdentities, sourceListingAliases, sourceIdentityQuarantines } from '../../db/schema.js';
import { conflictsWithStablePrimary, normalizeIdentityAliases, planIdentityReconciliation, resolveSourceListingIdentity, type SourceListingIdentity, type LegacyIdentityRow } from './identity.js';

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


function identityFixture(id: string, primaryId: string): SourceListingIdentity {
  return { id, primaryId, primaryIdType: 'global_id', sourceName: 'funda', canonicalListingId: `canonical-${id}`,
    factsJson: {}, fieldEvidence: {}, lastPositiveObservedAt: null, lastStatusObservedAt: null,
    quarantinedAt: null, quarantineReason: null, createdAt: new Date(0), updatedAt: new Date(0) };
}

/** Script only database reads; any listing/identity update fails these evidence-isolation tests. */
function resolverTransaction(reads: unknown[][], insertedIdentity?: SourceListingIdentity, allowIdentityQuarantine = false) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const pendingReads = [...reads];
  const tx = {
    execute: async () => [],
    select: () => {
      const query = {
        from: () => query, innerJoin: () => query, where: () => query, limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => {
          if (pendingReads.length === 0) throw new Error('Unexpected database read');
          return Promise.resolve(resolve(pendingReads.shift()!));
        },
      };
      return query;
    },
    insert: (table: unknown) => ({ values: (values: unknown) => {
      inserted.push({ table, values });
      return { returning: async () => table === sourceListingIdentities ? [insertedIdentity]
        : table === sourceIdentityQuarantines ? [{ id: 'conflict-audit' }] : [],
        onConflictDoNothing: async () => [] };
    } }),
    update: (table: unknown) => {
      if (allowIdentityQuarantine && table === sourceListingIdentities) return { set: () => ({ where: async () => [] }) };
      throw new Error('Alias ambiguity must not mutate a known listing or identity');
    },
  } as unknown as DbTransaction;
  return { tx, inserted, pendingReads };
}

describe('reused alias evidence isolation', () => {
  const oldIdentity = identityFixture('old-identity', 'old-global');
  const newIdentity = identityFixture('new-identity', 'new-global');
  const oldAliases = [
    { identityId: oldIdentity.id, kind: 'global_id', value: 'old-global' },
    { identityId: oldIdentity.id, kind: 'tiny_id', value: 'reused-public' },
    { identityId: oldIdentity.id, kind: 'canonical_url', value: 'https://www.funda.nl/reused' },
  ];
  const newAliases = [{ identityId: newIdentity.id, kind: 'global_id', value: 'new-global' }];
  const ambiguity = { id: 'ambiguity-audit', reason: 'ambiguous_reused_alias' };

  it('records public alias reuse without quarantining either correctly identified listing', async () => {
    const test = resolverTransaction([
      [{ identity: oldIdentity, kind: 'tiny_id', value: 'reused-public' }], oldAliases, [],
    ], newIdentity);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: 'new-global', primaryIdType: 'global_id',
      aliases: [{ kind: 'tiny_id', value: 'reused-public' }] });
    expect(result).toEqual({ identity: newIdentity, quarantined: false });
    const audit = test.inserted.find(insert => insert.table === sourceIdentityQuarantines);
    expect(audit?.values).toMatchObject({ reason: 'ambiguous_reused_alias',
      identityIds: ['new-identity', 'old-identity'], aliasesJson: [{ kind: 'tiny_id', value: 'reused-public' }] });
    expect(oldIdentity.quarantinedAt).toBeNull();
    expect(newIdentity.quarantinedAt).toBeNull();
    expect(test.pendingReads).toHaveLength(0);
  });

  it('creates a relisting from a tiny primary plus verified global alias without reusing the legacy primary key', async () => {
    const test = resolverTransaction([
      [{ identity: oldIdentity, kind: 'tiny_id', value: 'reused-public' }], oldAliases, [],
    ], newIdentity);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: 'reused-public', primaryIdType: 'tiny_id',
      aliases: [{ kind: 'global_id', value: 'new-global' }] });
    expect(result).toEqual({ identity: newIdentity, quarantined: false });
    expect(test.inserted.find(insert => insert.table === sourceListingIdentities)?.values)
      .toMatchObject({ primaryIdType: 'global_id', primaryId: 'new-global' });
    expect(test.pendingReads).toHaveLength(0);
  });

  it.each([
    ['tiny_id', 'reused-public'], ['canonical_url', 'https://www.funda.nl/reused'],
  ])('holds ambiguous %s-only evidence without changing existing availability', async (kind, value) => {
    const test = resolverTransaction([[{ identity: oldIdentity, kind, value }], oldAliases, [ambiguity]]);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: value, primaryIdType: kind });
    expect(result).toEqual({ identity: oldIdentity, quarantined: true, quarantineId: 'ambiguity-audit', affectedPropertyIds: [] });
    expect(test.inserted).toHaveLength(0);
    expect(oldIdentity.quarantinedAt).toBeNull();
    expect(test.pendingReads).toHaveLength(0);
  });

  it.each(['global_id', 'tiny_id'])('accepts verified new-global evidence with %s primary and keeps the ambiguity audit idempotent', async (primaryIdType) => {
    const test = resolverTransaction([
      [{ identity: oldIdentity, kind: 'tiny_id', value: 'reused-public' },
        { identity: newIdentity, kind: 'global_id', value: 'new-global' }],
      [...oldAliases, ...newAliases], [ambiguity],
    ]);
    const result = await resolveSourceListingIdentity(test.tx, {
      sourceName: 'funda', primaryId: primaryIdType === 'global_id' ? 'new-global' : 'reused-public', primaryIdType,
      aliases: [{ kind: 'tiny_id', value: 'reused-public' }, { kind: 'global_id', value: 'new-global' }],
    });
    expect(result).toEqual({ identity: newIdentity, quarantined: false });
    expect(test.inserted.some(insert => insert.table === sourceIdentityQuarantines)).toBe(false);
    expect(test.pendingReads).toHaveLength(0);
  });

  it('continues to resolve public IDs that have no recorded reuse', async () => {
    const test = resolverTransaction([[{ identity: oldIdentity, kind: 'tiny_id', value: 'reused-public' }], oldAliases, []]);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: 'reused-public', primaryIdType: 'tiny_id' });
    expect(result).toEqual({ identity: oldIdentity, quarantined: false });
    expect(test.pendingReads).toHaveLength(0);
  });
});


describe('contradictory stable identity retry safety', () => {
  it('registers only a fresh quarantined identity primary so later evidence finds its quarantine', async () => {
    const created = { ...identityFixture('fresh', 'global-a'), canonicalListingId: null };
    const quarantined = { ...created, quarantinedAt: new Date(), quarantineReason: 'conflicting_source_identities' };
    const first = resolverTransaction([[], [quarantined]], created, true);
    const result = await resolveSourceListingIdentity(first.tx, { sourceName: 'funda', primaryId: 'global-a', primaryIdType: 'global_id',
      aliases: [{ kind: 'global_id', value: 'global-b' }] });
    expect(result).toMatchObject({ identity: quarantined, quarantined: true });
    expect(first.inserted.filter(insert => insert.table === sourceListingAliases).map(insert => insert.values))
      .toEqual([{ sourceName: 'funda', kind: 'global_id', value: 'global-a', identityId: 'fresh' }]);
    expect(first.pendingReads).toHaveLength(0);

    const later = resolverTransaction([
      [{ identity: quarantined, kind: 'global_id', value: 'global-a' }],
      [{ identityId: 'fresh', kind: 'global_id', value: 'global-a' }],
    ]);
    expect(await resolveSourceListingIdentity(later.tx, { sourceName: 'funda', primaryId: 'global-a', primaryIdType: 'global_id' }))
      .toEqual({ identity: quarantined, quarantined: true });
    expect(later.inserted).toHaveLength(0);
    expect(later.pendingReads).toHaveLength(0);
  });

  it('quarantines contradictory established global/stable owners before public-alias filtering', async () => {
    const first = { ...identityFixture('identity-a', 'global-a'), canonicalListingId: null };
    const second = { ...identityFixture('identity-b', 'global-b'), canonicalListingId: null };
    const quarantined = { ...second, quarantinedAt: new Date(), quarantineReason: 'aliases_resolve_to_multiple_identities' };
    const test = resolverTransaction([
      [{ identity: second, kind: 'global_id', value: 'global-b' }, { identity: first, kind: 'stable_id', value: 'stable-a' }],
      [{ identityId: first.id, kind: 'global_id', value: 'global-a' }, { identityId: first.id, kind: 'stable_id', value: 'stable-a' },
        { identityId: second.id, kind: 'global_id', value: 'global-b' }, { identityId: second.id, kind: 'stable_id', value: 'stable-b' }],
      [quarantined],
    ], undefined, true);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: 'global-b', primaryIdType: 'global_id',
      aliases: [{ kind: 'stable_id', value: 'stable-a' }] });
    expect(result).toMatchObject({ identity: quarantined, quarantined: true });
    expect(test.inserted.some(insert => insert.table === sourceListingIdentities)).toBe(false);
    expect(test.inserted.find(insert => insert.table === sourceIdentityQuarantines)?.values)
      .toMatchObject({ identityIds: ['identity-b', 'identity-a'], reason: 'aliases_resolve_to_multiple_identities' });
    expect(test.pendingReads).toHaveLength(0);
  });

  it('quarantines an established stable owner contradicted by a previously unseen global ID', async () => {
    const owner = { ...identityFixture('identity-a', 'global-a'), canonicalListingId: null };
    const quarantined = { ...owner, quarantinedAt: new Date(), quarantineReason: 'conflicting_source_identities' };
    const test = resolverTransaction([
      [{ identity: owner, kind: 'stable_id', value: 'stable-a' }],
      [{ identityId: owner.id, kind: 'global_id', value: 'global-a' }, { identityId: owner.id, kind: 'stable_id', value: 'stable-a' }],
      [quarantined],
    ], undefined, true);
    const result = await resolveSourceListingIdentity(test.tx, { sourceName: 'funda', primaryId: 'global-new', primaryIdType: 'global_id',
      aliases: [{ kind: 'stable_id', value: 'stable-a' }] });
    expect(result).toMatchObject({ identity: quarantined, quarantined: true });
    expect(test.inserted.some(insert => insert.table === sourceListingIdentities)).toBe(false);
    expect(test.pendingReads).toHaveLength(0);
  });
});

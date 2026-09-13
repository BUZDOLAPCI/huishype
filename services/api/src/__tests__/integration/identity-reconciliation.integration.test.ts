/** Real PostgreSQL fixtures use unique sources and roll back; no production rows or shared seeds are read. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import {
  db, canonicalListings, listings, listingObservations, listingObservationLinks,
  listingPriceObservations, listingCandidateHandoffs, listingSourceAliases,
  sourceListingIdentities, sourceListingAliases, sourceIdentityReconciliations,
  sourceIdentityQuarantines, type DbTransaction,
} from '../../db/index.js';
import { loadLegacyIdentityRows, planIdentityReconciliation, reconcileLegacySourceIdentities } from '../../services/ingest/identity.js';

const fixtureRollback = new Error('identity reconciliation fixture rollback');
const observedAt = new Date('2026-01-01T10:00:00Z');
const largeMarker = 'audit-body-must-remain-in-postgres';

async function fixture(run: (tx: DbTransaction, sourceName: string, propertyId: string) => Promise<void>) {
  await db.transaction(async tx => {
    const sourceName = `identity-${randomUUID()}`;
    const propertyId = await property(tx);
    await run(tx, sourceName, propertyId);
    throw fixtureRollback;
  }).catch(error => { if (error !== fixtureRollback) throw error; });
}

async function property(tx: DbTransaction) {
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,postal_code,city,geometry)
    VALUES (${id}, 'NL', ${`Identity fixture ${id}`}, 1, '1234AB', 'Fixture', ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
  return id;
}

async function canonical(tx: DbTransaction, sourceName: string, propertyId: string, primaryId: string, createdAt: Date) {
  const [row] = await tx.insert(canonicalListings).values({
    sourceName, propertyId, primarySourceListingId: primaryId, canonicalUrl: `https://fixture.invalid/${randomUUID()}`,
    status: 'active', verificationState: 'validated', statusSource: 'mirror', activeEligible: true,
    askingPrice: 500000, description: `${largeMarker}:${primaryId}:${'full-listing-body'.repeat(128)}`,
    thumbnailUrl: 'https://fixture.invalid/preserved-image.jpg', lastMirrorSeenAt: observedAt,
    lastSeenAt: observedAt, lastPositiveAvailabilityAt: observedAt, listedAt: observedAt,
    firstSeenAt: observedAt, createdAt, updatedAt: observedAt,
  }).returning();
  return row!;
}

async function observation(tx: DbTransaction, sourceName: string, propertyId: string, input: {
  sourceId: string; kind: 'global_id' | 'tiny_id'; canonicalId?: string; mirrorId?: string;
  aliases: Array<{ kind: string; value: string }>; at?: Date;
}) {
  const [row] = await tx.insert(listingObservations).values({
    sourceName, propertyId, sourceListingId: input.sourceId, sourceListingIdKind: input.kind,
    sourceListingAliases: input.aliases, origin: 'mirror', propertyMatchKind: 'source_exact',
    sourceStatus: 'available', observedAt: input.at ?? observedAt,
    payload: { mirrorListingId: input.mirrorId, body: `${largeMarker}:${'source-payload'.repeat(128)}` },
  }).returning();
  if (input.canonicalId) await tx.insert(listingObservationLinks).values({
    canonicalListingId: input.canonicalId, listingObservationId: row!.id, linkReason: 'source_identity',
  });
  return row!;
}

function getField(value: Record<string, unknown>, camel: string, snake: string = camel): unknown {
  return value[camel] ?? value[snake];
}

function records(value: unknown): Array<Record<string, unknown>> {
  expect(Array.isArray(value)).toBe(true);
  return value as Array<Record<string, unknown>>;
}

function measuredTransaction(tx: DbTransaction) {
  const stats = { queryCount: 0, maximumResultRows: 0, maximumResultBytes: 0 };
  const record = (result: unknown) => {
    stats.queryCount += 1;
    stats.maximumResultRows = Math.max(stats.maximumResultRows, Array.isArray(result) ? result.length : 0);
    stats.maximumResultBytes = Math.max(stats.maximumResultBytes, Buffer.byteLength(JSON.stringify(result) ?? ''));
  };
  const wrapBuilder = (builder: object): object => new Proxy(builder, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'then' && typeof value === 'function') return (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
        value.call(target, (result: unknown) => { record(result); return resolve(result); }, reject);
      if (typeof value === 'function') return (...args: unknown[]) => {
        const next = value.apply(target, args);
        return next && typeof next === 'object' ? wrapBuilder(next) : next;
      };
      return value;
    },
  });
  const measuredTx = new Proxy(tx, {
    get(target, key, receiver) {
      if (key === 'execute') return async (query: Parameters<DbTransaction['execute']>[0]) => {
        const result = await target.execute(query);
        record(result);
        return result;
      };
      const value = Reflect.get(target, key, receiver);
      if (['select', 'insert', 'update', 'delete'].includes(String(key)) && typeof value === 'function') {
        return (...args: unknown[]) => wrapBuilder(value.apply(target, args));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { measuredTx, stats };
}

async function duplicateFixture(tx: DbTransaction, sourceName: string, propertyId: string) {
  const survivor = await canonical(tx, sourceName, propertyId, 'global-listing', new Date('2025-01-01T00:00:00Z'));
  const duplicate = await canonical(tx, sourceName, propertyId, 'tiny-listing', new Date('2025-02-01T00:00:00Z'));
  const aliases = [{ kind: 'global_id', value: 'global-listing' }, { kind: 'tiny_id', value: 'tiny-listing' }];
  const firstObservation = await observation(tx, sourceName, propertyId, {
    sourceId: 'global-listing', kind: 'global_id', canonicalId: survivor.id, aliases,
  });
  const duplicateObservation = await observation(tx, sourceName, propertyId, {
    sourceId: 'tiny-listing', kind: 'tiny_id', canonicalId: duplicate.id, aliases, mirrorId: 'legacy-listing',
  });
  const [legacy] = await tx.insert(listings).values({ sourceName, propertyId, sourceUrl: `https://fixture.invalid/${randomUUID()}`,
    mirrorListingId: 'legacy-listing', status: 'active', askingPrice: 500000, mirrorLastSeenAt: observedAt,
  }).returning();
  const [survivorPrice, duplicatePrice, movedPrice] = await tx.insert(listingPriceObservations).values([
    { canonicalListingId: survivor.id, listingObservationId: firstObservation.id, price: 500000, priceDate: '2026-01-01' },
    { canonicalListingId: duplicate.id, listingObservationId: duplicateObservation.id, price: 500000, priceDate: '2026-01-01' },
    { canonicalListingId: duplicate.id, listingObservationId: duplicateObservation.id, price: 510000, priceDate: '2026-01-02' },
  ].map(row => ({ ...row, propertyId, sourceName, sourceListingId: 'global-listing', origin: 'mirror' as const,
    eventType: 'asking_price' as const, currency: 'EUR', observedAt,
  }))).returning();
  const [handoff] = await tx.insert(listingCandidateHandoffs).values({
    canonicalListingId: duplicate.id, sourceName, propertyId, observationId: duplicateObservation.id,
    sourceUrlRaw: duplicate.canonicalUrl!, sourceUrlCanonical: duplicate.canonicalUrl!, state: 'queued',
    previewFacts: { fullEvidence: `${largeMarker}:${'candidate-preview'.repeat(128)}` }, matchEvidence: { exactAddress: true },
  }).returning();
  return { survivor, duplicate, legacy: legacy!, duplicateObservation, survivorPrice: survivorPrice!, duplicatePrice: duplicatePrice!, movedPrice: movedPrice!, handoff: handoff! };
}

describe('source identity reconciliation PostgreSQL graph and audit', () => {
  it('projects all alias provenance without transferring full histories or snapshots', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'global-observation', observedAt);
    const [legacy] = await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'mirror-legacy',
      sourceUrl: `https://fixture.invalid/${randomUUID()}`, ogTitle: largeMarker,
    }).returning();
    await observation(tx, sourceName, propertyId, { sourceId: 'global-observation', kind: 'global_id', canonicalId: listing.id,
      mirrorId: 'mirror-legacy', aliases: [{ kind: 'tiny_id', value: 'linked-tiny' }, { kind: 'detail_id', value: 'linked-detail' }],
    });
    await observation(tx, `foreign-${randomUUID()}`, propertyId, { sourceId: 'foreign-global', kind: 'global_id', mirrorId: 'mirror-legacy',
      aliases: [{ kind: 'detail_id', value: 'must-not-cross-sources' }],
    });
    await tx.insert(listingSourceAliases).values([
      { sourceName, primarySourceListingId: 'global-observation', aliasKind: 'relative_path', aliasValue: '/old-alias-index/' },
      { sourceName, primarySourceListingId: 'mirror-legacy', aliasKind: 'tiny_id', aliasValue: 'mirror-legacy' },
    ]);
    const [identity] = await tx.insert(sourceListingIdentities).values({ sourceName, primaryId: 'global-observation',
      primaryIdType: 'global_id', canonicalListingId: listing.id, factsJson: { description: largeMarker },
    }).returning();
    await tx.insert(sourceListingAliases).values([
      { sourceName, identityId: identity!.id, kind: 'global_id', value: 'global-observation' },
      { sourceName, identityId: identity!.id, kind: 'detail_id', value: 'current-identity-detail' },
    ]);
    await tx.insert(sourceIdentityReconciliations).values({ sourceName, listingTable: 'listings', listingId: legacy!.id,
      identityId: identity!.id, survivorListingId: listing.id, reason: 'fixture_prior_audit',
      detailsJson: { aliases: [{ kind: 'detail_id', value: 'prior-audit-detail' }], before: { hugeBody: largeMarker.repeat(1000) } },
    });
    const rows = await loadLegacyIdentityRows(tx, sourceName);
    expect(rows).toHaveLength(2);
    const loadedCanonical = rows.find(row => row.id === listing.id)!;
    const loadedLegacy = rows.find(row => row.id === legacy!.id)!;
    expect(loadedCanonical.primaryIdType).toBe('global_id');
    expect(loadedCanonical.aliases).toEqual(expect.arrayContaining([
      { kind: 'tiny_id', value: 'linked-tiny' }, { kind: 'detail_id', value: 'linked-detail' },
      { kind: 'relative_path', value: '/old-alias-index/' }, { kind: 'detail_id', value: 'current-identity-detail' },
    ]));
    expect(loadedLegacy.primaryIdType).toBe('tiny_id');
    expect(loadedLegacy.aliases).toEqual(expect.arrayContaining([
      { kind: 'tiny_id', value: 'linked-tiny' }, { kind: 'detail_id', value: 'linked-detail' },
      { kind: 'detail_id', value: 'prior-audit-detail' }, { kind: 'tiny_id', value: 'mirror-legacy' },
    ]));
    for (const row of rows) expect(new Set(row.aliases.map(alias => JSON.stringify(alias))).size).toBe(row.aliases.length);
    expect(JSON.stringify(rows)).not.toContain(largeMarker);
    expect(JSON.stringify(rows)).not.toContain('must-not-cross-sources');
  }));

  it('matches typed alias graph semantics across independent listings, reused URLs, and conflicting property links', async () => fixture(async (tx, sourceName, propertyId) => {
    const otherPropertyId = await property(tx);
    const definitions = [
      { primary: 'global-a', kind: 'global_id' as const, propertyId, aliases: [{ kind: 'tiny_id', value: 'tiny-b' }, { kind: 'canonical_url', value: '/reused-url/' }] },
      { primary: 'tiny-b', kind: 'tiny_id' as const, propertyId, aliases: [{ kind: 'global_id', value: 'global-a' }] },
      { primary: 'global-c', kind: 'global_id' as const, propertyId, aliases: [{ kind: 'canonical_url', value: '/reused-url/' }] },
      { primary: 'global-d', kind: 'global_id' as const, propertyId, aliases: [{ kind: 'tiny_id', value: 'tiny-e' }] },
      { primary: 'tiny-e', kind: 'tiny_id' as const, propertyId: otherPropertyId, aliases: [{ kind: 'global_id', value: 'global-d' }] },
      { primary: 'same-digits', kind: 'global_id' as const, propertyId, aliases: [] },
    ];
    for (const [index, entry] of definitions.entries()) {
      const listing = await canonical(tx, sourceName, entry.propertyId, entry.primary, new Date(observedAt.getTime() + index * 1000));
      await observation(tx, sourceName, entry.propertyId, { sourceId: entry.primary, kind: entry.kind, canonicalId: listing.id, aliases: entry.aliases });
    }
    await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'same-digits', sourceUrl: `https://fixture.invalid/${randomUUID()}` });
    await observation(tx, sourceName, propertyId, { sourceId: 'same-digits', kind: 'tiny_id', mirrorId: 'same-digits', aliases: [],
      at: new Date(observedAt.getTime() + 1000),
    });
    const reference = planIdentityReconciliation(await loadLegacyIdentityRows(tx, sourceName));
    expect(reference).toHaveLength(5);
    const report = await reconcileLegacySourceIdentities(tx, sourceName, { dryRun: true });
    expect(report).toMatchObject({ rowsBefore: 7, identityGroups: 5, duplicateGroups: 2, quarantinedGroups: 1 });
    expect(report.identityGroups).toBe(reference.length);
    expect(report.conflicts.map(conflict => conflict.listingIds.sort()).sort())
      .toEqual(reference.filter(group => group.conflict).map(group => group.rows.map(row => row.id).sort()).sort());
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
  }));

  it('preserves full audit bodies and historical rows while moving only safe duplicate references, including on rerun', async () => fixture(async (tx, sourceName, propertyId) => {
    const f = await duplicateFixture(tx, sourceName, propertyId);
    const dryRun = await reconcileLegacySourceIdentities(tx, sourceName, { dryRun: true });
    expect(dryRun).toMatchObject({ rowsBefore: 3, identityGroups: 1, duplicateGroups: 1, quarantinedGroups: 0 });
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ rowsBefore: 3, rowsAfter: 3, canonicalRowsAfter: 2, legacyRowsAfter: 1, quarantinedGroups: 0,
      profile: { fastPathGroups: 0, fastPathLegacyRows: 0 },
    });
    const [after] = await tx.select().from(canonicalListings).where(eq(canonicalListings.id, f.duplicate.id));
    expect(after).toMatchObject({ status: 'active', verificationState: 'invalid', activeEligible: false,
      lastSeenAt: f.duplicate.lastSeenAt, lastPositiveAvailabilityAt: f.duplicate.lastPositiveAvailabilityAt,
      description: f.duplicate.description, askingPrice: f.duplicate.askingPrice,
    });
    const [legacyAfter] = await tx.select().from(listings).where(eq(listings.id, f.legacy.id));
    expect(legacyAfter).toEqual(f.legacy);
    const audit = (await tx.select().from(sourceIdentityReconciliations)
      .where(eq(sourceIdentityReconciliations.sourceName, sourceName))).find(row => row.listingId === f.duplicate.id)!;
    expect(audit.survivorListingId).toBe(f.survivor.id);
    expect(audit.detailsJson.snapshotFormat).toBe('postgres_row_v1');
    const before = audit.detailsJson.before as Record<string, unknown>;
    expect(before.description).toBe(f.duplicate.description);
    expect(getField(before, 'thumbnailUrl', 'thumbnail_url')).toBe(f.duplicate.thumbnailUrl);
    expect(getField(before, 'verificationState', 'verification_state')).toBe('validated');
    expect(records(audit.detailsJson.observationLinksBefore).map(row => getField(row, 'listingObservationId', 'listing_observation_id')))
      .toContain(f.duplicateObservation.id);
    expect(records(audit.detailsJson.priceObservationsBefore).map(row => row.id).sort())
      .toEqual([f.duplicatePrice.id, f.movedPrice.id].sort());
    const priorHandoff = records(audit.detailsJson.candidateHandoffsBefore)[0]!;
    expect(priorHandoff.id).toBe(f.handoff.id);
    expect(getField(priorHandoff, 'previewFacts', 'preview_facts')).toEqual(f.handoff.previewFacts);
    expect(getField(priorHandoff, 'canonicalListingId', 'canonical_listing_id')).toBe(f.duplicate.id);
    const linked = await tx.select().from(listingObservationLinks).where(eq(listingObservationLinks.listingObservationId, f.duplicateObservation.id));
    expect(linked[0]!.canonicalListingId).toBe(f.survivor.id);
    const prices = await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.sourceName, sourceName));
    expect(prices).toHaveLength(3);
    expect(prices.find(row => row.id === f.duplicatePrice.id)!.canonicalListingId).toBe(f.duplicate.id);
    expect(prices.find(row => row.id === f.movedPrice.id)!.canonicalListingId).toBe(f.survivor.id);
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, f.handoff.id)))[0]!.canonicalListingId).toBe(f.survivor.id);
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identity!.canonicalListingId).toBe(f.survivor.id);
    const originalAudit = audit.detailsJson;
    await reconcileLegacySourceIdentities(tx, sourceName);
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(1);
    const auditsAfter = await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName));
    expect(auditsAfter).toHaveLength(2);
    expect(auditsAfter.find(row => row.listingId === f.duplicate.id)!.detailsJson).toEqual(originalAudit);
    expect(await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName))).toHaveLength(0);
  }));

  it('rolls back reconciliation identities, reference moves, and audit writes together', async () => fixture(async (tx, sourceName, propertyId) => {
    const f = await duplicateFixture(tx, sourceName, propertyId);
    const rollback = new Error('reconciliation savepoint rollback');
    await tx.transaction(async savepoint => {
      await reconcileLegacySourceIdentities(savepoint, sourceName);
      expect((await savepoint.select().from(canonicalListings).where(eq(canonicalListings.id, f.duplicate.id)))[0]!.verificationState).toBe('invalid');
      throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, f.duplicate.id)))[0]).toEqual(f.duplicate);
    expect((await tx.select().from(listingObservationLinks).where(eq(listingObservationLinks.listingObservationId, f.duplicateObservation.id)))[0]!.canonicalListingId).toBe(f.duplicate.id);
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, f.handoff.id)))[0]!.canonicalListingId).toBe(f.duplicate.id);
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName))).toHaveLength(0);
  }));

  it('quarantines conflicting property links with full before snapshots and no terminal facts', async () => fixture(async (tx, sourceName, propertyId) => {
    const otherPropertyId = await property(tx);
    const first = await canonical(tx, sourceName, propertyId, 'global-conflict', observedAt);
    const second = await canonical(tx, sourceName, otherPropertyId, 'tiny-conflict', new Date(observedAt.getTime() + 1000));
    const aliases = [{ kind: 'global_id', value: 'global-conflict' }, { kind: 'tiny_id', value: 'tiny-conflict' }];
    await observation(tx, sourceName, propertyId, { sourceId: 'global-conflict', kind: 'global_id', canonicalId: first.id, aliases });
    await observation(tx, sourceName, otherPropertyId, { sourceId: 'tiny-conflict', kind: 'tiny_id', canonicalId: second.id, aliases });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ rowsBefore: 2, rowsAfter: 2, quarantinedGroups: 1 });
    const after = await tx.select().from(canonicalListings).where(eq(canonicalListings.sourceName, sourceName));
    expect(after.every(row => row.status === 'active' && !row.activeEligible && row.verificationState === 'invalid')).toBe(true);
    expect(after.map(row => row.propertyId).sort()).toEqual([propertyId, otherPropertyId].sort());
    const audits = await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName));
    const conflict = audits.find(row => row.reason === 'conflicting_property_links')!;
    expect(conflict.listingIds.sort()).toEqual([first.id, second.id].sort());
    const snapshots = records(conflict.detailsJson.canonicalBefore ?? conflict.detailsJson.before);
    expect(snapshots.map(row => row.description).sort()).toEqual([first.description, second.description].sort());
    const mappings = await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName));
    expect(mappings).toHaveLength(2);
    expect(mappings.every(row => row.survivorListingId === null)).toBe(true);
  }));

  it('fast-paths a fresh canonical singleton without changing facts, timestamps, or observation references', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'fast-global', observedAt);
    const observed = await observation(tx, sourceName, propertyId, { sourceId: 'fast-global', kind: 'global_id', canonicalId: listing.id,
      aliases: [{ kind: 'tiny_id', value: 'fast-tiny' }],
    });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ identityGroups: 1, quarantinedGroups: 0, profile: { fastPathGroups: 1, fastPathLegacyRows: 0 } });
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listing.id)))[0]).toEqual(listing);
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identity).toMatchObject({ primaryId: 'fast-global', primaryIdType: 'global_id', canonicalListingId: listing.id,
      quarantinedAt: null, lastPositiveObservedAt: null, lastStatusObservedAt: null,
    });
    expect((await tx.select().from(listingObservationLinks).where(eq(listingObservationLinks.listingObservationId, observed.id)))[0]!.canonicalListingId).toBe(listing.id);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
  }));

  it('fast-paths legacy-only evidence while retaining an unprojected identity and complete legacy audit', async () => fixture(async (tx, sourceName, propertyId) => {
    const [legacy] = await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'fast-legacy',
      sourceUrl: `https://fixture.invalid/${randomUUID()}`, ogTitle: largeMarker.repeat(100), mirrorLastSeenAt: observedAt,
    }).returning();
    await observation(tx, sourceName, propertyId, { sourceId: 'fast-legacy', kind: 'tiny_id', mirrorId: 'fast-legacy', aliases: [] });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ identityGroups: 1, profile: { fastPathGroups: 1, fastPathLegacyRows: 1 } });
    expect((await tx.select().from(listings).where(eq(listings.id, legacy!.id)))[0]).toEqual(legacy);
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identity).toMatchObject({ primaryId: 'fast-legacy', primaryIdType: 'tiny_id', canonicalListingId: null, lastPositiveObservedAt: null });
    const [audit] = await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName));
    expect(audit).toMatchObject({ listingId: legacy!.id, survivorListingId: null, reason: 'legacy_identity_preserved' });
    expect(getField(audit!.detailsJson.before as Record<string, unknown>, 'ogTitle', 'og_title')).toBe(legacy!.ogTitle);
  }));

  it('fast-paths a fresh canonical/legacy pair once and preserves its identity and immutable full audit on rerun', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'pair-global', observedAt);
    const [legacy] = await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'pair-tiny',
      sourceUrl: `https://fixture.invalid/${randomUUID()}`, ogTitle: largeMarker.repeat(100), askingPrice: 400000,
    }).returning();
    await observation(tx, sourceName, propertyId, { sourceId: 'pair-global', kind: 'global_id', canonicalId: listing.id,
      mirrorId: 'pair-tiny', aliases: [{ kind: 'tiny_id', value: 'pair-tiny' }],
    });
    const first = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(first).toMatchObject({ identityGroups: 1, duplicateGroups: 1, profile: { fastPathGroups: 1, fastPathLegacyRows: 1 } });
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identity!.canonicalListingId).toBe(listing.id);
    const [audit] = await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName));
    expect(audit).toMatchObject({ listingId: legacy!.id, survivorListingId: listing.id, reason: 'legacy_projection_replaced' });
    expect(getField(audit!.detailsJson.before as Record<string, unknown>, 'ogTitle', 'og_title')).toBe(legacy!.ogTitle);
    const second = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(second.profile).toMatchObject({ fastPathGroups: 0, fastPathLegacyRows: 0 });
    expect((await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).map(row => row.id)).toEqual([identity!.id]);
    expect((await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName)))[0]).toEqual(audit);
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listing.id)))[0]).toEqual(listing);
    expect((await tx.select().from(listings).where(eq(listings.id, legacy!.id)))[0]).toEqual(legacy);
  }));

  it('keeps components sharing a reusable weak alias on the evidence-aware slow path', async () => fixture(async (tx, sourceName, propertyId) => {
    for (const id of ['weak-first', 'weak-second']) {
      const listing = await canonical(tx, sourceName, propertyId, id, observedAt);
      await observation(tx, sourceName, propertyId, { sourceId: id, kind: 'global_id', canonicalId: listing.id,
        aliases: [{ kind: 'canonical_url', value: '/reused-public-url/' }],
      });
    }
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ identityGroups: 2, quarantinedGroups: 0, profile: { fastPathGroups: 0, fastPathLegacyRows: 0 } });
    const identities = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identities).toHaveLength(2);
    expect(identities.every(row => row.quarantinedAt === null && row.canonicalListingId !== null)).toBe(true);
    const audits = await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName));
    expect(audits.some(row => row.reason === 'ambiguous_reused_alias')).toBe(true);
  }));

  it.each([false, true])('keeps an existing identity and its aliases on the slow path (already bound: %s)', async alreadyBound => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'existing-global', observedAt);
    await observation(tx, sourceName, propertyId, { sourceId: 'existing-global', kind: 'global_id', canonicalId: listing.id, aliases: [] });
    const [existing] = await tx.insert(sourceListingIdentities).values({ sourceName, primaryId: 'existing-global', primaryIdType: 'global_id',
      canonicalListingId: alreadyBound ? listing.id : null,
    }).returning();
    await tx.insert(sourceListingAliases).values({ sourceName, identityId: existing!.id, kind: 'global_id', value: 'existing-global' });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report.profile).toMatchObject({ fastPathGroups: 0, fastPathLegacyRows: 0 });
    const identities = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ id: existing!.id, canonicalListingId: listing.id, quarantinedAt: null });
  }));

  it('keeps a fresh global listing with an existing public-alias owner on the slow path', async () => fixture(async (tx, sourceName, propertyId) => {
    const [owner] = await tx.insert(sourceListingIdentities).values({ sourceName, primaryId: 'old-owner', primaryIdType: 'global_id' }).returning();
    await tx.insert(sourceListingAliases).values([{ sourceName, identityId: owner!.id, kind: 'global_id', value: 'old-owner' },
      { sourceName, identityId: owner!.id, kind: 'tiny_id', value: 'owned-public' }]);
    const listing = await canonical(tx, sourceName, propertyId, 'new-owner', observedAt);
    await observation(tx, sourceName, propertyId, { sourceId: 'new-owner', kind: 'global_id', canonicalId: listing.id,
      aliases: [{ kind: 'tiny_id', value: 'owned-public' }],
    });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ quarantinedGroups: 0, profile: { fastPathGroups: 0, fastPathLegacyRows: 0 } });
    const identities = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identities).toHaveLength(2);
    expect(identities.find(row => row.id === owner!.id)).toMatchObject({ quarantinedAt: null, canonicalListingId: null });
    expect(identities.find(row => row.primaryId === 'new-owner')).toMatchObject({ canonicalListingId: listing.id, quarantinedAt: null });
  }));

  it.each(['property', 'stable'])('keeps a canonical/legacy component with a %s conflict off the fast path', async conflictKind => fixture(async (tx, sourceName, propertyId) => {
    const legacyPropertyId = conflictKind === 'property' ? await property(tx) : propertyId;
    const listing = await canonical(tx, sourceName, propertyId, 'conflict-global-a', observedAt);
    const legacyPrimary = conflictKind === 'stable' ? 'conflict-global-b' : 'conflict-tiny';
    const [legacy] = await tx.insert(listings).values({ sourceName, propertyId: legacyPropertyId, mirrorListingId: legacyPrimary,
      sourceUrl: `https://fixture.invalid/${randomUUID()}`,
    }).returning();
    await observation(tx, sourceName, propertyId, { sourceId: 'conflict-global-a', kind: 'global_id', canonicalId: listing.id,
      aliases: [{ kind: 'tiny_id', value: 'conflict-tiny' }],
    });
    await observation(tx, sourceName, legacyPropertyId, { sourceId: legacyPrimary, kind: conflictKind === 'stable' ? 'global_id' : 'tiny_id',
      mirrorId: legacyPrimary, aliases: conflictKind === 'stable' ? [{ kind: 'tiny_id', value: 'conflict-tiny' }]
        : [{ kind: 'global_id', value: 'conflict-global-a' }],
    });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ identityGroups: 1, quarantinedGroups: 1, profile: { fastPathGroups: 0, fastPathLegacyRows: 0 } });
    expect(report.conflicts[0]!.reason).toBe(conflictKind === 'property' ? 'conflicting_property_links' : 'conflicting_source_identities');
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listing.id)))[0]).toMatchObject({ status: 'active', verificationState: 'invalid' });
    expect((await tx.select().from(listings).where(eq(listings.id, legacy!.id)))[0]).toEqual(legacy);
  }));

  it('keeps reused weak primary identifiers off the fast path even when strong graph edges separate them', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'same-weak-primary', observedAt);
    await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'same-weak-primary', sourceUrl: `https://fixture.invalid/${randomUUID()}` });
    await observation(tx, sourceName, propertyId, { sourceId: 'weak-primary-global-a', kind: 'global_id', canonicalId: listing.id, aliases: [] });
    await observation(tx, sourceName, propertyId, { sourceId: 'weak-primary-global-b', kind: 'global_id', mirrorId: 'same-weak-primary', aliases: [] });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ identityGroups: 2, quarantinedGroups: 0, profile: { fastPathGroups: 0, fastPathLegacyRows: 0 } });
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(2);
  }));

  it('routes valid non-ASCII alias kinds through the normal validator', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'unicode-kind-global', observedAt);
    await observation(tx, sourceName, propertyId, { sourceId: 'unicode-kind-global', kind: 'global_id', canonicalId: listing.id,
      aliases: [{ kind: 'clé', value: 'unicode-kind-alias' }],
    });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ quarantinedGroups: 0, profile: { fastPathGroups: 0, fastPathLegacyRows: 0 } });
    expect((await tx.select().from(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName)))
      .some(alias => alias.kind === 'clé' && alias.value === 'unicode-kind-alias')).toBe(true);
  }));

  it('excludes manually inconsistent primary ownership without aliases and fails closed without partial writes', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'orphan-primary', observedAt);
    await observation(tx, sourceName, propertyId, { sourceId: 'orphan-primary', kind: 'global_id', canonicalId: listing.id, aliases: [] });
    const [existing] = await tx.insert(sourceListingIdentities).values({ sourceName, primaryId: 'orphan-primary', primaryIdType: 'global_id' }).returning();
    const seenEligibility: Array<{ groups: number; legacy_rows: number }> = [];
    await expect(tx.transaction(async savepoint => {
      const checked = new Proxy(savepoint, {
        get(target, key, receiver) {
          if (key === 'execute') return async (query: Parameters<DbTransaction['execute']>[0]) => {
            const result = await target.execute(query);
            const first = result[0] as Record<string, unknown> | undefined;
            if (first && Object.keys(first).length === 2 && 'groups' in first && 'legacy_rows' in first) {
              seenEligibility.push(first as { groups: number; legacy_rows: number });
            }
            return result;
          };
          const value = Reflect.get(target, key, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await reconcileLegacySourceIdentities(checked, sourceName);
    })).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(seenEligibility).toContainEqual({ groups: 0, legacy_rows: 0 });
    expect((await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).map(row => row.id)).toEqual([existing!.id]);
    expect(await tx.select().from(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName))).toHaveLength(0);
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listing.id)))[0]).toEqual(listing);
  }));

  it('rolls back fast-path identity, alias, and legacy audit inserts in the source transaction', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'rollback-fast-global', observedAt);
    const [legacy] = await tx.insert(listings).values({ sourceName, propertyId, mirrorListingId: 'rollback-fast-tiny', sourceUrl: `https://fixture.invalid/${randomUUID()}` }).returning();
    await observation(tx, sourceName, propertyId, { sourceId: 'rollback-fast-global', kind: 'global_id', canonicalId: listing.id,
      mirrorId: 'rollback-fast-tiny', aliases: [{ kind: 'tiny_id', value: 'rollback-fast-tiny' }],
    });
    const rollback = new Error('fast reconciliation rollback');
    await expect(tx.transaction(async savepoint => {
      const report = await reconcileLegacySourceIdentities(savepoint, sourceName);
      expect(report.profile).toMatchObject({ fastPathGroups: 1, fastPathLegacyRows: 1 });
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listing.id)))[0]).toEqual(listing);
    expect((await tx.select().from(listings).where(eq(listings.id, legacy!.id)))[0]).toEqual(legacy);
  }));

  it('uses ECMAScript whitespace normalization consistently for SQL graph edges and persisted identities', async () => fixture(async (tx, sourceName, propertyId) => {
    const paddedGlobal = '\tglobal-space\u00a0';
    const first = await canonical(tx, sourceName, propertyId, paddedGlobal, observedAt);
    const second = await canonical(tx, sourceName, propertyId, 'tiny-space', new Date(observedAt.getTime() + 1000));
    const nextLineGlobal = '\u0085global-space\u0085';
    const third = await canonical(tx, sourceName, propertyId, nextLineGlobal, observedAt);
    await observation(tx, sourceName, propertyId, { sourceId: paddedGlobal, kind: 'global_id', canonicalId: first.id, aliases: [] });
    await observation(tx, sourceName, propertyId, { sourceId: 'tiny-space', kind: 'tiny_id', canonicalId: second.id,
      aliases: [{ kind: '\u2003global_id\t', value: '\ufeffglobal-space\u3000' },
        { kind: 'detail_id', value: '\t\u2003' }, { kind: '\u00a0', value: 'ignored-blank-kind' }],
    });
    await observation(tx, sourceName, propertyId, { sourceId: nextLineGlobal, kind: 'global_id', canonicalId: third.id, aliases: [] });
    const report = await reconcileLegacySourceIdentities(tx, sourceName);
    expect(report).toMatchObject({ rowsBefore: 3, identityGroups: 2, duplicateGroups: 1, quarantinedGroups: 0 });
    const identities = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    expect(identities.map(row => row.primaryId).sort()).toEqual(['global-space', nextLineGlobal].sort());
    const aliases = await tx.select().from(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName));
    expect(aliases.some(alias => alias.value === '' || alias.kind === '' || alias.value === 'ignored-blank-kind')).toBe(false);
  }));

  it.each(['\t\r\n', '\u00a0\u2003\u3000\ufeff'])('rejects an all-whitespace source primary before reconciliation writes: %j', async whitespace => fixture(async (tx, sourceName, propertyId) => {
    await canonical(tx, sourceName, propertyId, whitespace, observedAt);
    await expect(tx.transaction(savepoint => reconcileLegacySourceIdentities(savepoint, sourceName)))
      .rejects.toThrow('Invalid source identity alias');
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(0);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(0);
  }));

  it('measures full execution for 2,000 source rows with mostly singletons, duplicates, and a small conflict cohort', async () => fixture(async (tx, sourceName, propertyId) => {
    const otherPropertyId = await property(tx);
    await tx.execute(sql`WITH inserted_listings AS (
      INSERT INTO canonical_listings(source_name, property_id, primary_source_listing_id, description, created_at)
      SELECT ${sourceName}, CASE WHEN n > 1995 THEN ${otherPropertyId}::uuid ELSE ${propertyId}::uuid END,
        CASE WHEN n <= 1500 THEN 'execute-global-' || n ELSE 'execute-tiny-' || (n - 1500) END,
        'execution-audit-body-' || n || repeat('retained-full-facts-', 64),
        CASE WHEN n <= 1500 THEN timestamptz '2025-01-01T00:00:00Z' ELSE timestamptz '2025-02-01T00:00:00Z' END
      FROM generate_series(1, 2000) AS series(n) RETURNING id, property_id, primary_source_listing_id
    ), inserted_observations AS (
      INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
        source_listing_aliases, origin, source_status, observed_at)
      SELECT ${sourceName}, property_id, primary_source_listing_id,
        CASE WHEN primary_source_listing_id LIKE 'execute-global-%' THEN 'global_id'::listing_source_id_kind ELSE 'tiny_id'::listing_source_id_kind END,
        jsonb_build_array(jsonb_build_object('kind', 'global_id', 'value', replace(primary_source_listing_id, 'tiny', 'global')),
          jsonb_build_object('kind', 'tiny_id', 'value', replace(primary_source_listing_id, 'global', 'tiny'))),
        'mirror', 'available', timestamptz '2026-01-01T00:00:00Z' FROM inserted_listings
      RETURNING id, source_listing_id
    ) INSERT INTO listing_observation_links(canonical_listing_id, listing_observation_id, link_reason)
      SELECT listing.id, observation.id, 'source_identity' FROM inserted_listings listing
        JOIN inserted_observations observation ON observation.source_listing_id = listing.primary_source_listing_id`);
    const [locksBefore] = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'`);
    const { measuredTx, stats } = measuredTransaction(tx);
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const report = await reconcileLegacySourceIdentities(measuredTx, sourceName);
    const durationMs = Math.round(performance.now() - started);
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    const [locksAfter] = await tx.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'`);
    const addedAdvisoryLocks = locksAfter!.count - locksBefore!.count;
    expect(report).toMatchObject({ rowsBefore: 2000, rowsAfter: 2000, identityGroups: 1500, duplicateGroups: 500, quarantinedGroups: 5,
      profile: { graphParentBytes: 8000, maximumComponentRows: 2 },
    });
    expect(addedAdvisoryLocks).toBeLessThanOrEqual(1);
    expect(stats.maximumResultRows).toBeLessThanOrEqual(5000);
    expect(stats.maximumResultBytes).toBeLessThan(5000 * 1024);
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(1500);
    expect(await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName))).toHaveLength(505);
    expect(await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName))).toHaveLength(5);
    console.info('Identity reconciliation full execution scale evidence', JSON.stringify({
      sourceRows: 2000, singletonGroups: 1000, duplicateGroups: 500, conflictingGroups: 5,
      ...report.profile, ...stats, addedAdvisoryLocks, durationMs, heapDeltaBytes,
      linearProjectionSourceRows: 414000, linearProjectionDurationMs: Math.round(durationMs * 414000 / 2000),
      projectionAssumption: 'same cohort mix and query latency; extrapolation, not a production runtime measurement',
    }));
  }), 120000);

  it('measures full execution for 10,000 fresh source rows dominated by singletons and canonical/legacy pairs', async () => fixture(async (tx, sourceName, propertyId) => {
    await tx.execute(sql`WITH inserted_listings AS (
      INSERT INTO canonical_listings(source_name, property_id, primary_source_listing_id, created_at)
      SELECT ${sourceName}, ${propertyId}::uuid, 'bulk-global-' || n, timestamptz '2025-01-01T00:00:00Z'
      FROM generate_series(1, 8000) AS series(n) RETURNING id, primary_source_listing_id
    ), inserted_observations AS (
      INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
        source_listing_aliases, origin, source_status, observed_at)
      SELECT ${sourceName}, ${propertyId}::uuid, primary_source_listing_id, 'global_id',
        jsonb_build_array(jsonb_build_object('kind', 'global_id', 'value', primary_source_listing_id),
          jsonb_build_object('kind', 'tiny_id', 'value', replace(primary_source_listing_id, 'global', 'tiny'))),
        'mirror', 'available', timestamptz '2026-01-01T00:00:00Z' FROM inserted_listings
      RETURNING id, source_listing_id
    ) INSERT INTO listing_observation_links(canonical_listing_id, listing_observation_id, link_reason)
      SELECT listing.id, observation.id, 'source_identity' FROM inserted_listings listing
        JOIN inserted_observations observation ON observation.source_listing_id = listing.primary_source_listing_id`);
    await tx.execute(sql`WITH inserted_listings AS (
      INSERT INTO listings(source_name, property_id, mirror_listing_id, source_url, og_title, created_at)
      SELECT ${sourceName}, ${propertyId}::uuid, 'bulk-tiny-' || n,
        'https://fixture.invalid/' || ${sourceName}::text || '/bulk/' || n,
        'retained-legacy-audit-' || n || repeat('full-legacy-facts-', 64), timestamptz '2025-02-01T00:00:00Z'
      FROM generate_series(1, 2000) AS series(n) RETURNING mirror_listing_id
    ) INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
      source_listing_aliases, origin, source_status, observed_at, payload)
      SELECT ${sourceName}, ${propertyId}::uuid, mirror_listing_id, 'tiny_id',
        jsonb_build_array(jsonb_build_object('kind', 'tiny_id', 'value', mirror_listing_id),
          jsonb_build_object('kind', 'global_id', 'value', replace(mirror_listing_id, 'tiny', 'global'))),
        'mirror', 'available', timestamptz '2026-01-01T00:00:00Z', jsonb_build_object('mirrorListingId', mirror_listing_id)
      FROM inserted_listings`);
    const { measuredTx, stats } = measuredTransaction(tx);
    const started = performance.now();
    const report = await reconcileLegacySourceIdentities(measuredTx, sourceName);
    const durationMs = Math.round(performance.now() - started);
    expect(report).toMatchObject({ rowsBefore: 10000, rowsAfter: 10000, canonicalRowsAfter: 8000, legacyRowsAfter: 2000,
      identityGroups: 8000, duplicateGroups: 2000, quarantinedGroups: 0,
      profile: { fastPathGroups: 8000, fastPathLegacyRows: 2000, graphParentBytes: 40000, maximumComponentRows: 2 },
    });
    expect(stats.maximumResultRows).toBeLessThanOrEqual(5000);
    expect(stats.maximumResultBytes).toBeLessThan(5000 * 1024);
    const [counts] = await tx.execute<{ identities: number; audits: number }>(sql`SELECT
      (SELECT count(*)::integer FROM source_listing_identities WHERE source_name = ${sourceName}) AS identities,
      (SELECT count(*)::integer FROM source_identity_reconciliations WHERE source_name = ${sourceName}) AS audits`);
    expect(counts).toEqual({ identities: 8000, audits: 2000 });
    console.info('Identity reconciliation mostly fresh full execution evidence', JSON.stringify({
      sourceRows: 10000, singletonGroups: 6000, canonicalLegacyGroups: 2000,
      ...report.profile, ...stats, durationMs,
      linearProjectionSourceRows: 414000, linearProjectionDurationMs: Math.round(durationMs * 414000 / 10000),
      projectionAssumption: 'same fresh cohort mix and database latency; extrapolation, not a production runtime measurement',
    }));
  }), 120000);

  it('streams a 10,000-listing mixed graph with compact parents and bounded database result pages', async () => fixture(async (tx, sourceName, propertyId) => {
    await tx.execute(sql`WITH inserted_listings AS (
      INSERT INTO canonical_listings(source_name, property_id, primary_source_listing_id, created_at)
      SELECT ${sourceName}, ${propertyId}::uuid, 'scale-global-' || n, timestamptz '2025-01-01T00:00:00Z'
      FROM generate_series(1, 5000) AS series(n) RETURNING id, primary_source_listing_id
    ), inserted_observations AS (
      INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
        source_listing_aliases, origin, source_status, observed_at)
      SELECT ${sourceName}, ${propertyId}::uuid, primary_source_listing_id, 'global_id',
        jsonb_build_array(jsonb_build_object('kind', 'global_id', 'value', primary_source_listing_id),
          jsonb_build_object('kind', 'tiny_id', 'value', replace(primary_source_listing_id, 'global', 'tiny'))),
        'mirror', 'available', timestamptz '2026-01-01T00:00:00Z' FROM inserted_listings
      RETURNING id, source_listing_id
    ) INSERT INTO listing_observation_links(canonical_listing_id, listing_observation_id, link_reason)
      SELECT listing.id, observation.id, 'source_identity' FROM inserted_listings listing
        JOIN inserted_observations observation ON observation.source_listing_id = listing.primary_source_listing_id`);
    await tx.execute(sql`WITH inserted_listings AS (
      INSERT INTO listings(source_name, property_id, mirror_listing_id, source_url, created_at)
      SELECT ${sourceName}, ${propertyId}::uuid, 'scale-tiny-' || n,
        'https://fixture.invalid/' || ${sourceName}::text || '/scale/' || n, timestamptz '2025-02-01T00:00:00Z'
      FROM generate_series(1, 5000) AS series(n) RETURNING mirror_listing_id
    ) INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
      source_listing_aliases, origin, source_status, observed_at, payload)
      SELECT ${sourceName}, ${propertyId}::uuid, mirror_listing_id, 'tiny_id',
        jsonb_build_array(jsonb_build_object('kind', 'tiny_id', 'value', mirror_listing_id),
          jsonb_build_object('kind', 'global_id', 'value', replace(mirror_listing_id, 'tiny', 'global'))),
        'mirror', 'available', timestamptz '2026-01-01T00:00:00Z', jsonb_build_object('mirrorListingId', mirror_listing_id)
      FROM inserted_listings`);
    let maximumResultRows = 0;
    let maximumResultBytes = 0;
    let queryCount = 0;
    const measuredTx = new Proxy(tx, {
      get(target, key, receiver) {
        if (key === 'execute') return async (query: Parameters<DbTransaction['execute']>[0]) => {
          const result = await target.execute(query);
          queryCount += 1;
          maximumResultRows = Math.max(maximumResultRows, result.length);
          maximumResultBytes = Math.max(maximumResultBytes, Buffer.byteLength(JSON.stringify(result)));
          return result;
        };
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const report = await reconcileLegacySourceIdentities(measuredTx, sourceName, { dryRun: true });
    const durationMs = Math.round(performance.now() - started);
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    expect(report).toMatchObject({ rowsBefore: 10000, rowsAfter: 10000, canonicalRowsBefore: 5000, legacyRowsBefore: 5000,
      identityGroups: 5000, duplicateGroups: 5000, quarantinedGroups: 0,
      profile: { graphParentBytes: 40000, graphEdgeBatchLimit: 5000, maximumComponentRows: 2 },
    });
    expect(report.profile.edgesRead).toBe(10000);
    expect(maximumResultRows).toBeLessThanOrEqual(5000);
    expect(maximumResultRows).toBeGreaterThan(0);
    expect(maximumResultBytes).toBeLessThan(5000 * 1024);
    expect(await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).toHaveLength(0);
    console.info('Identity reconciliation compact graph scale evidence', JSON.stringify({
      listingRows: report.rowsBefore, groups: report.identityGroups, ...report.profile,
      queryCount, maximumResultRows, maximumResultBytes, durationMs, heapDeltaBytes,
    }));
  }), 120000);

  it('keeps loader metadata constant across 20,000 distinct large observation payloads', async () => fixture(async (tx, sourceName, propertyId) => {
    const listing = await canonical(tx, sourceName, propertyId, 'scale-global', observedAt);
    const aliases = [{ kind: 'global_id', value: 'scale-global' }, { kind: 'tiny_id', value: 'scale-tiny' }];
    async function insertHistory(start: number, end: number) {
      await tx.execute(sql`WITH inserted AS (
        INSERT INTO listing_observations(source_name, property_id, source_listing_id, source_listing_id_kind,
          source_listing_aliases, origin, source_status, observed_at, payload)
        SELECT ${sourceName}, ${propertyId}::uuid, 'scale-global', 'global_id', ${JSON.stringify(aliases)}::jsonb,
          'mirror', 'available', timestamptz '2026-01-01T00:00:00Z' + observations.n * interval '1 millisecond',
          jsonb_build_object('mirrorListingId', 'scale-mirror', 'padding', (
            SELECT string_agg(md5(observations.n::text || ':' || blocks.i::text), '') FROM generate_series(1, 40) AS blocks(i)
          )) FROM generate_series(${start}::integer, ${end}::integer) AS observations(n) RETURNING id
      ) INSERT INTO listing_observation_links(canonical_listing_id, listing_observation_id, link_reason)
        SELECT ${listing.id}::uuid, id, 'source_identity' FROM inserted`);
    }
    await insertHistory(1, 1);
    const small = await loadLegacyIdentityRows(tx, sourceName);
    const smallBytes = Buffer.byteLength(JSON.stringify(small));
    await insertHistory(2, 20000);
    const [history] = await tx.execute<{ observations: number; distinct_payloads: number; payload_bytes: string }>(sql`
      SELECT count(*)::integer AS observations, count(DISTINCT payload->>'padding')::integer AS distinct_payloads,
        sum(octet_length(payload::text))::text AS payload_bytes FROM listing_observations WHERE source_name = ${sourceName}`);
    expect(history!.observations).toBe(20000);
    expect(history!.distinct_payloads).toBe(20000);
    expect(Number(history!.payload_bytes)).toBeGreaterThanOrEqual(20000 * 1024);
    let transferredResultBytes = 0;
    let queryCount = 0;
    const measuredTx = new Proxy(tx, {
      get(target, key, receiver) {
        if (key === 'execute') return async (query: Parameters<DbTransaction['execute']>[0]) => {
          const result = await target.execute(query);
          queryCount += 1;
          transferredResultBytes += Buffer.byteLength(JSON.stringify(result));
          return result;
        };
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const large = await loadLegacyIdentityRows(measuredTx, sourceName);
    const durationMs = performance.now() - started;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    const largeBytes = Buffer.byteLength(JSON.stringify(large));
    expect(large).toEqual(small);
    expect(large).toHaveLength(1);
    expect(large[0]!.aliases).toHaveLength(2);
    expect(large[0]!.aliases).toEqual(expect.arrayContaining(aliases));
    expect(largeBytes).toBe(smallBytes);
    expect(largeBytes).toBeLessThan(4096);
    expect(queryCount).toBeGreaterThan(0);
    expect(transferredResultBytes).toBeLessThan(4096);
    expect(JSON.stringify(large)).not.toContain('padding');
    expect(JSON.stringify(large)).not.toContain(largeMarker);
    console.info('Identity reconciliation loader scale evidence', JSON.stringify({
      observations: history!.observations, payloadBytes: Number(history!.payload_bytes), metadataRows: large.length,
      metadataAliases: large[0]!.aliases.length, metadataBytes: largeBytes, queryCount, transferredResultBytes, durationMs: Math.round(durationMs), heapDeltaBytes,
    }));
  }), 120000);
});

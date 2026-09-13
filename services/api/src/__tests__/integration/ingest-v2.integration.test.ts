import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import { db, canonicalListings, ingestBatches, ingestEvidence, ingestWriterGenerations, listingCandidateHandoffs, listingPriceObservations,
  sourceListingIdentities, sourceListingAliases, sourceIdentityQuarantines, type DbTransaction } from '../../db/index.js';
import { ingestBatchRequestSchema, type IngestBatchRequest } from '../../services/ingest/contracts.js';
import { encodeOpaqueIngestCursor } from '../../services/ingest/cursor.js';
import { processV2Evidence } from '../../services/ingest/v2-processor.js';
import { resolveSourceListingIdentity } from '../../services/ingest/identity.js';
import { insertListingObservation, reconcileListingObservation, listCanonicalListingsForProperty } from '../../services/listing-reconciliation.js';
import { assertIngestWriter } from '../../services/ingest/v2-writer.js';

const rollback = new Error('fixture rollback');
async function fixture(run: (ctx: {
  tx: DbTransaction; id: string; propertyId: string; street: string;
  send: (record: Record<string, unknown>) => Promise<{ payload: IngestBatchRequest; batchId: string; result: Awaited<ReturnType<typeof processV2Evidence>> }>;
  canonical: () => Promise<typeof canonicalListings.$inferSelect | undefined>;
}) => Promise<void>) {
  await db.transaction(async tx => {
    const id = randomUUID();
    const propertyId = randomUUID();
    const street = `Hybrid fixture ${id}`;
    const generation = Math.floor(Date.now() / 1000);
    await tx.insert(ingestWriterGenerations).values({ sourceName: 'funda', generation, lastSequence: 0 })
      .onConflictDoUpdate({ target: ingestWriterGenerations.sourceName, set: { generation, lastSequence: 0 } });
    await tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,postal_code,city,geometry)
      VALUES (${propertyId},'NL',${street},1,'1234AB','Fixture',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    let sequence = 0;
    async function send(record: Record<string, unknown>) {
      sequence += 1;
      const payload = ingestBatchRequestSchema.parse({ sourceName: 'funda', ingestVersion: 2, writerGeneration: generation,
        idempotencyKey: randomUUID(), batchSequence: sequence, cursorStart: null,
        cursorEnd: encodeOpaqueIngestCursor({ changedAt: '2000-01-01T00:00:01.000Z', listingKey: String(sequence).padStart(20, '0') }),
        records: [{ eventId: randomUUID(), sequence, observedAt: new Date(Date.now() - 3600000).toISOString(), collector: 'realtyapi', evidenceStrength: 'inventory',
          identity: { sourceListingId: id, sourceListingIdKind: 'global_id', aliases: [] }, ...record }],
      });
      const [batch] = await tx.insert(ingestBatches).values({ sourceName: payload.sourceName, batchSequence: sequence, idempotencyKey: payload.idempotencyKey,
        cursorStart: null, cursorEnd: payload.cursorEnd, payloadJson: payload as unknown as Record<string, unknown> }).returning();
      return { payload, batchId: batch.id, result: await processV2Evidence(tx, batch.id, payload) };
    }
    async function canonical() { return (await tx.select().from(canonicalListings).where(eq(canonicalListings.propertyId, propertyId)))[0]; }
    await run({ tx, id, propertyId, street, send, canonical });
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
}
function facts(street: string) {
  return { lifecycleStatus: 'available', askingPrice: 500000, priceType: 'sale', pricePeriod: 'total', priceUnit: 'listing', priceCondition: 'asking', currency: 'EUR',
    sourceUrl: `https://www.funda.nl/detail/koop/fixture/${randomUUID()}/`, address: { countryCode: 'NL', street, postalCode: '1234AB', houseNumber: 1 } };
}

describe('Funda v2 PostgreSQL evidence ingestion', () => {
  it('persists and replays unchanged sightings without price history, unread changes or invented absence', async () => fixture(async ({ tx, street, send, canonical }) => {
    const created = await send({ kind: 'facts', facts: facts(street) });
    expect(created.result.ingestedCount).toBe(1);
    const before = (await canonical())!;
    const priceCount = (await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.canonicalListingId, before.id))).length;
    const seenAt = new Date(Date.now() - 1800000).toISOString();
    const sighting = await send({ kind: 'sighting', observedAt: seenAt, inventoryManifestId: 'incomplete-scan' });
    expect(sighting.result.projectionChanged).toBe(false);
    const after = (await canonical())!;
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastPositiveAvailabilityAt?.toISOString()).toBe(seenAt);
    expect((await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.canonicalListingId, before.id))).length).toBe(priceCount);
    expect(await processV2Evidence(tx, sighting.batchId, sighting.payload)).toMatchObject({ ingestedCount: 0, updatedCount: 0, projectionChanged: false });
    const absentAt = new Date().toISOString();
    await send({ kind: 'absence', observedAt: absentAt, inventoryManifest: { id: 'complete-scan', scopeKey: 'province', completedAt: absentAt, coverageStatus: 'complete', verified: true } });
    expect(await canonical()).toMatchObject({ status: 'active', activeEligible: true, lastPositiveAvailabilityAt: after.lastPositiveAvailabilityAt });
    expect((await tx.select().from(ingestEvidence).where(eq(ingestEvidence.eventId, sighting.payload.records![0].eventId)))[0].manifestRef).toEqual({ id: 'incomplete-scan' });
  }));
  it('retains incomplete and invalid addresses and resolves only an exact unambiguous property', async () => fixture(async ({ tx, id, street, send, canonical }) => {
    await send({ kind: 'facts', facts: { ...facts(street), address: { countryCode: 'NL', latitude: 51.44, longitude: 5.47 } } });
    expect(await canonical()).toBeUndefined();
    expect((await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.primaryId, id)))[0].factsJson).toHaveProperty('askingPrice', 500000);
    await send({ kind: 'facts', facts: { address: { postalCode: 'invalid', houseNumber: 'oops' } } });
    expect(await canonical()).toBeUndefined();
    await send({ kind: 'facts', evidenceStrength: 'detail', observedAt: new Date().toISOString(), facts: { address: { street, postalCode: '1234AB', houseNumber: 1 } } });
    expect(await canonical()).toMatchObject({ askingPrice: 500000, status: 'active', activeEligible: true });
    await send({ kind: 'facts', observedAt: new Date(Date.now() + 1000).toISOString(), facts: { askingPrice: null, address: null } });
    expect(await canonical()).toMatchObject({ askingPrice: null, status: 'active' });
  }));
  it('applies terminal evidence immediately, rejects old renewals and restores from newer positive evidence', async () => fixture(async ({ street, send, canonical }) => {
    await send({ kind: 'facts', observedAt: new Date(Date.now() - 7200000).toISOString(), facts: facts(street) });
    const terminalAt = new Date(Date.now() - 3600000).toISOString();
    await send({ kind: 'facts', observedAt: terminalAt, evidenceStrength: 'detail', facts: { lifecycleStatus: 'sold' } });
    expect(await canonical()).toMatchObject({ status: 'sold', activeEligible: false });
    await send({ kind: 'sighting', observedAt: new Date(Date.now() - 5400000).toISOString() });
    expect(await canonical()).toMatchObject({ status: 'sold', activeEligible: false });
    await send({ kind: 'sighting', observedAt: new Date().toISOString() });
    expect(await canonical()).toMatchObject({ status: 'active', activeEligible: true });
  }));
  it('quarantines contradictory address facts and rejects changed replay content and retired writers', async () => fixture(async ({ tx, street, send, canonical }) => {
    const first = await send({ kind: 'facts', facts: facts(street) });
    const modified = ingestBatchRequestSchema.parse({ ...first.payload, records: first.payload.records!.map(record => ({ ...record, kind: 'facts', facts: { askingPrice: 1 } })) });
    await expect(processV2Evidence(tx, first.batchId, modified)).rejects.toThrow('different content');
    await expect(assertIngestWriter(tx, { ...first.payload, writerGeneration: first.payload.writerGeneration! - 1 })).rejects.toThrow('retired');
    await send({ kind: 'facts', observedAt: new Date().toISOString(), evidenceStrength: 'detail', facts: { address: { houseNumber: 999 } } });
    expect(await canonical()).toMatchObject({ status: 'active', activeEligible: false, verificationState: 'invalid' });
  }));
  it('retains a terminal fact through deferred address resolution and equal-time positive evidence', async () => fixture(async ({ street, send, canonical }) => {
    const at = new Date(Date.now() - 3600000).toISOString();
    await send({ kind: 'facts', observedAt: at, facts: { lifecycleStatus: 'sold', askingPrice: 500000, address: { countryCode: 'NL' } } });
    await send({ kind: 'facts', observedAt: at, evidenceStrength: 'detail', facts: { lifecycleStatus: 'available' } });
    await send({ kind: 'facts', observedAt: new Date().toISOString(), facts: { address: { street, houseNumber: 1, postalCode: '1234AB' } } });
    expect(await canonical()).toMatchObject({ status: 'sold', activeEligible: false });
  }));
  it('retains relistings when URLs/public aliases repeat and quarantines explicitly contradictory stable aliases', async () => fixture(async ({ tx, id }) => {
    const first = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: id, primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: `shared-${id}` }, { kind: 'canonical_url', value: `https://www.funda.nl/${id}` }] });
    const second = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: `new-${id}`, primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: `shared-${id}` }, { kind: 'canonical_url', value: `https://www.funda.nl/${id}` }] });
    expect(first.identity.id).not.toBe(second.identity.id);
    expect(second.quarantined).toBe(false);
    const auditCount = (await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.reason, 'ambiguous_reused_alias'))).length;
    for (const alias of [{ kind: 'tiny_id', value: `shared-${id}` }, { kind: 'canonical_url', value: `https://www.funda.nl/${id}` }]) {
      const ambiguous = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: alias.value, primaryIdType: alias.kind });
      expect(ambiguous).toMatchObject({ quarantined: true, affectedPropertyIds: [] });
    }
    for (const original of [first, second]) {
      const continued = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: original.identity.primaryId, primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: `shared-${id}` }] });
      expect(continued).toMatchObject({ identity: { id: original.identity.id, quarantinedAt: null }, quarantined: false });
    }
    expect((await tx.select().from(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.reason, 'ambiguous_reused_alias'))).length).toBe(auditCount);
    const conflicted = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: id, primaryIdType: 'global_id', aliases: [{ kind: 'global_id', value: `new-${id}` }] });
    expect(conflicted.quarantined).toBe(true);
    expect((await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, second.identity.id)))[0].quarantinedAt).not.toBeNull();
  }));
  it('reads merged fractional rooms and explicit clears even when enrichment arrives behind a newer price observation', async () => fixture(async ({ tx, propertyId, street, send }) => {
    await send({ kind: 'facts', observedAt: new Date(Date.now() - 3600000).toISOString(), facts: { ...facts(street), numRooms: 1, energyLabel: 'A' } });
    await send({ kind: 'facts', observedAt: new Date(Date.now() - 1800000).toISOString(), facts: { askingPrice: 505000 } });
    await send({ kind: 'facts', observedAt: new Date(Date.now() - 2700000).toISOString(), evidenceStrength: 'detail', facts: { numRooms: 2.5, energyLabel: null } });
    const [listing] = await listCanonicalListingsForProperty(propertyId, tx);
    expect(listing).toMatchObject({ askingPrice: 505000, numRooms: 2.5, energyLabel: null });
  }));
  it('quarantines an explicit unit clear when the resulting full address identifies a different property', async () => fixture(async ({ tx, propertyId, street, send, canonical }) => {
    await tx.execute(sql`UPDATE properties SET house_number_addition = 'A' WHERE id = ${propertyId}`);
    const initial = facts(street);
    await send({ kind: 'facts', facts: { ...initial, address: { ...initial.address, houseNumberAddition: 'A' } } });
    await tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,postal_code,city,geometry)
      VALUES (${randomUUID()},'NL',${street},1,'1234AB','Fixture',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    await send({ kind: 'facts', observedAt: new Date().toISOString(), evidenceStrength: 'detail', facts: { address: { houseNumberAddition: null } } });
    expect(await canonical()).toMatchObject({ propertyId, status: 'active', activeEligible: false, verificationState: 'invalid' });
  }));
  it('quarantines an explicit suffix clear even when the new address is absent from the app database', async () => fixture(async ({ tx, propertyId, street, send, canonical }) => {
    await tx.execute(sql`UPDATE properties SET house_number_addition = 'A' WHERE id = ${propertyId}`);
    const initial = facts(street);
    await send({ kind: 'facts', facts: { ...initial, address: { ...initial.address, houseNumberAddition: 'A' } } });
    const before = (await canonical())!;
    await send({ kind: 'facts', observedAt: new Date().toISOString(), facts: { address: { houseNumberAddition: null }, askingPrice: 999999 } });
    expect(await canonical()).toMatchObject({ propertyId, askingPrice: before.askingPrice, lastPositiveAvailabilityAt: before.lastPositiveAvailabilityAt, status: before.status, verificationState: 'invalid', activeEligible: false });
  }));
  it.each(['available', 'sold'] as const)('applies retained %s source evidence when address-only facts first bind a provisional listing', async lifecycleStatus => fixture(async ({ tx, propertyId, street, send, canonical }) => {
    const sourceFacts = facts(street);
    const [provisional] = await tx.insert(canonicalListings).values({ propertyId, sourceName: 'funda', canonicalUrl: sourceFacts.sourceUrl.replace(/\/$/, ''),
      displayUrl: sourceFacts.sourceUrl, originSummary: 'user', verificationState: 'provisional', status: 'active', activeEligible: false }).returning();
    const [handoff] = await tx.insert(listingCandidateHandoffs).values({ propertyId, sourceName: 'funda', canonicalListingId: provisional.id,
      sourceUrlRaw: sourceFacts.sourceUrl, sourceUrlCanonical: provisional.canonicalUrl!, state: 'queued' }).returning();
    const observedAt = new Date(Date.now() - 7200000).toISOString();
    const earlierPositiveAt = new Date(Date.now() - 10800000).toISOString();
    if (lifecycleStatus === 'sold') {
      await send({ kind: 'facts', observedAt: earlierPositiveAt, facts: { ...sourceFacts, address: { countryCode: 'NL' } } });
    }
    await send({ kind: 'facts', observedAt, facts: { ...sourceFacts, lifecycleStatus, address: { countryCode: 'NL' } } });
    expect(await canonical()).toMatchObject({ id: provisional.id, activeEligible: false, verificationState: 'provisional' });
    const resolved = await send({ kind: 'facts', observedAt: new Date().toISOString(), facts: { address: sourceFacts.address } });
    expect(await canonical()).toMatchObject({ id: provisional.id, status: lifecycleStatus === 'available' ? 'active' : 'sold', activeEligible: lifecycleStatus === 'available',
      lastPositiveAvailabilityAt: new Date(lifecycleStatus === 'available' ? observedAt : earlierPositiveAt),
      availabilityEndedAt: lifecycleStatus === 'sold' ? new Date(observedAt) : null });
    expect(await processV2Evidence(tx, resolved.batchId, resolved.payload)).toMatchObject({ ingestedCount: 0, updatedCount: 0, projectionChanged: false });
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, handoff.id)))[0].state).toBe('delivered');
  }));
  it('attaches a pending provisional only after source address and URL proof, and completes unchanged and terminal correlations', async () => fixture(async ({ tx, propertyId, street, send, canonical }) => {
    const sourceFacts = facts(street);
    const [provisional] = await tx.insert(canonicalListings).values({ propertyId, sourceName: 'funda',
      canonicalUrl: sourceFacts.sourceUrl.replace(/\/$/, ''), displayUrl: sourceFacts.sourceUrl,
      originSummary: 'user', verificationState: 'provisional', status: 'active', activeEligible: false,
    }).returning();
    const [handoff] = await tx.insert(listingCandidateHandoffs).values({ propertyId, sourceName: 'funda',
      canonicalListingId: provisional.id, sourceUrlRaw: sourceFacts.sourceUrl,
      sourceUrlCanonical: sourceFacts.sourceUrl.replace(/\/$/, ''), state: 'queued' }).returning();
    await send({ kind: 'facts', facts: sourceFacts, sourceCandidateId: handoff.id });
    const confirmed = (await canonical())!;
    expect(confirmed).toMatchObject({ id: provisional.id, activeEligible: true, verificationState: 'validated', originSummary: 'user_and_mirror' });
    await tx.update(listingCandidateHandoffs).set({ state: 'queued' }).where(eq(listingCandidateHandoffs.id, handoff.id));
    const priceCount = (await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.canonicalListingId, provisional.id))).length;
    const sighting = await send({ kind: 'sighting', sourceCandidateId: handoff.id, observedAt: new Date(Date.now() - 1800000).toISOString() });
    expect(sighting.result.projectionChanged).toBe(false);
    expect((await canonical())!.updatedAt).toEqual(confirmed.updatedAt);
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, handoff.id)))[0].state).toBe('delivered');
    expect((await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.canonicalListingId, provisional.id))).length).toBe(priceCount);
    expect(await processV2Evidence(tx, sighting.batchId, sighting.payload)).toMatchObject({ ingestedCount: 0, updatedCount: 0, projectionChanged: false });
    await tx.update(listingCandidateHandoffs).set({ state: 'queued' }).where(eq(listingCandidateHandoffs.id, handoff.id));
    const terminalAt = new Date().toISOString();
    await send({ kind: 'facts', sourceCandidateId: handoff.id, observedAt: terminalAt, facts: { lifecycleStatus: 'sold' } });
    expect(await canonical()).toMatchObject({ id: provisional.id, propertyId, status: 'sold', activeEligible: false, availabilityEndedAt: new Date(terminalAt) });
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, handoff.id)))[0].state).toBe('delivered');
  }));
  it('rejects a candidate property or URL contradiction without hiding separately proven source coverage', async () => fixture(async ({ tx, id, propertyId, street, send }) => {
    const wrongPropertyId = randomUUID();
    await tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,postal_code,city,geometry)
      VALUES (${wrongPropertyId},'NL',${street},2,'1234AB','Fixture',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    const sourceFacts = facts(street);
    const [provisional] = await tx.insert(canonicalListings).values({ propertyId: wrongPropertyId, sourceName: 'funda',
      canonicalUrl: sourceFacts.sourceUrl.replace(/\/$/, ''), displayUrl: sourceFacts.sourceUrl,
      originSummary: 'user', verificationState: 'provisional', status: 'active' }).returning();
    const [handoff] = await tx.insert(listingCandidateHandoffs).values({ propertyId: wrongPropertyId, sourceName: 'funda',
      canonicalListingId: provisional.id, sourceUrlRaw: sourceFacts.sourceUrl,
      sourceUrlCanonical: sourceFacts.sourceUrl.replace(/\/$/, ''), state: 'queued' }).returning();
    await send({ kind: 'facts', sourceCandidateId: handoff.id, facts: sourceFacts });
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, provisional.id)))[0]).toMatchObject({ propertyId: wrongPropertyId, verificationState: 'invalid', activeEligible: false });
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.primaryId, id));
    expect(identity.quarantinedAt).toBeNull();
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, identity.canonicalListingId!)))[0]).toMatchObject({ propertyId, activeEligible: true, verificationState: 'validated' });
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, handoff.id)))[0].state).toBe('dead_letter');
    const [badUrl] = await tx.insert(listingCandidateHandoffs).values({ propertyId, sourceName: 'funda', canonicalListingId: identity.canonicalListingId,
      sourceUrlRaw: 'https://www.funda.nl/detail/koop/wrong/999/', sourceUrlCanonical: 'https://www.funda.nl/detail/koop/wrong/999', state: 'queued' }).returning();
    await send({ kind: 'sighting', sourceCandidateId: badUrl.id, observedAt: new Date().toISOString() });
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, badUrl.id)))[0].state).toBe('dead_letter');
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, identity.canonicalListingId!)))[0].activeEligible).toBe(true);
  }));
  it('resolves user submissions through known typed v2 identities and never fabricates positive source time', async () => fixture(async ({ tx, id, propertyId, street, send, canonical }) => {
    const sourceFacts = facts(street);
    await send({ kind: 'facts', facts: sourceFacts });
    const before = (await canonical())!;
    const observation = await insertListingObservation({ sourceName: 'funda', sourceListingId: id, sourceListingIdKind: 'global_id',
      sourceListingAliases: [{ kind: 'global_id', value: id }], sourceUrlRaw: sourceFacts.sourceUrl, sourceUrlCanonical: before.canonicalUrl,
      origin: 'user', propertyId, propertyMatchKind: 'source_exact', sourceStatus: 'available', payload: {} }, tx);
    const after = await reconcileListingObservation(observation.id, tx);
    expect(after).toMatchObject({ id: before.id, lastPositiveAvailabilityAt: before.lastPositiveAvailabilityAt, activeEligible: true });
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.propertyId, propertyId))).length).toBe(1);
    const pending = await insertListingObservation({ sourceName: 'pararius', sourceListingId: randomUUID(),
      sourceUrlRaw: 'https://www.pararius.nl/huurwoningen/fixture', origin: 'user', propertyId,
      propertyMatchKind: 'user_selected', sourceStatus: 'available', payload: {} }, tx);
    expect(await reconcileListingObservation(pending.id, tx)).toMatchObject({ lastPositiveAvailabilityAt: null, activeEligible: false });
  }));
  it('does not use a previously delivered candidate URL to collapse a new identified relisting', async () => fixture(async ({ tx, id, propertyId, street, send, canonical }) => {
    const sourceFacts = facts(street);
    await send({ kind: 'facts', facts: sourceFacts });
    const original = (await canonical())!;
    const [handoff] = await tx.insert(listingCandidateHandoffs).values({ sourceName: 'funda', propertyId,
      canonicalListingId: original.id, sourceUrlRaw: sourceFacts.sourceUrl,
      sourceUrlCanonical: original.canonicalUrl!, state: 'queued' }).returning();
    const nextId = `${id}-relisted`;
    await send({ kind: 'facts', sourceCandidateId: handoff.id, observedAt: new Date().toISOString(), facts: sourceFacts,
      identity: { sourceListingId: nextId, sourceListingIdKind: 'global_id', aliases: [] } });
    const [relisting] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.primaryId, nextId));
    expect(relisting.canonicalListingId).not.toBe(original.id);
    expect(relisting.quarantinedAt).toBeNull();
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, original.id)))[0].verificationState).toBe('validated');
    expect((await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.id, handoff.id)))[0]).toMatchObject({ state: 'delivered', canonicalListingId: relisting.canonicalListingId });
  }));
  it('keeps Pararius v1 relistings separate when a canonical URL repeats', async () => fixture(async ({ tx, propertyId }) => {
    const sourceUrl = `https://www.pararius.nl/huurwoningen/${randomUUID()}`;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const observedAt = new Date(Date.now() - 60000);
    const submit = async (sourceListingId: string) => {
      const observation = await insertListingObservation({ sourceName: 'pararius', sourceListingId, sourceListingIdKind: 'global_id',
        sourceListingAliases: [{ kind: 'global_id', value: sourceListingId }, { kind: 'canonical_url', value: sourceUrl }],
        sourceUrlRaw: sourceUrl, sourceUrlCanonical: sourceUrl, origin: 'mirror', propertyId, propertyMatchKind: 'source_exact',
        sourceStatus: 'available', observedAt, lastSeenAt: observedAt, askingPrice: 1250, payload: { priceType: 'rent' } }, tx);
      return reconcileListingObservation(observation.id, tx);
    };
    const first = await submit(firstId);
    const second = await submit(secondId);
    expect(first!.id).not.toBe(second!.id);
    expect(second).toMatchObject({ primarySourceListingId: secondId, pricePeriod: 'month', priceUnit: 'listing', priceCondition: 'asking', activeEligible: true });
    expect((await tx.select().from(canonicalListings).where(eq(canonicalListings.id, first!.id)))[0]).toMatchObject({ primarySourceListingId: firstId, verificationState: 'validated' });
    expect((await submit(secondId))!.id).toBe(second!.id);
  }));
  it('retains primary identity resolution for repeated evidence after a new stable-identity conflict', async () => fixture(async ({ tx, id }) => {
    const first = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: id, primaryIdType: 'global_id', aliases: [{ kind: 'global_id', value: `${id}-contradiction` }] });
    expect(first.quarantined).toBe(true);
    const repeated = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: id, primaryIdType: 'global_id' });
    expect(repeated).toMatchObject({ identity: { id: first.identity.id }, quarantined: true });
  }));
  it('quarantines conflicting established global and stable alias owners without failing the evidence stream', async () => fixture(async ({ tx, id }) => {
    const first = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: id, primaryIdType: 'global_id', aliases: [{ kind: 'stable_id', value: `${id}-stable-a` }] });
    const second = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: `${id}-global-b`, primaryIdType: 'global_id', aliases: [{ kind: 'stable_id', value: `${id}-stable-b` }] });
    const conflicted = await resolveSourceListingIdentity(tx, { sourceName: 'funda', primaryId: second.identity.primaryId, primaryIdType: 'global_id', aliases: [{ kind: 'stable_id', value: `${id}-stable-a` }] });
    expect(conflicted.quarantined).toBe(true);
    for (const identity of [first.identity, second.identity]) {
      expect((await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, identity.id)))[0].quarantinedAt).not.toBeNull();
    }
  }));
  it('serializes concurrent typed alias claims to one stable identity', async () => {
    const sourceName = `test-${randomUUID()}`;
    try {
      const resolve = () => db.transaction(tx => resolveSourceListingIdentity(tx, { sourceName, primaryId: '123', primaryIdType: 'global_id', aliases: [{ kind: 'tiny_id', value: '456' }] }));
      const [a, b] = await Promise.all([resolve(), resolve()]);
      expect(a.identity.id).toBe(b.identity.id);
      expect((await db.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName))).length).toBe(1);
    } finally {
      await db.delete(sourceIdentityQuarantines).where(eq(sourceIdentityQuarantines.sourceName, sourceName));
      await db.delete(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName));
      await db.delete(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
    }
  });
});

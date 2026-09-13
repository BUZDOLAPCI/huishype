import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import { db, canonicalListings, ingestBatches, ingestEvidence, ingestWriterGenerations, listingPriceObservations,
  sourceListingIdentities, sourceListingAliases, sourceIdentityQuarantines, type DbTransaction } from '../../db/index.js';
import { ingestBatchRequestSchema, type IngestBatchRequest } from '../../services/ingest/contracts.js';
import { encodeOpaqueIngestCursor } from '../../services/ingest/cursor.js';
import { processV2Evidence } from '../../services/ingest/v2-processor.js';
import { resolveSourceListingIdentity } from '../../services/ingest/identity.js';
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

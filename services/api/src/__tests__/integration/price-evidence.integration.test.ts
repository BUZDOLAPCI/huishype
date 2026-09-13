import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../../db/index.js';
import { canonicalListings, listingObservations, listingPriceObservations, priceGuesses, priceHistory, properties, users } from '../../db/schema.js';
import { projectPriceObservation } from '../../services/listing-reconciliation.js';
import { calculateKarmaForUser } from '../../services/karma.js';
import { calculateFmv } from '../../services/fmv.js';
import { runPriceEvidenceRepair } from '../../services/price-evidence-repair.js';

// All fixtures, including the historical migration replay, roll back. This
// suite needs migrated PostgreSQL but no seed data or running API/worker.
async function rolledBack(fn: (tx: DbTransaction) => Promise<void>) {
  const rollback = new Error('price-evidence-test-rollback');
  try {
    await db.transaction(async (tx) => { await fn(tx); throw rollback; });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function fixture(tx: DbTransaction, payload: Record<string, unknown> = {}) {
  const id = randomUUID();
  await tx.insert(properties).values({
    id, street: 'Price Evidence Test', houseNumber: 1, postalCode: '1234AB', city: 'Test',
    geometry: sql`ST_SetSRID(ST_MakePoint(5, 52), 4326)`,
  });
  const [listing] = await tx.insert(canonicalListings).values({
    propertyId: id, sourceName: 'funda', primarySourceListingId: randomUUID(),
    status: 'sold', askingPrice: 400_000, priceType: 'sale',
  }).returning();
  const [observation] = await tx.insert(listingObservations).values({
    propertyId: id, sourceName: 'funda', sourceListingId: listing.primarySourceListingId,
    origin: 'mirror', sourceStatus: 'sold', askingPrice: 400_000, priceCurrency: 'EUR',
    observedAt: new Date('2026-09-13T12:00:00Z'), payload,
  }).returning();
  return { id, listing, observation };
}

describe('asking and achieved price evidence', () => {
  it('keeps a sold listing asking amount unscored and suppresses unchanged daily price history', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      await projectPriceObservation(f.observation, f.listing, tx);
      const [later] = await tx.insert(listingObservations).values({
        ...f.observation, id: randomUUID(), observedAt: new Date('2026-09-14T12:00:00Z'),
      }).returning();
      await projectPriceObservation(later, f.listing, tx);
      const history = await tx.select().from(priceHistory).where(eq(priceHistory.propertyId, f.id));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ eventType: 'asking_price', priceKind: 'asking', price: 400_000 });
      const evidence = await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.propertyId, f.id));
      expect(evidence).toHaveLength(1);
    });
  });

  it('keeps unknown history pending and allows later explicit achieved evidence at the same amount/date', async () => {
    await rolledBack(async (tx) => {
      const history = { eventType: 'sold', priceDate: '2026-09-13', price: 450_000 };
      const f = await fixture(tx, { priceHistory: [history] });
      const [user] = await tx.insert(users).values({ username: randomUUID(), email: `${randomUUID()}@example.test` }).returning();
      await tx.insert(priceGuesses).values({ propertyId: f.id, userId: user.id, guessedPrice: 450_000 });
      await projectPriceObservation(f.observation, f.listing, tx);
      expect(await calculateKarmaForUser(user.id, tx)).toEqual({ karma: 0, internalKarma: 0 });
      await projectPriceObservation({ ...f.observation, payload: { priceHistory: [{ ...history, priceKind: 'achieved' }] } }, f.listing, tx);
      expect(await calculateKarmaForUser(user.id, tx)).toEqual({ karma: 5, internalKarma: 5 });
      const sales = await tx.select().from(priceHistory).where(eq(priceHistory.propertyId, f.id));
      expect(sales.filter((row) => row.eventType === 'sold').map((row) => row.priceKind).sort()).toEqual(['achieved', 'unknown']);
    });
  });

  it('repairs only identifiable synthetic sold asking values and retains ambiguous legacy/source history', async () => {
    await rolledBack(async (tx) => {
      const synthetic = await fixture(tx);
      const legacy = await fixture(tx, { legacy_listing_id: randomUUID() });
      const sourceHistory = await fixture(tx, {
        priceHistory: [{ eventType: 'sold', priceDate: '2026-09-13', price: 400_000 }],
      });
      for (const f of [synthetic, legacy, sourceHistory]) {
        await tx.insert(listingPriceObservations).values({
          propertyId: f.id, canonicalListingId: f.listing.id, listingObservationId: f.observation.id,
          sourceName: 'funda', sourceListingId: f.observation.sourceListingId, origin: 'mirror',
          eventType: 'status_change', price: 400_000, currency: 'EUR', priceDate: '2026-09-13',
          observedAt: f.observation.observedAt,
        });
        await tx.insert(priceHistory).values({
          propertyId: f.id, source: 'funda', eventType: 'sold', price: 400_000, priceDate: '2026-09-13',
        });
      }
      // Existing asking history collides with the correction: it must survive once.
      await tx.insert(priceHistory).values({
        propertyId: synthetic.id, source: 'funda', eventType: 'asking_price', price: 400_000, priceDate: '2026-09-13',
      });
      const migration = readFileSync(new URL('../../../drizzle/0062_price_evidence.sql', import.meta.url), 'utf8');
      const correctionStatements = migration.split('--> statement-breakpoint').slice(3);
      for (const statement of correctionStatements) await tx.execute(sql.raw(statement));
      // Repeating the correction leaves retained history identical.
      for (const statement of correctionStatements) await tx.execute(sql.raw(statement));
      const corrected = await tx.select().from(priceHistory).where(eq(priceHistory.propertyId, synthetic.id));
      expect(corrected).toHaveLength(1);
      expect(corrected[0]).toMatchObject({ eventType: 'asking_price', priceKind: 'asking' });
      for (const f of [legacy, sourceHistory]) {
        const [retained] = await tx.select().from(priceHistory).where(eq(priceHistory.propertyId, f.id));
        expect(retained).toMatchObject({ eventType: 'sold', priceKind: 'unknown', price: 400_000 });
      }
      const [source] = await tx.select().from(listingObservations).where(eq(listingObservations.id, synthetic.observation.id));
      expect(source.sourceStatus).toBe('sold');
    });
  });

  it('revokes historical karma, recomputes other-property FMV weights and durably completes repair once', async () => {
    await rolledBack(async (tx) => {
      const affected = await fixture(tx);
      const other = await fixture(tx);
      const [user] = await tx.insert(users).values({ username: randomUUID(), email: `${randomUUID()}@example.test`, karma: 50, internalKarma: 50 }).returning();
      await tx.insert(priceHistory).values({ propertyId: affected.id, eventType: 'sold', source: 'funda', price: 400_000, priceDate: '2026-09-13', priceKind: 'unknown' });
      await tx.insert(priceGuesses).values([
        { propertyId: affected.id, userId: user.id, guessedPrice: 400_000 },
        { propertyId: other.id, userId: user.id, guessedPrice: 600_000 },
      ]);
      await tx.execute(sql`INSERT INTO price_evidence_repair_queue(property_id) VALUES (${affected.id})`);
      const before = calculateFmv([{ guessedPrice: 600_000, karma: 50 }, { guessedPrice: 300_000, karma: 1 }], null, null);
      const result = await runPriceEvidenceRepair(100, tx as unknown as Pick<typeof db, 'transaction'>);
      expect(result).toEqual({ repairedProperties: 1, recalculatedUsers: 1, changedUsers: 1, invalidatedProperties: 2 });
      const [updated] = await tx.select().from(users).where(eq(users.id, user.id));
      expect(updated.karma).toBe(0);
      const after = calculateFmv([{ guessedPrice: 600_000, karma: updated.karma }, { guessedPrice: 300_000, karma: 1 }], null, null);
      expect(after.fmv).toBe(450_000);
      expect(after.fmv).not.toBe(before.fmv);
      const state = await tx.execute<{ change_version: number }>(sql`SELECT change_version FROM property_change_state WHERE property_id = ${other.id}`);
      expect(Number(state[0].change_version)).toBe(1);
      const repeat = await runPriceEvidenceRepair(100, tx as unknown as Pick<typeof db, 'transaction'>);
      expect(repeat.repairedProperties).toBe(0);
    });
  });
});

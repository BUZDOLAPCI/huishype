import { sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/index.js';
import { calculateKarmaForUser } from './karma.js';
import { advancePropertyChangeVersion } from './property-read-state.js';
import { advancePropertyTilePyramidSourceWatermark } from './property-tile-pyramid.js';

export interface PriceEvidenceRepairResult {
  repairedProperties: number;
  recalculatedUsers: number;
  changedUsers: number;
  invalidatedProperties: number;
}

const emptyResult = (): PriceEvidenceRepairResult => ({
  repairedProperties: 0, recalculatedUsers: 0, changedUsers: 0, invalidatedProperties: 0,
});

/**
 * Revoke scores based on ambiguous/asking amounts after migration 0062. Guess
 * outcomes and FMV are calculated from current evidence/karma on read. Tile
 * snapshots additionally need persistent watermark invalidation. A single
 * transaction makes queue completion, karma and invalidation crash atomic.
 */
export async function runPriceEvidenceRepair(
  limit = 100,
  database: Pick<typeof db, 'transaction'> = db,
): Promise<PriceEvidenceRepairResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('Price evidence repair limit must be an integer from 1 to 10000');
  }

  return database.transaction(async (tx: DbTransaction) => {
    // Different property batches can affect the same user's chronology. Keep
    // repair workers serialized without making a second worker wait.
    const lock = await tx.execute<{ acquired: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(hashtext('price-evidence-repair-v1')) AS acquired
    `);
    if (!Array.from(lock)[0]?.acquired) return emptyResult();

    const pending = await tx.execute<{ property_id: string }>(sql`
      SELECT property_id FROM price_evidence_repair_queue
      WHERE derived_recomputed_at IS NULL
      ORDER BY enqueued_at, property_id
      LIMIT ${limit}
      FOR UPDATE
    `);
    const propertyIds = Array.from(pending, (row) => row.property_id);
    if (propertyIds.length === 0) return emptyResult();
    const propertiesSql = sql.join(propertyIds.map((id) => sql`${id}::uuid`), sql`, `);

    const users = await tx.execute<{ id: string; karma: number; internal_karma: number }>(sql`
      SELECT u.id, u.karma, u.internal_karma FROM users u
      WHERE EXISTS (
        SELECT 1 FROM price_guesses pg
        WHERE pg.user_id = u.id AND pg.property_id IN (${propertiesSql})
      )
      ORDER BY u.id
      FOR UPDATE
    `);
    const changedUserIds: string[] = [];
    for (const user of users) {
      const recalculated = await calculateKarmaForUser(user.id, tx);
      if (recalculated.karma === Number(user.karma)
        && recalculated.internalKarma === Number(user.internal_karma)) continue;
      await tx.execute(sql`
        UPDATE users SET karma = ${recalculated.karma},
          internal_karma = ${recalculated.internalKarma}, updated_at = now()
        WHERE id = ${user.id}
      `);
      changedUserIds.push(user.id);
    }

    const affectedProperties = new Set(propertyIds);
    if (changedUserIds.length > 0) {
      // Changing credibility also changes that user's contribution to other
      // properties, including properties with no corrected sale-price row.
      const guessedProperties = await tx.execute<{ property_id: string }>(sql`
        SELECT DISTINCT property_id FROM price_guesses
        WHERE user_id IN (${sql.join(changedUserIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND is_meme_guess = false
      `);
      for (const row of guessedProperties) affectedProperties.add(row.property_id);
    }
    const invalidatedIds = [...affectedProperties];
    for (let offset = 0; offset < invalidatedIds.length; offset += 1000) {
      await advancePropertyChangeVersion(invalidatedIds.slice(offset, offset + 1000), tx);
    }
    await advancePropertyTilePyramidSourceWatermark(['listing_facts', 'social_inputs'], tx);
    await tx.execute(sql`
      UPDATE price_evidence_repair_queue SET derived_recomputed_at = now()
      WHERE property_id IN (${propertiesSql})
    `);
    return {
      repairedProperties: propertyIds.length,
      recalculatedUsers: users.length,
      changedUsers: changedUserIds.length,
      invalidatedProperties: affectedProperties.size,
    };
  });
}

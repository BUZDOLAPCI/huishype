import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { refreshLatestListingsView, refreshPriceGuessStartMarketSummaries } from './listings-view.js';
import { advancePropertyTilePyramidSourceWatermark } from './property-tile-pyramid.js';

/**
 * Expiration only changes published eligibility. Facts, asking-price history,
 * source dates, and social/unread activity are deliberately unaffected.
 */
export async function expireListingAvailability(limit = 1000): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error('Listing expiry batch limit must be between 1 and 10000');
  }
  return db.transaction(async (tx) => {
    const expired = await tx.execute<{ id: string }>(sql`
      WITH due AS (
        SELECT id FROM canonical_listings
        WHERE active_eligible AND availability_expires_at <= now()
        ORDER BY availability_expires_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE canonical_listings cl
      SET active_eligible = false
      FROM due WHERE cl.id = due.id
      RETURNING cl.id::text
    `);
    const count = Array.from(expired).length;
    if (count > 0) {
      await tx.execute(sql`
        INSERT INTO listing_lifecycle_maintenance (id, requested_at)
        VALUES ('availability', clock_timestamp())
        ON CONFLICT (id) DO UPDATE SET requested_at = EXCLUDED.requested_at
      `);
      await advancePropertyTilePyramidSourceWatermark(['listing_facts', 'property_status'], tx);
    }
    return count;
  });
}

/** Retried after crashes or failed refreshes even if no more rows are expiring. */
export async function refreshExpiredListingProjections(
  refreshViews: Array<() => Promise<void>> = [
    refreshLatestListingsView,
    refreshPriceGuessStartMarketSummaries,
  ],
): Promise<boolean> {
  const pending = await db.execute<{ requested_at: string }>(sql`
    SELECT requested_at::text FROM listing_lifecycle_maintenance
    WHERE id = 'availability'
      AND (refreshed_at IS NULL OR requested_at > refreshed_at)
  `);
  const requestedAt = Array.from(pending)[0]?.requested_at;
  if (!requestedAt) return false;
  for (const refresh of refreshViews) await refresh();
  await db.execute(sql`
    UPDATE listing_lifecycle_maintenance
    SET refreshed_at = ${requestedAt}::timestamptz
    WHERE id = 'availability'
      AND requested_at = ${requestedAt}::timestamptz
  `);
  return true;
}

export async function runListingLifecycleMaintenance(limit = 1000): Promise<{
  expiredCount: number;
  projectionsRefreshed: boolean;
}> {
  let expiredCount = 0;
  let batchCount: number;
  do {
    batchCount = await expireListingAvailability(limit);
    expiredCount += batchCount;
  } while (batchCount === limit);
  const projectionsRefreshed = await refreshExpiredListingProjections();
  return { expiredCount, projectionsRefreshed };
}

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

/**
 * Refresh the mv_latest_active_listings materialized view.
 * Uses CONCURRENTLY so readers are not blocked during refresh.
 * Call after any listing insert, update, or status change.
 *
 * Coalesced: concurrent callers share one in-flight refresh, and a single
 * follow-up pass is scheduled if more requests arrive while refreshing.
 */
let inFlightRefresh: Promise<void> | null = null;
let refreshRequested = false;

async function runRefreshPass() {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);
}

export async function refreshLatestListingsView() {
  refreshRequested = true;
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      while (refreshRequested) {
        refreshRequested = false;
        try {
          await runRefreshPass();
        } catch (error) {
          if (!refreshRequested) {
            throw error;
          }
        }
      }
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

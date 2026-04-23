import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

function createCoalescedRefresh(runRefreshPass: () => Promise<void>) {
  let inFlightRefresh: Promise<void> | null = null;
  let refreshRequested = false;

  return async function refreshMaterializedView() {
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
  };
}

const refreshLatestListingsViewCoalesced = createCoalescedRefresh(async () => {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);
});

const refreshPriceGuessStartMarketSummariesCoalesced = createCoalescedRefresh(async () => {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_price_guess_start_market_summaries`);
});

/**
 * Refresh the mv_latest_active_listings materialized view.
 * Uses CONCURRENTLY so readers are not blocked during refresh.
 * Call after any listing insert, update, or status change.
 *
 * Coalesced: concurrent callers share one in-flight refresh, and a single
 * follow-up pass is scheduled if more requests arrive while refreshing.
 */
export async function refreshLatestListingsView() {
  return refreshLatestListingsViewCoalesced();
}

/**
 * Refresh the price-guess starting-point market summary materialized view.
 * Uses the same coalescing behavior as refreshLatestListingsView.
 */
export async function refreshPriceGuessStartMarketSummaries() {
  return refreshPriceGuessStartMarketSummariesCoalesced();
}

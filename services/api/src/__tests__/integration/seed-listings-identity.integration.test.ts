import { afterAll, describe, expect, it } from '@jest/globals';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
afterAll(async () => { await sql.end(); });

// A query-local relation exercises the real planner SQL without changing shared data.
const fixtureDb = ((strings: TemplateStringsArray, ...values: never[]) => sql`
  WITH canonical_listings(id, source_name, primary_source_listing_id, canonical_url, status, price_type) AS (
    VALUES
      ('old', 'funda', '11111111', 'https://www.funda.nl/reused/', 'sold', 'sale'),
      ('new', 'funda', '22222222', 'https://www.funda.nl/reused/', 'active', 'sale'),
      ('candidate', 'funda', NULL, 'https://www.funda.nl/reused/', 'active', 'sale'),
      ('duplicate-a', 'funda', '33333333', 'https://www.funda.nl/a/', 'active', 'sale'),
      ('duplicate-b', 'funda', '33333333', 'https://www.funda.nl/b/', 'active', 'sale')
  )
  ${sql(strings, ...values)}
`) as unknown as postgres.Sql;

interface ReplayEstimates {
  estimateDuplicateCanonicalCandidateCount(db: postgres.Sql, source: string, scope: string | null): Promise<number>;
  estimateCanonicalIdentityMatches(db: postgres.Sql, input: {
    source: string; scope: string | null; sourceListingIds: Set<string>; canonicalUrls: Set<string>;
    statusMode: 'active' | 'not_active';
  }): Promise<number>;
  estimateAbsentActiveCanonicalCount(db: postgres.Sql, source: string, scope: string | null, sets: {
    presentSourceListingIds: Set<string>; presentCanonicalUrls: Set<string>;
  }): Promise<number>;
}
const scriptPath = ['..', '..', '..', 'scripts', 'seed-listings.js'].join('/');
const { __seedListingsTest: estimates } = await import(scriptPath) as { __seedListingsTest: ReplayEstimates };

describe('mirror replay identity estimates', () => {
  it('counts duplicate source identities across changed URLs, excluding real relistings sharing a URL', async () => {
    expect(await estimates.estimateDuplicateCanonicalCandidateCount(fixtureDb, 'funda', null)).toBe(1);
  });

  it('does not report an old listing as reactivated when a distinct listing reuses its URL', async () => {
    expect(await estimates.estimateCanonicalIdentityMatches(fixtureDb, {
      source: 'funda', scope: null, sourceListingIds: new Set(['22222222']),
      canonicalUrls: new Set(['https://www.funda.nl/reused/']), statusMode: 'not_active',
    })).toBe(0);
  });

  it('reserves URL-only terminal matching for a candidate with no source ID', async () => {
    expect(await estimates.estimateCanonicalIdentityMatches(fixtureDb, {
      source: 'funda', scope: null, sourceListingIds: new Set(['11111111']),
      canonicalUrls: new Set(['https://www.funda.nl/reused/']), statusMode: 'active',
    })).toBe(1);
  });

  it('keeps an absent new listing absent despite seeing the old listing at the same URL', async () => {
    expect(await estimates.estimateAbsentActiveCanonicalCount(fixtureDb, 'funda', null, {
      presentSourceListingIds: new Set(['11111111', '33333333']),
      presentCanonicalUrls: new Set(['https://www.funda.nl/reused/']),
    })).toBe(1);
  });
});

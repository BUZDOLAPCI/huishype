import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, canonicalListings, properties } from '../../db/index.js';
import { buildApp } from '../../app.js';
import { projectListingAvailability } from '../../services/listing-lifecycle.js';
import { expireListingAvailability, refreshExpiredListingProjections, runListingLifecycleMaintenance } from '../../services/listing-lifecycle-maintenance.js';
import { buildPropertyListingFactsJoin } from '../../services/property-queries.js';
import { buildCanonicalGroupsForTileUncached, lngLatToWorldUnits, PROPERTY_TILE_EXTENT } from '../../services/property-grouping.js';
import { createDefaultMapFilters } from '../../services/map-filters.js';
import type { FastifyInstance } from 'fastify';

describe('availability evidence and published listing projections', () => {
  const propertyIds: string[] = [];
  let app: FastifyInstance;
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000);

  async function fixture(positiveAt: Date, options: { expiredFlag?: boolean; status?: 'active' | 'sold'; priceType?: 'sale' | 'rent' } = {}) {
    const propertyId = randomUUID();
    propertyIds.push(propertyId);
    await db.execute(sql`
      INSERT INTO properties (id, country_code, street, house_number, city, postal_code, status, geometry)
      VALUES (${propertyId}, 'NL', 'Lifecycle Fixture', ${propertyIds.length}, 'Lifecycle Town', '1234AB', 'active',
        ST_SetSRID(ST_MakePoint(-63.875, -21.625), 4326))
    `);
    const [listing] = await db.insert(canonicalListings).values({
      propertyId, sourceName: 'funda', primarySourceListingId: randomUUID(),
      canonicalUrl: `https://www.funda.nl/detail/koop/fixture/${randomUUID()}`,
      status: options.status ?? 'active', verificationState: 'validated', askingPrice: 410000,
      priceType: options.priceType ?? 'sale', priceUnit: 'listing', priceCondition: 'asking',
      pricePeriod: options.priceType === 'rent' ? 'month' : 'total', lastSeenAt: positiveAt,
      lastPositiveAvailabilityAt: positiveAt,
      availabilityExpiresAt: new Date(positiveAt.getTime() + 30 * 86400000),
      activeEligible: options.expiredFlag ?? options.status !== 'sold',
      availabilityEndedAt: options.status === 'sold' ? now : null,
    }).returning();
    return { propertyId, listing };
  }

  async function facts(propertyId: string) {
    const rows = await db.execute<{ market_state: string; asking_price: number | null; has_active_listing: boolean }>(sql`
      SELECT lf.market_state, lf.asking_price, lf.has_active_listing
      FROM properties p ${buildPropertyListingFactsJoin('p', 'lf')}
      WHERE p.id = ${propertyId}
    `);
    return Array.from(rows)[0];
  }

  beforeAll(async () => { app = await buildApp({ logger: false }); });
  afterAll(async () => {
    if (propertyIds.length) await db.delete(properties).where(inArray(properties.id, propertyIds));
    await app.close();
  });

  it('keeps 29-day positive evidence current and excludes exactly expired evidence from asking price and active map filters', async () => {
    const current = await fixture(daysAgo(29));
    const expired = await fixture(daysAgo(30));
    expect(await facts(current.propertyId)).toMatchObject({ market_state: 'for-sale', has_active_listing: true });
    expect(await facts(expired.propertyId)).toEqual({ market_state: 'not-listed', asking_price: null, has_active_listing: false });
    const response = await app.inject({ method: 'GET', url: `/properties/${expired.propertyId}/listings` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ status: 'active', activeEligible: false, askingPrice: 410000, soldAt: null, rentedAt: null, withdrawnAt: null });
    const [worldX, worldY] = lngLatToWorldUnits(-63.875, -21.625, 20);
    const tile = { z: 20, x: Math.floor(worldX / PROPERTY_TILE_EXTENT), y: Math.floor(worldY / PROPERTY_TILE_EXTENT) };
    const groups = await buildCanonicalGroupsForTileUncached(tile, { ...createDefaultMapFilters(), marketState: ['for-sale'] });
    const ids = groups.flatMap(group => group.propertyIds);
    expect(ids).toContain(current.propertyId);
    expect(ids).not.toContain(expired.propertyId);
  });

  it('expires concurrently once, retains facts/history and persists refresh demand across a failed refresh', async () => {
    const expired = await fixture(daysAgo(31));
    const [before] = await db.select().from(canonicalListings).where(eq(canonicalListings.id, expired.listing.id));
    const counts = await Promise.all([expireListingAvailability(), expireListingAvailability()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(1);
    expect(await expireListingAvailability()).toBe(0);
    const [after] = await db.select().from(canonicalListings).where(eq(canonicalListings.id, expired.listing.id));
    expect(after).toEqual({ ...before, activeEligible: false });
    await expect(refreshExpiredListingProjections([async () => { throw new Error('interrupted'); }])).rejects.toThrow('interrupted');
    let refreshes = 0;
    expect(await refreshExpiredListingProjections([async () => { refreshes += 1; }])).toBe(true);
    expect(await refreshExpiredListingProjections([async () => { refreshes += 1; }])).toBe(false);
    expect(refreshes).toBe(1);
  });

  it('updates materialized asking projections without any incoming event and preserves history on restoration', async () => {
    const expired = await fixture(daysAgo(31));
    await fixture(daysAgo(32));
    const maintenance = await runListingLifecycleMaintenance(1);
    expect(maintenance.expiredCount).toBeGreaterThanOrEqual(2);
    const rows = await db.execute(sql`SELECT * FROM mv_latest_active_listings WHERE property_id = ${expired.propertyId}`);
    expect(Array.from(rows)).toHaveLength(0);
    const projection = projectListingAvailability(expired.listing, { kind: 'positive', observedAt: now }, now);
    await db.update(canonicalListings).set(projection).where(eq(canonicalListings.id, expired.listing.id));
    expect(await facts(expired.propertyId)).toMatchObject({ market_state: 'for-sale', has_active_listing: true });
    const replay = projectListingAvailability(projection, { kind: 'positive', observedAt: daysAgo(31) }, now);
    expect(replay).toEqual(projection);
  });

  it('lets a newer terminal observation defeat grace and a newer positive restore it', async () => {
    const sold = await fixture(daysAgo(1), { status: 'sold' });
    expect(await facts(sold.propertyId)).toMatchObject({ market_state: 'sold', asking_price: null, has_active_listing: false });
    const replay = projectListingAvailability(sold.listing, { kind: 'positive', observedAt: now }, now);
    expect(replay.activeEligible).toBe(false);
    expect(replay.status).toBe('sold');
    const renewedAt = new Date(now.getTime() + 1000);
    const renewed = projectListingAvailability(replay, { kind: 'positive', observedAt: renewedAt }, renewedAt);
    await db.update(canonicalListings).set(renewed).where(eq(canonicalListings.id, sold.listing.id));
    expect(await facts(sold.propertyId)).toMatchObject({ market_state: 'for-sale', has_active_listing: true });
  });

  it('backfills only source availability, never user previews or diagnostic-only histories', async () => {
    const migration = readFileSync(new URL('../../../drizzle/0061_listing_availability_grace.sql', import.meta.url), 'utf8');
    const backfill = migration.slice(migration.indexOf('-- Use source observation times'), migration.indexOf('DROP MATERIALIZED VIEW'));
    await db.transaction(async tx => {
      // Shadow only the migration input tables inside this connection. Real
      // canonical data and the listing invalidation triggers remain untouched.
      await tx.execute(sql.raw(`
        CREATE TEMP TABLE canonical_listings (
          id text PRIMARY KEY, status text DEFAULT 'active', verification_state text DEFAULT 'validated',
          origin_summary text DEFAULT 'mirror', last_seen_at timestamptz DEFAULT now(),
          last_mirror_seen_at timestamptz, last_positive_availability_at timestamptz,
          availability_ended_at timestamptz, availability_expires_at timestamptz,
          sold_at timestamptz, rented_at timestamptz, withdrawn_at timestamptz,
          active_eligible boolean NOT NULL DEFAULT false
        ) ON COMMIT DROP;
        CREATE TEMP TABLE listing_observations (
          id text PRIMARY KEY, origin text, source_status text, last_seen_at timestamptz,
          source_updated_at timestamptz, observed_at timestamptz DEFAULT now(),
          stale_for_projection boolean DEFAULT false, diagnostic_status text
        ) ON COMMIT DROP;
        CREATE TEMP TABLE listing_observation_links (
          canonical_listing_id text, listing_observation_id text
        ) ON COMMIT DROP;
        INSERT INTO canonical_listings(id,origin_summary) VALUES
          ('user-only','user'),('user-linked','user'),('source','mirror'),
          ('diagnostic','mirror'),('legacy-mirror','mirror'),('old-source','mirror');
        INSERT INTO canonical_listings(id,status,withdrawn_at) VALUES
          ('repair','withdrawn',now()),('user-repair','withdrawn',now()),('terminal','withdrawn',now());
        INSERT INTO listing_observations(id,origin,source_status,last_seen_at) VALUES
          ('user-linked','user','available',now()),
          ('source','mirror','available',now()-interval '1 day'),
          ('diagnostic','mirror','not_found',now()),
          ('old-source','mirror','available',now()-interval '40 days');
        INSERT INTO listing_observation_links SELECT id,id FROM listing_observations;
        INSERT INTO listing_observations(id,origin,source_status,last_seen_at) VALUES
          ('repair-positive','mirror','available',now()-interval '1 day'),
          ('repair-diagnostic','mirror','not_found',now()),
          ('user-positive','user','available',now()-interval '1 day'),
          ('user-diagnostic','mirror','not_found',now()),
          ('terminal-positive','mirror','available',now()-interval '1 day'),
          ('terminal-explicit','mirror','withdrawn',now());
        INSERT INTO listing_observation_links VALUES
          ('repair','repair-positive'),('repair','repair-diagnostic'),
          ('user-repair','user-positive'),('user-repair','user-diagnostic'),
          ('terminal','terminal-positive'),('terminal','terminal-explicit');
      `));
      for (const statement of backfill.split('--> statement-breakpoint').filter(value => value.trim())) {
        await tx.execute(sql.raw(statement));
      }
      const rows = Array.from(await tx.execute<{ id: string; status: string; active_eligible: boolean; last_positive_availability_at: Date | null }>(sql`
        SELECT id,status,active_eligible,last_positive_availability_at FROM canonical_listings ORDER BY id
      `));
      expect(rows.filter(row => row.active_eligible).map(row => row.id)).toEqual(['legacy-mirror','repair','source']);
      for (const id of ['user-only','user-linked','diagnostic','user-repair']) {
        expect(rows.find(row => row.id === id)?.last_positive_availability_at).toBeNull();
      }
      expect(rows.find(row => row.id === 'repair')?.status).toBe('active');
      expect(rows.find(row => row.id === 'user-repair')?.status).toBe('withdrawn');
      expect(rows.find(row => row.id === 'terminal')?.status).toBe('withdrawn');
      expect(rows.find(row => row.id === 'old-source')?.last_positive_availability_at).not.toBeNull();
    });
  });
});

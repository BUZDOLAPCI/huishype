import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
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
    await runListingLifecycleMaintenance();
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
});

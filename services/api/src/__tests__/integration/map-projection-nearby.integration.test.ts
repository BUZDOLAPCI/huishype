import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import type { MapFilters } from '../../services/map-filters.js';
import {
  resolveNearbyFollowingProjectedFeature,
  resolveNearbyProjectedFeature,
} from '../../services/map-projection-nearby.js';
import {
  createIntegrationFollow,
  createIntegrationListing,
  createIntegrationProperty,
  createIntegrationUser,
  refreshIntegrationMapProjection,
} from './helpers/fixtures.js';

const SALE_LON = -29.612345;
const RENT_LON = -29.612045;
const FIXTURE_LAT = 0.223456;
const NEARBY_ZOOM = 20;

const SALE_FILTERS_ALLOWING_RENT: MapFilters = {
  salePriceFrom: null,
  salePriceTo: 100,
  rentPriceFrom: null,
  rentPriceTo: null,
  marketState: ['for-sale', 'for-rent'],
  activity: 'all',
};

const RENT_FILTERS_ALLOWING_SALE: MapFilters = {
  salePriceFrom: null,
  salePriceTo: null,
  rentPriceFrom: null,
  rentPriceTo: 100,
  marketState: ['for-sale', 'for-rent'],
  activity: 'all',
};

describe('Martin nearby projection filter parity', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createMixedMarketNearbyFixture(includeFollowingActivity = false) {
    const saleProperty = await createIntegrationProperty({
      street: 'Nearby Projection Sale Street',
      houseNumber: 1,
      lon: SALE_LON,
      lat: FIXTURE_LAT,
      officialValuation: 450000,
    });
    await createIntegrationListing({
      propertyId: saleProperty.id,
      askingPrice: 450000,
      priceType: 'sale',
      thumbnailUrl: 'https://cdn.example.com/nearby-projection-sale.jpg',
    });

    const rentProperty = await createIntegrationProperty({
      street: 'Nearby Projection Rent Street',
      houseNumber: 2,
      lon: RENT_LON,
      lat: FIXTURE_LAT,
      officialValuation: 350000,
    });
    await createIntegrationListing({
      propertyId: rentProperty.id,
      askingPrice: 1800,
      priceType: 'rent',
      thumbnailUrl: 'https://cdn.example.com/nearby-projection-rent.jpg',
    });

    let viewerId: string | null = null;
    if (includeFollowingActivity) {
      const viewer = await createIntegrationUser(app, { label: 'nearby-projection-viewer' });
      const actor = await createIntegrationUser(app, { label: 'nearby-projection-actor' });
      viewerId = viewer.userId;
      await createIntegrationFollow({
        followerUserId: viewer.userId,
        followedUserId: actor.userId,
      });
      await db.execute(sql`
        INSERT INTO comments (property_id, user_id, content, created_at, updated_at)
        VALUES
          (${saleProperty.id}, ${actor.userId}, 'Nearby projection sale activity', NOW(), NOW()),
          (${rentProperty.id}, ${actor.userId}, 'Nearby projection rent activity', NOW(), NOW())
      `);
    }

    await refreshIntegrationMapProjection([saleProperty.id, rentProperty.id]);

    return {
      salePropertyId: saleProperty.id,
      rentPropertyId: rentProperty.id,
      viewerId,
      propertyIds: [saleProperty.id, rentProperty.id],
    };
  }

  async function cleanup(propertyIds: string[]) {
    await db.execute(sql`DELETE FROM properties WHERE id IN (${sql.join(propertyIds, sql`, `)})`);
  }

  it('keeps rent nearby records when sale price filters are active and market state allows rent', async () => {
    const fixture = await createMixedMarketNearbyFixture();

    try {
      const result = await resolveNearbyProjectedFeature(
        RENT_LON,
        FIXTURE_LAT,
        NEARBY_ZOOM,
        SALE_FILTERS_ALLOWING_RENT
      );

      expect(result?.primaryPropertyId).toBe(fixture.rentPropertyId);
      expect(result?.marketState).toBe('for-rent');
    } finally {
      await cleanup(fixture.propertyIds);
    }
  });

  it('keeps sale nearby records when rent price filters are active and market state allows sale', async () => {
    const fixture = await createMixedMarketNearbyFixture();

    try {
      const result = await resolveNearbyProjectedFeature(
        SALE_LON,
        FIXTURE_LAT,
        NEARBY_ZOOM,
        RENT_FILTERS_ALLOWING_SALE
      );

      expect(result?.primaryPropertyId).toBe(fixture.salePropertyId);
      expect(result?.marketState).toBe('for-sale');
    } finally {
      await cleanup(fixture.propertyIds);
    }
  });

  it('keeps following rent nearby records when sale price filters are active and market state allows rent', async () => {
    const fixture = await createMixedMarketNearbyFixture(true);

    try {
      const result = await resolveNearbyFollowingProjectedFeature(
        RENT_LON,
        FIXTURE_LAT,
        NEARBY_ZOOM,
        fixture.viewerId ?? '',
        SALE_FILTERS_ALLOWING_RENT
      );

      expect(result?.primaryPropertyId).toBe(fixture.rentPropertyId);
      expect(result?.marketState).toBe('for-rent');
    } finally {
      await cleanup(fixture.propertyIds);
    }
  });

  it('keeps following sale nearby records when rent price filters are active and market state allows sale', async () => {
    const fixture = await createMixedMarketNearbyFixture(true);

    try {
      const result = await resolveNearbyFollowingProjectedFeature(
        SALE_LON,
        FIXTURE_LAT,
        NEARBY_ZOOM,
        fixture.viewerId ?? '',
        RENT_FILTERS_ALLOWING_SALE
      );

      expect(result?.primaryPropertyId).toBe(fixture.salePropertyId);
      expect(result?.marketState).toBe('for-sale');
    } finally {
      await cleanup(fixture.propertyIds);
    }
  });
});

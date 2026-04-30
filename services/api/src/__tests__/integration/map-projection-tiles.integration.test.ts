import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  createIntegrationFollow,
  createIntegrationListing,
  createIntegrationProperty,
  createIntegrationUser,
  refreshIntegrationMapProjection,
  tileCoordinatesForPoint,
} from './helpers/fixtures.js';
import { markPropertyRead } from '../../services/property-read-state.js';

type TileFunctionName = 'property_nodes' | 'read_property_nodes' | 'following_property_nodes';
type ListingPriceType = 'sale' | 'rent';

const FIXTURE_LON = -29.712345;
const FIXTURE_LAT = 0.123456;
const TILE_ZOOM = 17;

describe('Martin map projection tile filters', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  async function propertyTileByteLength(
    functionName: TileFunctionName,
    queryParams: Record<string, string | number>
  ) {
    const tile = tileCoordinatesForPoint(FIXTURE_LON, FIXTURE_LAT, TILE_ZOOM);
    const paramsJson = JSON.stringify(queryParams);
    const rows = await db.execute<{ byte_length: number }>(sql`
      SELECT octet_length(
        martin_tiles.${sql.raw(functionName)}(${tile.z}, ${tile.x}, ${tile.y}, ${paramsJson}::json)
      ) AS byte_length
    `);

    return Number(Array.from(rows)[0]?.byte_length ?? 0);
  }

  async function createPricedProperty(priceType: ListingPriceType, askingPrice: number) {
    const property = await createIntegrationProperty({
      street: `Martin ${priceType} Filter Street`,
      lon: FIXTURE_LON,
      lat: FIXTURE_LAT,
      officialValuation: priceType === 'sale' ? askingPrice : 350000,
    });
    await createIntegrationListing({
      propertyId: property.id,
      askingPrice,
      priceType,
      thumbnailUrl: `https://cdn.example.com/martin-${priceType}-filter.jpg`,
    });
    await refreshIntegrationMapProjection(property.id);

    return property;
  }

  async function createReadTileFixture(priceType: ListingPriceType, askingPrice: number) {
    const viewer = await createIntegrationUser(app, { label: `martin-read-${priceType}` });
    const property = await createPricedProperty(priceType, askingPrice);
    await markPropertyRead(property.id, { userId: viewer.userId });

    return { propertyId: property.id, viewerId: viewer.userId };
  }

  async function createFollowingTileFixture(priceType: ListingPriceType, askingPrice: number) {
    const viewer = await createIntegrationUser(app, { label: `martin-follow-viewer-${priceType}` });
    const actor = await createIntegrationUser(app, { label: `martin-follow-actor-${priceType}` });
    const property = await createIntegrationProperty({
      street: `Martin following ${priceType} Filter Street`,
      lon: FIXTURE_LON,
      lat: FIXTURE_LAT,
      officialValuation: priceType === 'sale' ? askingPrice : 350000,
    });
    await createIntegrationListing({
      propertyId: property.id,
      askingPrice,
      priceType,
      thumbnailUrl: `https://cdn.example.com/martin-following-${priceType}-filter.jpg`,
    });
    await createIntegrationFollow({
      followerUserId: viewer.userId,
      followedUserId: actor.userId,
    });
    await db.execute(sql`
      INSERT INTO comments (property_id, user_id, content, created_at, updated_at)
      VALUES (${property.id}, ${actor.userId}, ${`Following ${priceType} activity`}, NOW(), NOW())
    `);
    await refreshIntegrationMapProjection(property.id);

    return { propertyId: property.id, viewerId: viewer.userId };
  }

  async function createMixedMarketTileFixture(functionName: TileFunctionName) {
    const saleProperty = await createPricedProperty('sale', 450000);
    const rentProperty = await createIntegrationProperty({
      street: 'Martin Mixed Rent Filter Street',
      houseNumber: 2,
      lon: FIXTURE_LON + 0.0002,
      lat: FIXTURE_LAT,
      officialValuation: 350000,
    });
    await createIntegrationListing({
      propertyId: rentProperty.id,
      askingPrice: 1800,
      priceType: 'rent',
      thumbnailUrl: 'https://cdn.example.com/martin-mixed-rent-filter.jpg',
    });

    let viewerId: string | null = null;
    if (functionName === 'read_property_nodes') {
      const viewer = await createIntegrationUser(app, { label: 'martin-read-mixed-market' });
      viewerId = viewer.userId;
      await markPropertyRead(saleProperty.id, { userId: viewer.userId });
      await markPropertyRead(rentProperty.id, { userId: viewer.userId });
    } else if (functionName === 'following_property_nodes') {
      const viewer = await createIntegrationUser(app, { label: 'martin-follow-mixed-viewer' });
      const actor = await createIntegrationUser(app, { label: 'martin-follow-mixed-actor' });
      viewerId = viewer.userId;
      await createIntegrationFollow({
        followerUserId: viewer.userId,
        followedUserId: actor.userId,
      });
      await db.execute(sql`
        INSERT INTO comments (property_id, user_id, content, created_at, updated_at)
        VALUES
          (${saleProperty.id}, ${actor.userId}, 'Following mixed sale activity', NOW(), NOW()),
          (${rentProperty.id}, ${actor.userId}, 'Following mixed rent activity', NOW(), NOW())
      `);
    }

    await refreshIntegrationMapProjection([saleProperty.id, rentProperty.id]);

    return {
      propertyIds: [saleProperty.id, rentProperty.id],
      viewerId,
    };
  }

  function tileFunctionParams(
    functionName: TileFunctionName,
    viewerId: string | null
  ): Record<string, string | number> {
    if (functionName === 'read_property_nodes') {
      return { user_id: viewerId ?? '', read_version: 'test' };
    }
    if (functionName === 'following_property_nodes') {
      return { viewer_id: viewerId ?? '', follow_version: 'test' };
    }
    return {};
  }

  async function cleanup(propertyId: string | string[]) {
    const propertyIds = Array.isArray(propertyId) ? propertyId : [propertyId];
    await db.execute(sql`DELETE FROM properties WHERE id IN (${sql.join(propertyIds, sql`, `)})`);
  }

  it('read_property_nodes rejects sale listings outside canonical sale price filters', async () => {
    const fixture = await createReadTileFixture('sale', 450000);

    try {
      await expect(
        propertyTileByteLength('read_property_nodes', {
          user_id: fixture.viewerId,
          read_version: 'test',
          marketState: 'for-sale',
          salePriceFrom: 400000,
          salePriceTo: 500000,
        })
      ).resolves.toBeGreaterThan(0);
      await expect(
        propertyTileByteLength('read_property_nodes', {
          user_id: fixture.viewerId,
          read_version: 'test',
          marketState: 'for-sale',
          salePriceTo: 400000,
        })
      ).resolves.toBe(0);
    } finally {
      await cleanup(fixture.propertyId);
    }
  });

  it('read_property_nodes rejects rent listings outside canonical rent price filters', async () => {
    const fixture = await createReadTileFixture('rent', 1800);

    try {
      await expect(
        propertyTileByteLength('read_property_nodes', {
          user_id: fixture.viewerId,
          read_version: 'test',
          marketState: 'for-rent',
          rentPriceFrom: 1600,
          rentPriceTo: 2000,
        })
      ).resolves.toBeGreaterThan(0);
      await expect(
        propertyTileByteLength('read_property_nodes', {
          user_id: fixture.viewerId,
          read_version: 'test',
          marketState: 'for-rent',
          rentPriceTo: 1500,
        })
      ).resolves.toBe(0);
    } finally {
      await cleanup(fixture.propertyId);
    }
  });

  it('following_property_nodes rejects sale listings outside canonical sale price filters', async () => {
    const fixture = await createFollowingTileFixture('sale', 450000);

    try {
      await expect(
        propertyTileByteLength('following_property_nodes', {
          viewer_id: fixture.viewerId,
          follow_version: 'test',
          marketState: 'for-sale',
          salePriceFrom: 400000,
          salePriceTo: 500000,
        })
      ).resolves.toBeGreaterThan(0);
      await expect(
        propertyTileByteLength('following_property_nodes', {
          viewer_id: fixture.viewerId,
          follow_version: 'test',
          marketState: 'for-sale',
          salePriceTo: 400000,
        })
      ).resolves.toBe(0);
    } finally {
      await cleanup(fixture.propertyId);
    }
  });

  it('following_property_nodes rejects rent listings outside canonical rent price filters', async () => {
    const fixture = await createFollowingTileFixture('rent', 1800);

    try {
      await expect(
        propertyTileByteLength('following_property_nodes', {
          viewer_id: fixture.viewerId,
          follow_version: 'test',
          marketState: 'for-rent',
          rentPriceFrom: 1600,
          rentPriceTo: 2000,
        })
      ).resolves.toBeGreaterThan(0);
      await expect(
        propertyTileByteLength('following_property_nodes', {
          viewer_id: fixture.viewerId,
          follow_version: 'test',
          marketState: 'for-rent',
          rentPriceTo: 1500,
        })
      ).resolves.toBe(0);
    } finally {
      await cleanup(fixture.propertyId);
    }
  });

  it.each<TileFunctionName>(['property_nodes', 'read_property_nodes', 'following_property_nodes'])(
    '%s keeps rent records when sale price filters are active and market state allows rent',
    async (functionName) => {
      const fixture = await createMixedMarketTileFixture(functionName);

      try {
        await expect(
          propertyTileByteLength(functionName, {
            ...tileFunctionParams(functionName, fixture.viewerId),
            marketState: 'for-sale,for-rent',
            salePriceTo: 100,
          })
        ).resolves.toBeGreaterThan(0);
      } finally {
        await cleanup(fixture.propertyIds);
      }
    }
  );

  it.each<TileFunctionName>(['property_nodes', 'read_property_nodes', 'following_property_nodes'])(
    '%s keeps sale records when rent price filters are active and market state allows sale',
    async (functionName) => {
      const fixture = await createMixedMarketTileFixture(functionName);

      try {
        await expect(
          propertyTileByteLength(functionName, {
            ...tileFunctionParams(functionName, fixture.viewerId),
            marketState: 'for-sale,for-rent',
            rentPriceTo: 100,
          })
        ).resolves.toBeGreaterThan(0);
      } finally {
        await cleanup(fixture.propertyIds);
      }
    }
  );
});

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

type DecodedMvtFeature = {
  properties: Record<string, unknown>;
};

class MvtReader {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  get done() {
    return this.offset >= this.data.length;
  }

  readTag() {
    const tag = this.readVarint();
    return { field: tag >> 3, wire: tag & 7 };
  }

  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (this.offset < this.data.length) {
      const byte = this.data[this.offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7;
    }
    throw new Error('Unexpected end of MVT varint');
  }

  readBytes(): Buffer {
    const length = this.readVarint();
    const end = this.offset + length;
    const value = this.data.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readString(): string {
    return this.readBytes().toString('utf8');
  }

  readFloat(): number {
    const value = this.data.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  readDouble(): number {
    const value = this.data.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  skip(wire: number): void {
    if (wire === 0) {
      this.readVarint();
      return;
    }
    if (wire === 1) {
      this.offset += 8;
      return;
    }
    if (wire === 2) {
      this.offset += this.readVarint();
      return;
    }
    if (wire === 5) {
      this.offset += 4;
      return;
    }
    throw new Error(`Unsupported MVT wire type ${wire}`);
  }
}

function decodeSInt(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function decodeMvtValue(data: Buffer): unknown {
  const reader = new MvtReader(data);
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) return reader.readString();
    if (field === 2 && wire === 5) return reader.readFloat();
    if (field === 3 && wire === 1) return reader.readDouble();
    if (field === 4 && wire === 0) return reader.readVarint();
    if (field === 5 && wire === 0) return reader.readVarint();
    if (field === 6 && wire === 0) return decodeSInt(reader.readVarint());
    if (field === 7 && wire === 0) return reader.readVarint() !== 0;
    reader.skip(wire);
  }
  return null;
}

function decodeFeatureTags(data: Buffer): number[] {
  const reader = new MvtReader(data);
  const tags: number[] = [];
  while (!reader.done) {
    tags.push(reader.readVarint());
  }
  return tags;
}

function decodeMvtLayer(data: Buffer): {
  name: string | null;
  keys: string[];
  values: unknown[];
  features: Buffer[];
} {
  const reader = new MvtReader(data);
  const keys: string[] = [];
  const values: unknown[] = [];
  const features: Buffer[] = [];
  let name: string | null = null;

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1 && wire === 2) {
      name = reader.readString();
    } else if (field === 2 && wire === 2) {
      features.push(reader.readBytes());
    } else if (field === 3 && wire === 2) {
      keys.push(reader.readString());
    } else if (field === 4 && wire === 2) {
      values.push(decodeMvtValue(reader.readBytes()));
    } else {
      reader.skip(wire);
    }
  }

  return { name, keys, values, features };
}

function decodeMvtFeatures(tile: Buffer, layerName: string): DecodedMvtFeature[] {
  const reader = new MvtReader(tile);
  const decodedFeatures: DecodedMvtFeature[] = [];

  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field !== 3 || wire !== 2) {
      reader.skip(wire);
      continue;
    }

    const layer = decodeMvtLayer(reader.readBytes());
    if (layer.name !== layerName) {
      continue;
    }

    for (const featureData of layer.features) {
      const featureReader = new MvtReader(featureData);
      const tagIndexes: number[] = [];
      while (!featureReader.done) {
        const featureTag = featureReader.readTag();
        if (featureTag.field === 2 && featureTag.wire === 2) {
          tagIndexes.push(...decodeFeatureTags(featureReader.readBytes()));
        } else if (featureTag.field > 2 && tagIndexes.length > 0) {
          break;
        } else {
          featureReader.skip(featureTag.wire);
        }
      }

      const properties: Record<string, unknown> = {};
      for (let index = 0; index < tagIndexes.length; index += 2) {
        const key = layer.keys[tagIndexes[index]];
        if (key) {
          properties[key] = layer.values[tagIndexes[index + 1]];
        }
      }
      decodedFeatures.push({ properties });
    }
  }

  return decodedFeatures;
}

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

  async function propertyTileFeatures(queryParams: Record<string, string | number>) {
    const tile = tileCoordinatesForPoint(FIXTURE_LON, FIXTURE_LAT, TILE_ZOOM);
    const paramsJson = JSON.stringify(queryParams);
    const rows = await db.execute<{ mvt: Buffer | string }>(sql`
      SELECT martin_tiles.property_nodes(${tile.z}, ${tile.x}, ${tile.y}, ${paramsJson}::json) AS mvt
    `);
    const rawMvt = Array.from(rows)[0]?.mvt;
    const mvt =
      typeof rawMvt === 'string'
        ? Buffer.from(rawMvt.replace(/^\\x/, ''), 'hex')
        : Buffer.from(rawMvt ?? []);

    return decodeMvtFeatures(mvt, 'properties');
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

  it('property_nodes emits close-zoom ghost singles and clusters with the web style fields', async () => {
    const clusterA = await createIntegrationProperty({
      street: 'Martin Ghost Cluster Street',
      houseNumber: 1,
      lon: FIXTURE_LON,
      lat: FIXTURE_LAT,
      officialValuation: 350000,
    });
    const clusterB = await createIntegrationProperty({
      street: 'Martin Ghost Cluster Street',
      houseNumber: 2,
      lon: FIXTURE_LON + 0.00002,
      lat: FIXTURE_LAT,
      officialValuation: 360000,
    });
    const single = await createIntegrationProperty({
      street: 'Martin Ghost Single Street',
      houseNumber: 3,
      lon: FIXTURE_LON + 0.001,
      lat: FIXTURE_LAT,
      officialValuation: 370000,
    });
    const propertyIds = [clusterA.id, clusterB.id, single.id];

    try {
      await refreshIntegrationMapProjection(propertyIds);
      const quietRows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM map_quiet_property_points
        WHERE property_id IN (${sql.join(propertyIds, sql`, `)})
      `);

      expect(Array.from(quietRows)[0]?.count).toBe('0');

      const features = await propertyTileFeatures({});
      const ghostFeatures = features
        .map((feature) => feature.properties)
        .filter((properties) => properties.node_class === 'ghost');
      const ghostCluster = ghostFeatures.find((properties) => properties.group_kind === 'cluster');
      const ghostSingle = ghostFeatures.find(
        (properties) =>
          properties.group_kind === 'single' && properties.primary_property_id === single.id
      );

      expect(ghostCluster).toMatchObject({
        node_class: 'ghost',
        group_kind: 'cluster',
        point_count: 2,
        activeListingCount: 0,
        completedListingCount: 0,
        socialCount: 0,
        recentSocialCount: 0,
      });
      expect(String(ghostCluster?.property_ids)).toContain(clusterA.id);
      expect(String(ghostCluster?.property_ids)).toContain(clusterB.id);
      expect(ghostCluster).toHaveProperty('primary_property_id');
      expect(ghostSingle).toMatchObject({
        node_class: 'ghost',
        group_kind: 'single',
        point_count: 1,
        primary_property_id: single.id,
        property_ids: single.id,
        preview_property_ids: single.id,
      });
    } finally {
      await cleanup(propertyIds);
    }
  });

  it('validates that public quiet ghosts stay tile-derived instead of rebuild-materialized', async () => {
    const rows = await db.execute<{ check_name: string; ok: boolean; detail: string }>(sql`
      SELECT check_name, ok, detail
      FROM martin_tiles.validate_map_projections()
      WHERE check_name = 'quiet_ghosts_are_tile_derived'
    `);

    expect(Array.from(rows)).toEqual([
      {
        check_name: 'quiet_ghosts_are_tile_derived',
        ok: true,
        detail: 'public ghost nodes are derived from indexed properties at z17+',
      },
    ]);
  });
});

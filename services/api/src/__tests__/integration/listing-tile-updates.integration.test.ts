import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { sql, inArray } from 'drizzle-orm';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { db, canonicalListings, properties } from '../../db/index.js';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import {
  claimListingTileUpdate, expandListingTilePropertyUpdates, getListingTileServingState,
  publishClaimedListingTileUpdate, runListingTileUpdates,
} from '../../services/listing-tile-updates.js';
import { buildCanonicalGroupsForTileUncached } from '../../services/property-grouping.js';
import { createDefaultMapFilters } from '../../services/map-filters.js';
import {
  encodePropertyTilePyramidTileFromPromotedNodes, lookupCurrentPropertyTilePyramidVersion,
} from '../../services/property-tile-pyramid.js';
import { resetPropertyTileCacheForTests } from '../../routes/tiles.js';

// This suite owns the durable global queue while running. Preserve preexisting
// work in the isolated integration database and restore it after the suite.
describe('durable listing tile publication', () => {
  const tile = { z: 0, x: 0, y: 0 };
  const suffix = randomUUID().replaceAll('-', '');
  const coverageId = `listing-update-test-${suffix}`;
  const propertyBackup = sql.raw(`listing_property_backup_${suffix}`);
  const tileBackup = sql.raw(`listing_tile_backup_${suffix}`);
  const oldCoverage = process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID;
  const oldZoom = process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM;
  const propertyIds: string[] = [];
  const versionIds: string[] = [];
  let versionId: string;
  let app: FastifyInstance;

  async function createVersion() {
    const id = randomUUID();
    versionIds.push(id);
    const current = Array.from(await db.execute<{ current_version_id: string }>(sql`
      SELECT current_version_id FROM property_tile_pyramid_current WHERE coverage_id=${coverageId}
    `))[0];
    await db.execute(sql`
      INSERT INTO property_tile_pyramid_versions
        (id,coverage_id,filter_signature,max_zoom,pyramid_kind,config_hash,build_inputs_hash,
         source_watermark_hash,status,validated_at,coverage_snapshot_json,expected_tile_count,validated_tile_count)
      VALUES (${id},${coverageId},'default',0,'public_default_low_zoom',${id},${id},${id},
        'validated',now(),'{"bounds":{"minLon":-180,"minLat":-85,"maxLon":180,"maxLat":85},"minZoom":0,"maxZoom":0}'::jsonb,1,1)
    `);
    await db.execute(sql`SELECT ensure_property_tile_pyramid_version_partitions(${id}::uuid)`);
    await db.execute(sql`
      INSERT INTO property_tile_pyramid_tiles
        (version_id,z,x,y,tile_status,validation_status,node_count,etag,validated_at)
      VALUES (${id},0,0,0,'valid_empty','validated',0,${`empty-${id}`},now())
    `);
    await db.execute(sql`
      SELECT promote_property_tile_pyramid_version(${id}::uuid,${current?.current_version_id ?? null}::uuid,'listing update integration','jest')
    `);
    return id;
  }

  async function fixture(count = 1) {
    const ids = Array.from({ length: count }, () => randomUUID());
    propertyIds.push(...ids);
    await db.execute(sql`
      INSERT INTO properties(id,country_code,street,house_number,city,postal_code,status,geometry)
      VALUES ${sql.join(ids.map((id, index) => sql`(${id},'NL','Tile lifecycle fixture',${index},
        'Fixture Town','1234AB','active',ST_SetSRID(ST_MakePoint(5.125,52.125),4326))`),sql`, `)}
    `);
    await db.insert(canonicalListings).values(ids.map(id => ({
      propertyId: id,sourceName: 'funda' as const,primarySourceListingId: id,
      canonicalUrl: `https://www.funda.nl/detail/koop/fixture/${id}`,
      status: 'active' as const,verificationState: 'validated' as const,
      askingPrice: 410000,priceType: 'sale',pricePeriod: 'total',priceUnit: 'listing',priceCondition: 'asking',
      activeEligible: true,lastPositiveAvailabilityAt: new Date(),
      availabilityExpiresAt: new Date(Date.now()+30*86400000),
    })));
    return ids;
  }

  async function groups() {
    return buildCanonicalGroupsForTileUncached(tile,createDefaultMapFilters(),{
      liveListingUpdates: true,clusterPropertyIdRetention: 'complete',
      runtimeBudgetMs: 120000,statementTimeoutMs: 120000,
    });
  }

  async function manifest(id = versionId) {
    return Array.from(await db.execute<{ payload: Buffer; etag: string; listing_revision: string; node_count: number }>(sql`
      SELECT payload,etag,listing_revision::text,node_count FROM property_tile_pyramid_tiles
      WHERE version_id=${id}::uuid AND z=0 AND x=0 AND y=0
    `))[0];
  }

  beforeAll(async () => {
    process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID = coverageId;
    process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM = '0';
    await db.execute(sql`CREATE TABLE ${propertyBackup} AS TABLE listing_tile_property_updates`);
    await db.execute(sql`CREATE TABLE ${tileBackup} AS TABLE listing_tile_updates`);
    app = await buildApp({ logger: false });
  });
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM listing_tile_property_updates`);
    await db.execute(sql`DELETE FROM listing_tile_updates`);
    versionId = await createVersion();
    resetPropertyTileCacheForTests();
  });
  afterEach(async () => {
    if (propertyIds.length) await db.delete(properties).where(inArray(properties.id,propertyIds.splice(0)));
    await db.execute(sql`DELETE FROM listing_tile_property_updates`);
    await db.execute(sql`DELETE FROM listing_tile_updates`);
    await db.execute(sql`DELETE FROM property_tile_pyramid_current WHERE coverage_id=${coverageId}`);
    for (const id of versionIds.splice(0)) {
      await db.execute(sql`SELECT drop_property_tile_pyramid_version_partitions(${id}::uuid)`);
      await db.execute(sql`DELETE FROM property_tile_pyramid_versions WHERE id=${id}::uuid`);
    }
  });
  afterAll(async () => {
    await db.execute(sql`INSERT INTO listing_tile_property_updates SELECT * FROM ${propertyBackup}`);
    await db.execute(sql`INSERT INTO listing_tile_updates SELECT * FROM ${tileBackup}`);
    await db.execute(sql`DROP TABLE ${propertyBackup}`);
    await db.execute(sql`DROP TABLE ${tileBackup}`);
    if (oldCoverage === undefined) delete process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID;
    else process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID = oldCoverage;
    if (oldZoom === undefined) delete process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM;
    else process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM = oldZoom;
    resetPropertyTileCacheForTests();
    await app?.close();
  });

  it('ignores unchanged positive sightings while queuing visible price unit and eligibility changes', async () => {
    const [id] = await fixture();
    await expandListingTilePropertyUpdates();
    await db.execute(sql`UPDATE canonical_listings SET last_seen_at=now(),last_positive_availability_at=now(),
      availability_expires_at=now()+interval '30 days' WHERE property_id=${id}`);
    expect(await expandListingTilePropertyUpdates()).toBe(0);
    await db.execute(sql`UPDATE canonical_listings SET price_unit='m2' WHERE property_id=${id}`);
    expect(await expandListingTilePropertyUpdates()).toBe(1);
    await db.execute(sql`UPDATE canonical_listings SET active_eligible=false WHERE property_id=${id}`);
    expect(await expandListingTilePropertyUpdates()).toBe(1);
  });

  it('fences unexpanded evidence arriving during a build and recovers a crashed worker lease', async () => {
    const [id] = await fixture();
    await expandListingTilePropertyUpdates();
    const claims = await Promise.all([claimListingTileUpdate(),claimListingTileUpdate()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    const oldGroups = await groups();
    await db.execute(sql`UPDATE canonical_listings SET status='withdrawn',active_eligible=false,
      withdrawn_at=now() WHERE property_id=${id}`);
    expect(BigInt((await getListingTileServingState(tile)).requestedRevision)).toBeGreaterThan(BigInt(claim.revision));
    expect(await publishClaimedListingTileUpdate(claim,oldGroups)).toBe(false);
    expect((await manifest()).listing_revision).toBe('0');
    await expandListingTilePropertyUpdates();
    await db.execute(sql`UPDATE listing_tile_updates SET lease_until=now()-interval '1 second'`);
    const replacement = (await claimListingTileUpdate())!;
    expect(replacement.leaseToken).not.toBe(claim.leaseToken);
    expect(await publishClaimedListingTileUpdate(claim,oldGroups)).toBe(false);
    const currentGroups = await groups();
    expect(currentGroups.flatMap(group => group.propertyIds)).not.toContain(id);
    expect(await publishClaimedListingTileUpdate(replacement,currentGroups)).toBe(true);
    expect(await claimListingTileUpdate()).toBeNull();
  });

  it('publishes matching MVT/node generations with complete group membership and fences a stale lazy encoder', async () => {
    const ids = await fixture(35);
    const result = await runListingTileUpdates(1);
    expect(result).toMatchObject({ expandedProperties: 35,publishedTiles: 1,failedTiles: 0 });
    const first = await manifest();
    const rows = Array.from(await db.execute<{ node_id: string; point_count: number; node_summary_json: { propertyIds: string[] } }>(sql`
      SELECT node_id,point_count,node_summary_json FROM property_tile_pyramid_nodes WHERE version_id=${versionId}::uuid
    `));
    const cluster = rows.find(row => row.node_summary_json.propertyIds?.includes(ids[0]));
    expect(cluster?.node_summary_json.propertyIds.length).toBe(cluster?.point_count);
    expect(cluster?.node_summary_json.propertyIds).toEqual(expect.arrayContaining(ids));
    const mvt = new VectorTile(new Pbf(first.payload));
    const features = Object.values(mvt.layers).flatMap(layer => Array.from({ length: layer.length },(_,index) => layer.feature(index).properties));
    expect(features.map(feature => feature.pyramid_node_id).sort()).toEqual(rows.map(row => row.node_id).sort());
    expect(features.every(feature => feature.pyramid_version_id === versionId)).toBe(true);
    const nearby = await app.inject({ method: 'GET',url: `/properties/nearby?lon=5.125&lat=52.125&zoom=0&pyramidVersionId=${versionId}&pyramidNodeId=${cluster!.node_id}` });
    expect(nearby.statusCode).toBe(200);
    expect(nearby.json()).toMatchObject({ membershipComplete: true,readStateCoverage: 'complete',pointCount: cluster!.point_count });
    expect(nearby.json().propertyIds).toEqual(expect.arrayContaining(ids));
    await db.execute(sql`UPDATE canonical_listings SET asking_price=420000 WHERE property_id=${ids[0]}`);
    expect((await runListingTileUpdates(1)).publishedTiles).toBe(1);
    const latest = await manifest();
    expect(latest.listing_revision).not.toBe(first.listing_revision);
    const current = await lookupCurrentPropertyTilePyramidVersion();
    if (current.state !== 'current') throw new Error('Missing fixture current version');
    const encoded = await encodePropertyTilePyramidTileFromPromotedNodes({
      version: current.version,...tile,expectedListingRevision: first.listing_revision,
    });
    expect(encoded.etag).toBe(latest.etag);
    expect(encoded.payload).toEqual(latest.payload);
    expect((await manifest()).listing_revision).toBe(latest.listing_revision);
    const newNodes = Array.from(await db.execute<{ node_id: string }>(sql`
      SELECT node_id FROM property_tile_pyramid_nodes WHERE version_id=${versionId}::uuid
    `));
    expect(newNodes.some(row => row.node_id === cluster!.node_id)).toBe(false);
    const newNearby = await app.inject({ method: 'GET',url: '/properties/nearby?lon=5.125&lat=52.125&zoom=0' });
    expect(newNearby.json().propertyIds).toEqual(expect.arrayContaining(ids));
    expect(newNearby.json().pyramidNodeId).not.toBe(cluster!.node_id);
  });

  it('fences a smaller source revision that commits after the tile was claimed', async () => {
    const [firstId,secondId] = await fixture(2);
    expect((await runListingTileUpdates(1)).publishedTiles).toBe(1);
    let release!: () => void;
    let started!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const lateCommit = db.transaction(async tx => {
      await tx.execute(sql`UPDATE canonical_listings SET status='withdrawn',active_eligible=false WHERE property_id=${firstId}`);
      started();
      await paused;
    });
    await ready;
    let claim: NonNullable<Awaited<ReturnType<typeof claimListingTileUpdate>>>;
    let before: Awaited<ReturnType<typeof groups>>;
    let stateBefore: Awaited<ReturnType<typeof getListingTileServingState>>;
    try {
      await db.execute(sql`UPDATE canonical_listings SET asking_price=420000 WHERE property_id=${secondId}`);
      await expandListingTilePropertyUpdates();
      claim = (await claimListingTileUpdate())!;
      before = await groups();
      stateBefore = await getListingTileServingState(tile);
    } finally {
      release();
      await lateCommit;
    }
    const stateAfter = await getListingTileServingState(tile);
    expect(stateAfter.requestedRevision).toBe(stateBefore!.requestedRevision);
    expect(stateAfter.pendingFingerprint).not.toBe(stateBefore!.pendingFingerprint);
    expect(await publishClaimedListingTileUpdate(claim!,before!)).toBe(false);
    await expandListingTilePropertyUpdates();
    expect(BigInt((await getListingTileServingState(tile)).requestedRevision)).toBeGreaterThan(BigInt(claim!.revision));
    await db.execute(sql`UPDATE listing_tile_updates SET lease_until=now()-interval '1 second'`);
    expect((await runListingTileUpdates(1)).publishedTiles).toBe(1);
    const current = await groups();
    expect(current.flatMap(group => group.propertyIds)).not.toContain(firstId);
  });

  it('retains processed and dirty overlays across promotion without blank or regressed map responses', async () => {
    const [id] = await fixture();
    expect((await runListingTileUpdates(1)).publishedTiles).toBe(1);
    const first = await app.inject({ method: 'GET',url: '/tiles/properties/0/0/0.pbf' });
    expect(first.statusCode).toBe(200);
    const oldVersion = versionId;
    versionId = await createVersion();
    expect((await getListingTileServingState(tile)).publishedVersionId).toBe(oldVersion);
    const promoted = await app.inject({ method: 'GET',url: '/tiles/properties/0/0/0.pbf' });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.rawPayload).toEqual(first.rawPayload);
    expect(promoted.headers['x-huishype-pyramid-version']).toBe(oldVersion);
    await db.execute(sql`SELECT property_tile_generated_partition_retention_for_slot(${coverageId},'default',0,'public_default_low_zoom')`);
    expect(await manifest(oldVersion)).toBeDefined();
    const oldClaim = (await claimListingTileUpdate())!;
    const before = await groups();
    versionId = await createVersion();
    expect(await publishClaimedListingTileUpdate(oldClaim,before)).toBe(false);
    // The old overlay is now neither the current nor previous base version.
    // Promotion itself runs real partition GC and must preserve this reference.
    expect(await manifest(oldVersion)).toBeDefined();
    const oldNode = Array.from(await db.execute<{ node_id: string }>(sql`
      SELECT node_id FROM property_tile_pyramid_nodes WHERE version_id=${oldVersion}::uuid LIMIT 1
    `))[0];
    const overlayNearby = await app.inject({ method: 'GET',url: `/properties/nearby?lon=5.125&lat=52.125&zoom=0&pyramidVersionId=${oldVersion}&pyramidNodeId=${oldNode.node_id}` });
    expect(overlayNearby.statusCode).toBe(200);
    expect(overlayNearby.json().pyramidVersionId).toBe(oldVersion);
    await db.execute(sql`UPDATE canonical_listings SET status='sold',active_eligible=false,sold_at=now() WHERE property_id=${id}`);
    const dirty = await app.inject({ method: 'GET',url: '/tiles/properties/0/0/0.pbf',headers: { 'if-none-match': first.headers.etag! } });
    expect([200,304]).toContain(dirty.statusCode);
    expect(dirty.headers['x-huishype-pyramid-version']).toBe(oldVersion);
    await db.execute(sql`UPDATE listing_tile_updates SET lease_until=now()-interval '1 second'`);
    expect((await runListingTileUpdates(1)).publishedTiles).toBe(1);
    expect((await getListingTileServingState(tile)).publishedVersionId).toBe(versionId);
    const refreshed = await app.inject({ method: 'GET',url: '/tiles/properties/0/0/0.pbf',headers: { 'if-none-match': first.headers.etag! } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.headers['x-huishype-pyramid-version']).toBe(versionId);
    expect(refreshed.headers.etag).not.toBe(first.headers.etag);
    await db.execute(sql`SELECT property_tile_generated_partition_retention_for_slot(${coverageId},'default',0,'public_default_low_zoom')`);
    expect(Array.from(await db.execute(sql`SELECT id FROM property_tile_pyramid_versions WHERE id=${oldVersion}::uuid`))).toHaveLength(0);
    expect((await getListingTileServingState(tile)).publishedVersionId).toBe(versionId);
  });
});

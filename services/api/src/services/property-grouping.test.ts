import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PROPERTY_MAP_FOOTPRINTS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import { db } from '../db/index.js';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import crypto from 'node:crypto';
import {
  GHOST_NODE_REVEAL_ZOOM,
  PROPERTY_TILE_EXTENT,
  buildGroupingCandidateScopeCtes,
  buildMvtForGroups,
  getActiveClusterRadiusPx,
  getActiveSingleRadiusPx,
  getGroupingBufferUnits,
  getGhostClusterRadiusPx,
  getGhostSingleRadiusPx,
  buildCanonicalGroupsForTile,
  buildCanonicalGroupsForTileUncached,
  groupCandidatesForTile,
  lngLatToWorldUnits,
  serializeGroupForTile,
  shouldFetchGhostCandidates,
  type GroupingCandidate,
  resetCanonicalGroupCacheForTests,
  resolveNearbyGroupedFeature,
  type CanonicalPropertyGroup,
} from './property-grouping.js';
import { createDefaultMapFilters, normalizeMapFilters } from './map-filters.js';
import { PublicPropertyTileCache } from './property-tile-cache.js';
import {
  isPropertyTileStatementTimeoutError,
  PropertyTileBudgetExceededError,
  PropertyTileBuildAbortedError,
} from './property-tile-runtime.js';

const dialect = new PgDialect();
const TEST_CANDIDATE_SNAPSHOT_ID = '00000000-0000-0000-0000-00000000c001';

function renderSql(query: SQL) {
  return dialect.sqlToQuery(query).sql;
}

function renderSqlQuery(query: SQL) {
  return dialect.sqlToQuery(query);
}

function makePropertyId(index: number): string {
  const suffix = index.toString(16).padStart(12, '0');
  return `00000000-0000-4000-a000-${suffix}`;
}

function worldUnitsToLngLat(worldX: number, worldY: number, zoom: number): [number, number] {
  const scale = Math.pow(2, zoom) * PROPERTY_TILE_EXTENT;
  const lon = (worldX / scale) * 360 - 180;
  const mercN = Math.PI * (1 - (2 * worldY) / scale);
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(mercN));
  return [lon, lat];
}

function tileForCoordinate(lon: number, lat: number, zoom: number) {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  return {
    z: zoom,
    x: Math.floor(worldX / PROPERTY_TILE_EXTENT),
    y: Math.floor(worldY / PROPERTY_TILE_EXTENT),
  };
}

const TILE_UNITS_PER_PX = PROPERTY_TILE_EXTENT / 512;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function makeCandidate(
  id: string,
  lon: number,
  lat: number,
  zoom: number,
  overrides: Partial<GroupingCandidate> = {}
): GroupingCandidate {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const hasActiveListing = overrides.hasActiveListing ?? true;
  const hasCompletedListing =
    overrides.hasCompletedListing ??
    (!hasActiveListing && (overrides.marketState === 'sold' || overrides.marketState === 'rented'));
  const socialScore = overrides.socialScore ?? 10;
  const recentSocialScore = overrides.recentSocialScore ?? socialScore;
  const commentCount = overrides.commentCount ?? 0;
  return {
    id,
    hasActiveListing,
    hasCompletedListing,
    socialScore,
    recentSocialScore,
    commentCount,
    marketState: overrides.marketState ?? (hasActiveListing ? 'for-sale' : 'not-listed'),
    lon,
    lat,
    worldX,
    worldY,
    ...overrides,
  };
}

function makeCandidateAtWorld(
  id: string,
  worldX: number,
  worldY: number,
  zoom: number,
  overrides: Partial<GroupingCandidate> = {}
): GroupingCandidate {
  const [lon, lat] = worldUnitsToLngLat(worldX, worldY, zoom);
  return makeCandidate(id, lon, lat, zoom, overrides);
}

function makeCanonicalGroup(
  index: number,
  overrides: Partial<CanonicalPropertyGroup> = {}
): CanonicalPropertyGroup {
  const id = makePropertyId(index);
  return {
    nodeClass: 'active',
    groupKind: 'single',
    primaryPropertyId: id,
    pointCount: 1,
    propertyIds: [id],
    previewPropertyIds: [id],
    coordinate: [5.47 + index * 0.00001, 51.44 + index * 0.00001],
    bbox: null,
    activeListingCount: 1,
    completedListingCount: 0,
    socialCount: 1,
    recentSocialCount: 1,
    socialScoreTotal: 3,
    socialScoreMax: 3,
    recentSocialScoreTotal: 1,
    commentCount: 2,
    address: `Mockstraat ${index}`,
    city: 'Eindhoven',
    askingPrice: 359000 + index,
    thumbnailUrl: `https://cdn.example.com/mock-thumb-${index}.jpg`,
    hasActiveListing: true,
    marketState: 'for-sale',
    ownerTile: { z: 17, x: 67478, y: 43551 },
    anchorWorldX: 0,
    anchorWorldY: 0,
    ...overrides,
  };
}

describe('property-grouping', () => {
  afterEach(() => {
    resetCanonicalGroupCacheForTests();
    jest.restoreAllMocks();
  });

  it('keeps ghost candidate fetching disabled at and below the legacy reveal zoom', () => {
    expect(shouldFetchGhostCandidates(GHOST_NODE_REVEAL_ZOOM - 1)).toBe(false);
    expect(shouldFetchGhostCandidates(GHOST_NODE_REVEAL_ZOOM)).toBe(false);
  });

  it('discovers z13 non-ghost listing candidates from the maintained tile projection', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      false,
      createDefaultMapFilters(),
      13,
      { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).not.toContain('bounded_properties AS MATERIALIZED');
    expect(text).not.toContain('listing_candidate_properties AS MATERIALIZED');
    expect(text).toContain(
      'SELECT pgf.property_id AS id, pgf.geometry, pgf.official_valuation'
    );
    expect(text).toContain('FROM property_tile_grouping_facts pgf');
    expect(text).toContain('WHERE pgf.geometry && ST_MakeEnvelope');
    expect(text).toContain('pgf.snapshot_id = $');
    expect(text).not.toContain('property_tile_listing_candidates');
    expect(text).not.toContain('property_tile_listing_facts');
    expect(text).not.toContain('property_tile_social_facts');
    expect(text).not.toContain('FROM canonical_listings cl INNER JOIN properties p');
    expect(text).not.toContain('social_activity_candidate_properties AS MATERIALIZED');
    expect(text).not.toContain('FROM comments c');
    expect(text).not.toContain('FROM reactions r');
    expect(text).not.toContain('FROM price_guesses pg');
    expect(text).not.toContain('FROM property_views pv');
    expect(text).not.toContain('active_listing_candidate_ids');
    expect(text).not.toContain('completed_listing_candidate_ids');
    expect(text).not.toMatch(/\bUNION\b(?!\s+ALL)/);
    expect(text).not.toContain('candidate_property_ids AS MATERIALIZED');
    expect(text).not.toContain('social_only_candidate_properties AS MATERIALIZED');
  });

  it('discovers z14 non-ghost listing candidates from the maintained tile projection', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      false,
      createDefaultMapFilters(),
      14,
      { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).not.toContain('bounded_properties AS MATERIALIZED');
    expect(text).not.toContain('listing_candidate_properties AS MATERIALIZED');
    expect(text).toContain(
      'SELECT pgf.property_id AS id, pgf.geometry, pgf.official_valuation'
    );
    expect(text).toContain('FROM property_tile_grouping_facts pgf');
    expect(text).toContain('WHERE pgf.geometry && ST_MakeEnvelope');
    expect(text).toContain('pgf.snapshot_id = $');
    expect(text).not.toContain('property_tile_listing_candidates');
    expect(text).not.toContain('property_tile_listing_facts');
    expect(text).not.toContain('property_tile_social_facts');
    expect(text).not.toContain('social_only_candidate_properties AS MATERIALIZED');
    expect(text).not.toContain('candidate_property_ids AS MATERIALIZED');
    expect(text).not.toContain('bounded_social_properties AS MATERIALIZED');
    expect(text).not.toContain('FROM comments c');
    expect(text).not.toContain('FROM reactions r');
    expect(text).not.toContain('FROM price_guesses pg');
    expect(text).not.toContain('FROM property_views pv');
  });

  it('scopes z15 non-ghost tile candidate discovery to bounded active properties before source scans', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      false,
      createDefaultMapFilters(),
      15
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).toContain('bounded_properties AS MATERIALIZED');
    expect(text.indexOf('bounded_properties AS MATERIALIZED')).toBeLessThan(
      text.indexOf('listing_candidate_ids AS MATERIALIZED')
    );
    expect(text).toContain('listing_candidate_ids AS MATERIALIZED');
    expect(text).toContain(
      'SELECT DISTINCT cl.property_id FROM canonical_listings cl INNER JOIN bounded_properties bp ON bp.id = cl.property_id'
    );
    expect(text).toContain(
      "WHERE cl.verification_state <> 'invalid' AND cl.status IN ('active', 'sold', 'rented')"
    );
    expect(text).toContain(
      'FROM comments c INNER JOIN bounded_properties bp ON bp.id = c.property_id'
    );
    expect(text).toContain('INNER JOIN bounded_properties bp ON bp.id = r.target_id');
    expect(text).toContain("WHERE r.target_type = 'property' AND r.reaction_type = 'like'");
    expect(text).toContain(
      'INNER JOIN comments c ON c.id = r.target_id INNER JOIN bounded_properties bp ON bp.id = c.property_id'
    );
    expect(text).toContain("WHERE r.target_type = 'comment' AND r.reaction_type = 'like'");
    expect(text).toContain(
      'FROM price_guesses pg INNER JOIN bounded_properties bp ON bp.id = pg.property_id'
    );
    expect(text).toContain(
      'FROM property_views pv INNER JOIN bounded_properties bp ON bp.id = pv.property_id'
    );
    expect(text).not.toContain('INNER JOIN properties p ON p.id = cl.property_id');
    expect(text).not.toContain('INNER JOIN properties p ON p.id = c.property_id');
    expect(text).not.toContain('INNER JOIN properties p ON p.id = r.target_id');
    expect(text).not.toContain('INNER JOIN properties p ON p.id = pg.property_id');
    expect(text).not.toContain('INNER JOIN properties p ON p.id = pv.property_id');
    expect(text).not.toContain('active_listing_candidate_ids');
    expect(text).not.toContain('completed_listing_candidate_ids');
    expect(text.match(/\bUNION ALL\b/g)?.length).toBeGreaterThanOrEqual(5);
    expect(text).not.toMatch(/\bUNION\b(?!\s+ALL)/);
    expect(text).toContain(
      'candidate_property_ids AS MATERIALIZED ( SELECT DISTINCT property_id FROM ('
    );
    expect(text).toContain(
      'FROM candidate_property_ids cpi INNER JOIN bounded_properties bp ON bp.id = cpi.property_id'
    );
    expect(text).toContain("WHERE p.geometry IS NOT NULL AND p.status = 'active'");
    expect(text).toContain('p.geometry && ST_MakeEnvelope');
    expect(text.match(/p\.geometry && ST_MakeEnvelope/g)?.length).toBe(1);
    expect(text).toContain('SELECT bp.id, bp.geometry, bp.official_valuation');
    expect(text).toContain(
      'FROM property_views pv INNER JOIN bounded_properties bp ON bp.id = pv.property_id GROUP BY pv.property_id'
    );
    expect(text).toContain(
      'GROUP BY pv.property_id HAVING COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) >= 8'
    );
  });

  it('uses bounded active properties directly for selected-area candidate discovery', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      false,
      normalizeMapFilters({
        areas: [
          {
            type: 'street',
            countryCode: 'NL',
            value: 'area-visibility-street',
            label: 'Area Visibility Street',
            city: 'Area City',
          },
        ],
      }),
      13,
      { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).toContain('candidate_properties AS MATERIALIZED');
    expect(text).toContain('FROM properties p');
    expect(text).toContain("WHERE p.geometry IS NOT NULL AND p.status = 'active'");
    expect(text).toContain('p.geometry && ST_MakeEnvelope');
    expect(text).toContain('p.country_code = $');
    expect(text).not.toContain('UPPER(p.country_code)');
    expect(text).toContain('p.street');
    expect(text).toContain('p.city');
    expect(text).not.toContain('bounded_properties AS MATERIALIZED');
    expect(text).not.toContain('listing_candidate_ids AS MATERIALIZED');
    expect(text).not.toContain('candidate_property_ids AS MATERIALIZED');
    expect(text).not.toContain('property_tile_grouping_facts');
    expect(text).not.toContain('property_tile_listing_candidates');
    expect(text).not.toContain('property_tile_listing_facts');
    expect(text).not.toContain('property_tile_social_facts');
    expect(text).not.toContain('canonical_listings cl');
    expect(text).not.toContain('FROM comments c');
    expect(text).not.toContain('FROM reactions r');
    expect(text).not.toContain('FROM price_guesses pg');
    expect(text).not.toContain('FROM property_views pv');
  });

  it('skips low-zoom social-only candidate discovery when market filters can only return listed states', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      false,
      normalizeMapFilters({ marketState: ['for-sale', 'for-rent', 'sold', 'rented'] }),
      10,
      { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).not.toContain('bounded_properties AS MATERIALIZED');
    expect(text).toContain(
      'SELECT pgf.property_id AS id, pgf.geometry, pgf.official_valuation'
    );
    expect(text).toContain('FROM property_tile_grouping_facts pgf');
    expect(text).toContain('WHERE pgf.geometry && ST_MakeEnvelope');
    expect(text).toContain('pgf.snapshot_id = $');
    expect(text).not.toContain('property_tile_listing_candidates');
    expect(text).not.toContain('property_tile_listing_facts');
    expect(text).not.toContain('property_tile_social_facts');
    expect(text).not.toContain('social_activity_candidate_ids AS MATERIALIZED');
    expect(text).not.toContain('candidate_property_ids AS MATERIALIZED');
    expect(text).not.toContain('INNER JOIN properties p ON p.id = cpi.property_id');
    expect(text.match(/INNER JOIN properties p ON p\.id/g) ?? []).toHaveLength(0);
    expect(text.match(/p\.status = 'active'/g) ?? []).toHaveLength(0);
    expect(text.match(/p\.geometry && ST_MakeEnvelope/g) ?? []).toHaveLength(0);
  });

  it('keeps default live grouping behind the listing or social visibility gate', async () => {
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSql(query).replace(/\s+/g, ' ').trim());
      return [] as never;
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTile({ z: 15, x: 16892, y: 10898 }, createDefaultMapFilters())
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((text) =>
      text.includes('candidate_properties AS MATERIALIZED')
    );

    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain('listing_candidate_ids AS MATERIALIZED');
    expect(candidateQuery).toContain('social_activity_candidate_ids AS MATERIALIZED');
    expect(candidateQuery).toContain('FROM listing_candidate_ids');
    expect(candidateQuery).toContain('COALESCE(lf.has_active_listing, FALSE)');
    expect(candidateQuery).toContain('OR COALESCE(lf.has_completed_listing, FALSE)');
    expect(candidateQuery).toContain('OR COALESCE(sf.social_score, 0) >= $');
  });

  it('keeps selected-area live grouping off snapshot facts while preserving listing and social visibility gates', async () => {
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSql(query).replace(/\s+/g, ' ').trim());
      return [] as never;
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTile(
        { z: 13, x: 4206, y: 2692 },
        normalizeMapFilters({
          areas: [
            {
              type: 'street',
              countryCode: 'NL',
              value: 'area-visibility-street',
              label: 'Area Visibility Street',
              city: 'Area City',
            },
          ],
        }),
        { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
      )
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((text) =>
      text.includes('candidate_properties AS MATERIALIZED')
    );

    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain('FROM properties p');
    expect(candidateQuery).toContain("WHERE p.geometry IS NOT NULL AND p.status = 'active'");
    expect(candidateQuery).toContain('FROM canonical_listings cl');
    expect(candidateQuery).toContain('INNER JOIN candidate_properties cp ON cp.id = cl.property_id');
    expect(candidateQuery).toContain('latest_public_guesses AS MATERIALIZED');
    expect(candidateQuery).not.toContain('property_tile_grouping_facts');
    expect(candidateQuery).not.toContain('property_tile_listing_candidates');
    expect(candidateQuery).not.toContain('property_tile_listing_facts');
    expect(candidateQuery).not.toContain('property_tile_social_facts');
    expect(candidateQuery).not.toContain('pgf.snapshot_id');
    expect(candidateQuery).not.toContain('ptlf.snapshot_id');
    expect(candidateQuery).not.toContain('ptsf.snapshot_id');
    expect(candidateQuery).not.toContain('listing_candidate_ids AS MATERIALIZED');
    expect(candidateQuery).not.toContain('social_activity_candidate_ids AS MATERIALIZED');
    expect(candidateQuery).not.toContain('candidate_property_ids AS MATERIALIZED');
    expect(candidateQuery).toContain('OR COALESCE(lf.has_completed_listing, FALSE)');
    expect(candidateQuery).toContain('OR COALESCE(sf.social_score, 0) >= $');
  });

  it('scopes price-filter listing, history, and guess work through candidate properties', async () => {
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSql(query).replace(/\s+/g, ' ').trim());
      return [] as never;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTile(
        { z: 18, x: 100000, y: 70000 },
        normalizeMapFilters({ salePriceFrom: 300000, salePriceTo: 700000, rentPriceTo: 2500 })
      )
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((text) =>
      text.includes('latest_public_guesses AS MATERIALIZED')
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain('candidate_properties AS MATERIALIZED');
    expect(candidateQuery).toContain('tile_listing_facts AS MATERIALIZED');
    expect(candidateQuery).toContain(
      'FROM canonical_listings cl INNER JOIN candidate_properties sp ON sp.id = cl.property_id'
    );
    expect(candidateQuery).toContain("WHERE cl.verification_state <> 'invalid'");
    expect(candidateQuery).toContain(
      "WHEN lower(cl.source_name) = 'funda' AND lower(btrim(cl.price_type)) = 'buy' THEN 'sale'"
    );
    expect(candidateQuery).toContain(
      "WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent') THEN lower(btrim(cl.price_type))"
    );
    expect(candidateQuery).toContain("WHEN lower(cl.source_name) = 'pararius' THEN 'rent'");
    expect(candidateQuery).not.toContain('v_canonical_listing_facts');
    expect(candidateQuery?.match(/FROM tile_listing_facts l/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      candidateQuery?.match(
        /FROM price_history ph INNER JOIN candidate_properties cp ON cp.id = ph.property_id/g
      )?.length
    ).toBe(2);
    expect(candidateQuery).toContain(
      'FROM price_guesses pg INNER JOIN candidate_properties cp ON cp.id = pg.property_id'
    );
    expect(candidateQuery).toContain(
      'FROM latest_public_guesses lpg INNER JOIN users u ON u.id = lpg.user_id INNER JOIN candidate_properties cp ON cp.id = lpg.property_id'
    );
    expect(candidateQuery).toContain('FROM candidate_properties cp LEFT JOIN latest_listing');
    expect(candidateQuery).toContain('lf.sale_effective_price');
    expect(candidateQuery).toContain('lf.rent_effective_price');
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps price-filter snapshot-backed queries on effective-price inputs', async () => {
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSql(query).replace(/\s+/g, ' ').trim());
      return [] as never;
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTile(
        { z: 13, x: 4206, y: 2692 },
        normalizeMapFilters({ salePriceFrom: 300000 }),
        { candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID }
      )
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((text) =>
      text.includes('tile_listing_facts AS MATERIALIZED')
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain('property_tile_listing_candidates lpc');
    expect(candidateQuery).toContain('property_tile_social_facts ptsf');
    expect(candidateQuery).toContain(
      'FROM canonical_listings cl INNER JOIN candidate_properties sp ON sp.id = cl.property_id'
    );
    expect(candidateQuery).toContain(
      'FROM price_history ph INNER JOIN candidate_properties cp ON cp.id = ph.property_id'
    );
    expect(candidateQuery).toContain(
      'FROM price_guesses pg INNER JOIN candidate_properties cp ON cp.id = pg.property_id'
    );
    expect(candidateQuery).not.toContain('property_tile_grouping_facts');
    expect(candidateQuery).toContain('lf.sale_effective_price');
  });

  it('uses direct grouping facts for default unpriced snapshot candidate queries', async () => {
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSql(query).replace(/\s+/g, ' ').trim());
      return [] as never;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTile({ z: 13, x: 4206, y: 2692 }, createDefaultMapFilters(), {
        candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID,
      })
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((text) =>
      text.includes('FROM property_tile_grouping_facts pgf')
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain('SELECT pgf.property_id AS id');
    expect(candidateQuery).toContain('ST_X(pgf.geometry) AS lon');
    expect(candidateQuery).toContain('ST_Y(pgf.geometry) AS lat');
    expect(candidateQuery).toContain('WHERE (pgf.geometry && ST_MakeEnvelope');
    expect(candidateQuery).toContain('pgf.snapshot_id = $');
    expect(candidateQuery).toContain('COALESCE(pgf.has_active_listing, FALSE)');
    expect(candidateQuery).toContain('COALESCE(pgf.has_completed_listing, FALSE)');
    expect(candidateQuery).toContain("COALESCE(pgf.market_state, 'not-listed')");
    expect(candidateQuery).toContain('COALESCE(pgf.social_score, 0)');
    expect(candidateQuery).toContain('COALESCE(pgf.recent_social_score, 0)');
    expect(candidateQuery).toContain('COALESCE(pgf.comment_count, 0)');
    expect(candidateQuery).toContain('OR COALESCE(pgf.social_score, 0) >= $');
    expect(candidateQuery).not.toContain('candidate_properties AS MATERIALIZED');
    expect(candidateQuery).not.toContain('listing_facts AS MATERIALIZED');
    expect(candidateQuery).not.toContain('social_facts AS MATERIALIZED');
    expect(candidateQuery).not.toContain('INNER JOIN listing_facts');
    expect(candidateQuery).not.toContain('INNER JOIN social_facts');
    expect(candidateQuery).not.toContain('property_tile_listing_facts');
    expect(candidateQuery).not.toContain('property_tile_social_facts');
    expect(candidateQuery).not.toContain('property_tile_listing_candidates');
    expect(candidateQuery).not.toContain('LEFT JOIN LATERAL');
    expect(candidateQuery).not.toContain('FROM canonical_listings cl WHERE cl.property_id = cp.id');
    expect(candidateQuery).not.toContain('tile_listing_facts AS MATERIALIZED');
    expect(candidateQuery).not.toContain('FROM tile_listing_facts l');
    expect(candidateQuery).not.toContain('latest_public_guesses AS MATERIALIZED');
    expect(candidateQuery).not.toContain('FROM comments c');
    expect(candidateQuery).not.toContain('FROM reactions r');
    expect(candidateQuery).not.toContain('FROM price_guesses pg');
    expect(candidateQuery).not.toContain('FROM property_views pv');
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('uses a bound closed timestamp for candidate snapshot social windows', async () => {
    const closedSocialActivityCutoffAt = '2026-05-07T10:00:00.000Z';
    const renderedQueries: ReturnType<typeof renderSqlQuery>[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      renderedQueries.push(renderSqlQuery(query));
      return [] as never;
    });
    jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    await expect(
      buildCanonicalGroupsForTileUncached(
        { z: 13, x: 4206, y: 2692 },
        normalizeMapFilters({ activity: 'today' }),
        {
          candidateSnapshotId: TEST_CANDIDATE_SNAPSHOT_ID,
          closedSocialActivityCutoffAt,
        }
      )
    ).resolves.toEqual([]);

    const candidateQuery = renderedQueries.find((query) =>
      query.sql.includes('property_tile_grouping_facts pgf')
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery?.sql).toContain('pgf.last_social_at');
    expect(candidateQuery?.sql).toContain('pgf.recent_social_score');
    expect(candidateQuery?.sql).toContain("::timestamptz - INTERVAL '24 hours'");
    expect(candidateQuery?.sql).toContain('<= $');
    expect(candidateQuery?.sql).not.toContain("NOW() - INTERVAL '7 days'");
    expect(candidateQuery?.sql).not.toContain('candidate_properties AS MATERIALIZED');
    expect(candidateQuery?.sql).not.toContain('listing_facts AS MATERIALIZED');
    expect(candidateQuery?.sql).not.toContain('social_facts AS MATERIALIZED');
    expect(candidateQuery?.sql).not.toContain('INNER JOIN listing_facts');
    expect(candidateQuery?.sql).not.toContain('INNER JOIN social_facts');
    expect(candidateQuery?.sql).not.toContain('latest_public_guesses AS MATERIALIZED');
    expect(candidateQuery?.sql).not.toContain('FROM comments c');
    expect(candidateQuery?.sql).not.toContain('FROM reactions r');
    expect(candidateQuery?.sql).not.toContain('FROM price_guesses pg');
    expect(candidateQuery?.sql).not.toContain('FROM property_views pv');
    expect(candidateQuery?.sql).not.toContain('property_tile_listing_candidates');
    expect(candidateQuery?.sql).not.toContain('property_tile_listing_facts');
    expect(candidateQuery?.sql).not.toContain('property_tile_social_facts');
    expect(candidateQuery?.params).toContain(closedSocialActivityCutoffAt);
  });

  it('hydrates single-property tile details with a set-based listing fact batch query', async () => {
    const propertyId = '00000000-0000-0000-0000-00000000a101';
    const lon = 5.4697;
    const lat = 51.4416;
    const tile = tileForCoordinate(lon, lat, 18);
    const renderedQueries: string[] = [];
    const txExecuteMock = jest.fn(async (query: SQL) => {
      const rendered = renderSql(query).replace(/\s+/g, ' ').trim();
      renderedQueries.push(rendered);

      if (rendered.includes('FROM target_properties tp')) {
        return [
          {
            id: propertyId,
            country_code: 'NL',
            street: 'Set Based Tile Street',
            house_number: 12,
            house_number_addition: null,
            city: 'Batchstad',
            postal_code: '1234AB',
            asking_price: 625000,
            thumbnail_url: 'https://cdn.example.com/set-based.jpg',
            has_active_listing: true,
            market_state: 'for-sale',
          },
        ] as never;
      }

      if (rendered.includes('FROM candidate_properties cp')) {
        return [
          {
            id: propertyId,
            has_active_listing: true,
            has_completed_listing: false,
            social_score: 1,
            recent_social_score: 1,
            comment_count: 0,
            market_state: 'for-sale',
            lon,
            lat,
          },
        ] as never;
      }

      return [] as never;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));
    const startedAt = Date.now();

    const groups = await buildCanonicalGroupsForTile(tile, createDefaultMapFilters(), {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: startedAt,
      runtimeDeadlineMs: startedAt + 5_000,
      statementTimeoutMs: 5_000,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].primaryPropertyId).toBe(propertyId);
    expect(groups[0].address).toContain('Set Based Tile Street');
    expect(groups[0].askingPrice).toBe(625000);
    expect(groups[0].thumbnailUrl).toBe('https://cdn.example.com/set-based.jpg');
    expect(groups[0].hasActiveListing).toBe(true);
    expect(groups[0].marketState).toBe('for-sale');
    const hydrationQuery = renderedQueries.find((text) =>
      text.includes('target_properties AS MATERIALIZED')
    );
    expect(hydrationQuery).toBeDefined();
    expect(hydrationQuery).toContain('active_listing AS MATERIALIZED');
    expect(hydrationQuery).toContain('latest_listing AS MATERIALIZED');
    expect(hydrationQuery).toContain('listing_thumbnail AS MATERIALIZED');
    expect(hydrationQuery).toContain(
      'FROM canonical_listings cl INNER JOIN target_properties sp ON sp.id = cl.property_id'
    );
    expect(hydrationQuery).toContain('tile_listing_facts AS MATERIALIZED');
    expect(hydrationQuery).toContain("WHERE cl.verification_state <> 'invalid'");
    expect(hydrationQuery).toContain(
      "ORDER BY l.property_id, (l.status = 'active') DESC, l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC"
    );
    expect(hydrationQuery).not.toContain('v_canonical_listing_facts');
    expect(hydrationQuery).not.toContain('LEFT JOIN LATERAL');
    expect(transactionSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps ghost candidate scope as all active bbox properties', () => {
    const query = buildGroupingCandidateScopeCtes(
      [{ minLon: 4, minLat: 51, maxLon: 5, maxLat: 52 }],
      true,
      createDefaultMapFilters(),
      13
    );
    const text = renderSql(query).replace(/\s+/g, ' ').trim();

    expect(text).toContain('candidate_properties AS MATERIALIZED');
    expect(text).toContain('FROM properties p');
    expect(text).toContain("WHERE p.geometry IS NOT NULL AND p.status = 'active'");
    expect(text).toContain('p.geometry && ST_MakeEnvelope');
    expect(text).not.toContain('listing_candidate_ids AS MATERIALIZED');
    expect(text).not.toContain('candidate_property_ids AS MATERIALIZED');
  });

  it('classifies only statement-timeout 57014 errors as tile statement timeouts', () => {
    expect(
      isPropertyTileStatementTimeoutError({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      })
    ).toBe(true);
    expect(
      isPropertyTileStatementTimeoutError({
        code: '57014',
        message: 'canceling statement due to user request',
      })
    ).toBe(false);
    expect(isPropertyTileStatementTimeoutError({ code: '40001', message: 'serialization' })).toBe(
      false
    );
  });

  it('classifies wrapped statement-timeout 57014 errors as tile statement timeouts', () => {
    expect(
      isPropertyTileStatementTimeoutError(
        new Error('Failed query', {
          cause: {
            code: '57014',
            message: 'canceling statement due to statement timeout',
          },
        })
      )
    ).toBe(true);
  });

  it('checks CPU runtime budgets against the whole tile build deadline', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const [lon, lat] = worldUnitsToLngLat(
      tile.x * PROPERTY_TILE_EXTENT + 800,
      tile.y * PROPERTY_TILE_EXTENT + 800,
      zoom
    );
    const candidate = makeCandidate('00000000-0000-0000-0000-0000000000bd', lon, lat, zoom);

    expect(() =>
      groupCandidatesForTile(tile, [candidate], {
        runtimeBudgetMs: 10,
        runtimeStartedAtMs: Date.now() - 20,
      })
    ).toThrow(PropertyTileBudgetExceededError);
  });

  it('keeps public property tile cache entries stale after the fresh TTL expires', () => {
    const cache = new PublicPropertyTileCache();
    cache.set(
      '13/4208/2686:default',
      {
        payload: Buffer.from('tile'),
        statusCode: 200,
        etag: '"tile"',
      },
      1_000
    );

    expect(cache.get('13/4208/2686:default', 1_000 + 299_000).state).toBe('fresh');
    const staleLookup = cache.get('13/4208/2686:default', 1_000 + 301_000);
    expect(staleLookup.state).toBe('stale');
    expect(staleLookup.state === 'stale' ? staleLookup.entry.payload?.toString() : null).toBe(
      'tile'
    );
  });

  it('does not return stale empty entries for public stale fallback', () => {
    const cache = new PublicPropertyTileCache();
    cache.set(
      '13/4208/2686:default',
      {
        payload: null,
        statusCode: 204,
        etag: '"empty"',
      },
      1_000
    );

    expect(cache.get('13/4208/2686:default', 1_000 + 301_000).state).toBe('stale');
    expect(cache.getStale('13/4208/2686:default', 1_000 + 301_000)).toBeNull();
  });

  it('does not loosen caller budgets for shared canonical builds', async () => {
    const originalSharedBudget = process.env.PROPERTY_TILE_SHARED_CANONICAL_BUDGET_MS;
    process.env.PROPERTY_TILE_SHARED_CANONICAL_BUDGET_MS = '5000';

    try {
      const tile = { z: 18, x: 100000, y: 70000 };
      const transactionSpy = jest.spyOn(db, 'transaction');
      const startedAt = Date.now() - 10;

      await expect(
        buildCanonicalGroupsForTile(tile, createDefaultMapFilters(), {
          runtimeBudgetMs: 1,
          runtimeStartedAtMs: startedAt,
          runtimeDeadlineMs: startedAt + 1,
          statementTimeoutMs: 1,
        })
      ).rejects.toBeInstanceOf(PropertyTileBudgetExceededError);
      expect(transactionSpy).not.toHaveBeenCalled();

      const rows = deferred<Iterable<never>>();
      let executeCalls = 0;
      const txExecuteMock = jest.fn(async () => {
        executeCalls += 1;
        if (executeCalls < 3) {
          return [] as never;
        }
        return rows.promise as Promise<never>;
      });
      transactionSpy.mockImplementation(async (callback) =>
        callback({ execute: txExecuteMock } as never)
      );
      const secondStartedAt = Date.now();
      const second = buildCanonicalGroupsForTile(tile, createDefaultMapFilters(), {
        runtimeBudgetMs: 5_000,
        runtimeStartedAtMs: secondStartedAt,
        runtimeDeadlineMs: secondStartedAt + 5_000,
        statementTimeoutMs: 5_000,
      });

      rows.resolve([] as never);
      await expect(second).resolves.toEqual([]);
      expect(transactionSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (originalSharedBudget == null) {
        delete process.env.PROPERTY_TILE_SHARED_CANONICAL_BUDGET_MS;
      } else {
        process.env.PROPERTY_TILE_SHARED_CANONICAL_BUDGET_MS = originalSharedBudget;
      }
    }
  });

  it('keeps a shared canonical build available for callers with viable budgets', async () => {
    const rows = deferred<Iterable<never>>();
    let executeCalls = 0;
    const txExecuteMock = jest.fn(async () => {
      executeCalls += 1;
      if (executeCalls < 3) {
        return [] as never;
      }
      return rows.promise as Promise<never>;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));
    const tile = { z: 18, x: 100000, y: 70000 };
    const filters = createDefaultMapFilters();
    const startedAt = Date.now();
    const first = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: startedAt,
      runtimeDeadlineMs: startedAt + 5_000,
      statementTimeoutMs: 5_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondStartedAt = Date.now();
    const second = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: secondStartedAt,
      runtimeDeadlineMs: secondStartedAt + 5_000,
      statementTimeoutMs: 5_000,
    });

    rows.resolve([] as never);

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('starts shared canonical work when an old caller start still has deadline remaining', async () => {
    const txExecuteMock = jest.fn(async () => [] as never);
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));
    const tile = { z: 18, x: 100002, y: 70002 };
    const now = Date.now();

    await expect(
      buildCanonicalGroupsForTile(tile, createDefaultMapFilters(), {
        runtimeBudgetMs: 1_500,
        runtimeStartedAtMs: now - 1_000,
        runtimeDeadlineMs: now + 500,
        statementTimeoutMs: 1_500,
      })
    ).resolves.toEqual([]);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it("does not let one shared canonical waiter's abort reject later viable waiters", async () => {
    const rows = deferred<Iterable<never>>();
    let executeCalls = 0;
    const txExecuteMock = jest.fn(async () => {
      executeCalls += 1;
      if (executeCalls < 3) {
        return [] as never;
      }
      return rows.promise as Promise<never>;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));
    const tile = { z: 18, x: 100003, y: 70003 };
    const filters = createDefaultMapFilters();
    const firstController = new AbortController();
    const firstStartedAt = Date.now();
    const first = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: firstStartedAt,
      runtimeDeadlineMs: firstStartedAt + 5_000,
      statementTimeoutMs: 5_000,
      signal: firstController.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondStartedAt = Date.now();
    const second = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: secondStartedAt,
      runtimeDeadlineMs: secondStartedAt + 5_000,
      statementTimeoutMs: 5_000,
    });

    firstController.abort();
    await expect(first).rejects.toBeInstanceOf(PropertyTileBuildAbortedError);

    rows.resolve([] as never);
    await expect(second).resolves.toEqual([]);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts shared canonical work after SQL when all waiters abort and skips cache publish', async () => {
    const rows = deferred<Iterable<never>>();
    let releaseFirstQuery!: () => void;
    const firstQueryReturned = new Promise<void>((resolve) => {
      releaseFirstQuery = resolve;
    });
    let executeCalls = 0;
    const txExecuteMock = jest.fn(async () => {
      executeCalls += 1;
      if (executeCalls === 3) {
        const result = await rows.promise;
        releaseFirstQuery();
        return result;
      }
      return [] as never;
    });
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));
    const lon = 5.4697;
    const lat = 51.4416;
    const tile = tileForCoordinate(lon, lat, 18);
    const filters = createDefaultMapFilters();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstStartedAt = Date.now();
    const first = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: firstStartedAt,
      runtimeDeadlineMs: firstStartedAt + 5_000,
      statementTimeoutMs: 5_000,
      signal: firstController.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondStartedAt = Date.now();
    const second = buildCanonicalGroupsForTile(tile, filters, {
      runtimeBudgetMs: 5_000,
      runtimeStartedAtMs: secondStartedAt,
      runtimeDeadlineMs: secondStartedAt + 5_000,
      statementTimeoutMs: 5_000,
      signal: secondController.signal,
    });

    firstController.abort();
    secondController.abort();

    await expect(first).rejects.toBeInstanceOf(PropertyTileBuildAbortedError);
    await expect(second).rejects.toBeInstanceOf(PropertyTileBuildAbortedError);

    rows.resolve([
      {
        id: crypto.randomUUID(),
        has_active_listing: false,
        has_completed_listing: false,
        social_score: 0,
        recent_social_score: 0,
        comment_count: 0,
        market_state: 'not-listed',
        lon,
        lat,
      },
    ] as never);
    await firstQueryReturned;
    await new Promise((resolve) => setImmediate(resolve));

    const thirdStartedAt = Date.now();
    await expect(
      buildCanonicalGroupsForTile(tile, filters, {
        runtimeBudgetMs: 5_000,
        runtimeStartedAtMs: thirdStartedAt,
        runtimeDeadlineMs: thirdStartedAt + 5_000,
        statementTimeoutMs: 5_000,
      })
    ).resolves.toEqual([]);
    expect(transactionSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves caller abort signals for shared canonical builds', async () => {
    const transactionSpy = jest.spyOn(db, 'transaction');
    const tile = { z: 18, x: 100001, y: 70001 };
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildCanonicalGroupsForTile(tile, createDefaultMapFilters(), {
        runtimeBudgetMs: 5_000,
        runtimeStartedAtMs: Date.now(),
        runtimeDeadlineMs: Date.now() + 5_000,
        statementTimeoutMs: 5_000,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(PropertyTileBuildAbortedError);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('keeps active grouping available at high zoom when points are still visually dense', () => {
    const zoom = 18;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const denseA = makeCandidate('00000000-0000-0000-0000-000000000001', baseLon, baseLat, zoom, {
      socialScore: 80,
      commentCount: 5,
    });
    const denseB = makeCandidate(
      '00000000-0000-0000-0000-000000000002',
      baseLon + 0.00002,
      baseLat + 0.00001,
      zoom,
      { socialScore: 20 }
    );

    const groups = groupCandidatesForTile(tile, [denseA, denseB]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(2);
    expect(groups[0].propertyIds).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);
  });

  it('de-clusters sparse active points at high zoom when they are no longer visually dense', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const worldY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const worldXLeft = tile.x * PROPERTY_TILE_EXTENT + 800;
    const worldXRight = worldXLeft + 400;
    const [leftLon, leftLat] = worldUnitsToLngLat(worldXLeft, worldY, zoom);
    const [rightLon, rightLat] = worldUnitsToLngLat(worldXRight, worldY, zoom);

    const left = makeCandidate('00000000-0000-0000-0000-000000000031', leftLon, leftLat, zoom, {
      socialScore: 90,
      commentCount: 2,
    });
    const right = makeCandidate('00000000-0000-0000-0000-000000000032', rightLon, rightLat, zoom, {
      socialScore: 65,
      commentCount: 1,
    });

    const groups = groupCandidatesForTile(tile, [left, right]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.groupKind)).toEqual(['single', 'single']);
    expect(groups.map((group) => group.nodeClass)).toEqual(['active', 'active']);
    expect(groups.map((group) => group.primaryPropertyId).sort()).toEqual(
      [left.id, right.id].sort()
    );
  });

  it('keeps the grouping buffer large enough for a six-member active cluster crossing the tile edge', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const rightEdgeX = (tile.x + 1) * PROPERTY_TILE_EXTENT;
    const centerY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const activePairThresholdPx =
      getActiveClusterRadiusPx(2) +
      PROPERTY_MAP_FOOTPRINTS.active.groupingGapPx +
      getActiveClusterRadiusPx(2);
    const requiredPx = activePairThresholdPx * 2;

    const leftA = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000031',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 10, commentCount: 4 }
    );
    const leftB = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000032',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 9, commentCount: 3 }
    );
    const leftC = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000033',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 8, commentCount: 2 }
    );
    const leftD = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000034',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 7, commentCount: 1 }
    );
    const seed = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000035',
      rightEdgeX + 33,
      centerY,
      zoom,
      { socialScore: 100 }
    );
    const extra = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000036',
      rightEdgeX + 66,
      centerY,
      zoom,
      { socialScore: 1 }
    );

    const candidates = [leftA, leftB, leftC, leftD, seed, extra];
    const groups = groupCandidatesForTile(tile, candidates);

    expect(getGroupingBufferUnits() / TILE_UNITS_PER_PX).toBeGreaterThanOrEqual(requiredPx);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(6);
    expect(groups[0].ownerTile).toEqual(tile);
    expect(groups[0].propertyIds).toEqual([
      seed.id,
      leftA.id,
      leftB.id,
      leftC.id,
      leftD.id,
      extra.id,
    ]);
  });

  it('keeps the grouping buffer large enough for ghost suppression by large active clusters', () => {
    const requiredPx =
      getActiveClusterRadiusPx(100) +
      PROPERTY_MAP_FOOTPRINTS.ghost.suppressionPaddingPx +
      Math.max(getGhostSingleRadiusPx(), getGhostClusterRadiusPx(2));

    expect(getGroupingBufferUnits() / TILE_UNITS_PER_PX).toBeGreaterThanOrEqual(requiredPx);
  });

  it('keeps bridge candidates separate to avoid transitive chain clustering', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1024;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1024;

    const groupingRadiusUnits =
      Math.max(getActiveSingleRadiusPx(10), getActiveClusterRadiusPx(2)) * TILE_UNITS_PER_PX;
    const pairThresholdUnits = groupingRadiusUnits + groupingRadiusUnits + 2 * TILE_UNITS_PER_PX;
    const stepUnits = Math.floor(pairThresholdUnits - 8);

    const [alphaLon, alphaLat] = worldUnitsToLngLat(originX, originY, zoom);
    const [betaLon, betaLat] = worldUnitsToLngLat(originX + stepUnits, originY, zoom);
    const [gammaLon, gammaLat] = worldUnitsToLngLat(originX + stepUnits * 2, originY, zoom);

    const alpha = makeCandidate('00000000-0000-0000-0000-000000000051', alphaLon, alphaLat, zoom, {
      socialScore: 10,
      hasActiveListing: true,
      commentCount: 3,
    });
    const beta = makeCandidate('00000000-0000-0000-0000-000000000052', betaLon, betaLat, zoom, {
      socialScore: 10,
      hasActiveListing: true,
      commentCount: 2,
    });
    const gamma = makeCandidate('00000000-0000-0000-0000-000000000053', gammaLon, gammaLat, zoom, {
      socialScore: 10,
      hasActiveListing: true,
      commentCount: 1,
    });

    const groups = groupCandidatesForTile(tile, [alpha, beta, gamma]);

    expect(groups).toHaveLength(2);
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(2);
    expect(groups[0].propertyIds).toEqual([alpha.id, beta.id]);
    expect(groups[1].groupKind).toBe('single');
    expect(groups[1].pointCount).toBe(1);
    expect(groups[1].propertyIds).toEqual([gamma.id]);
  });

  it('drops ghost candidates while keeping active candidates once legacy ghosts would reveal', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const originY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const [activeLon, activeLat] = worldUnitsToLngLat(originX, originY, zoom);
    const active = makeCandidate(
      '00000000-0000-0000-0000-000000000011',
      activeLon,
      activeLat,
      zoom,
      {
        socialScore: 95,
        worldX: originX,
        worldY: originY,
      }
    );
    const activeOccupancyRadiusUnits =
      (getActiveSingleRadiusPx(active.socialScore) +
        PROPERTY_MAP_FOOTPRINTS.ghost.suppressionPaddingPx) *
      TILE_UNITS_PER_PX;
    const ghostRadiusUnits =
      Math.max(getGhostSingleRadiusPx(), getGhostClusterRadiusPx(2)) * TILE_UNITS_PER_PX;
    const suppressionThresholdUnits = activeOccupancyRadiusUnits + ghostRadiusUnits;
    const [suppressedLon, suppressedLat] = worldUnitsToLngLat(
      originX + suppressionThresholdUnits,
      originY,
      zoom
    );
    const suppressedGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000012',
      suppressedLon,
      suppressedLat,
      zoom,
      {
        hasActiveListing: false,
        socialScore: 0,
        worldX: originX + suppressionThresholdUnits,
        worldY: originY,
      }
    );
    const [farLon, farLat] = worldUnitsToLngLat(
      originX + suppressionThresholdUnits + TILE_UNITS_PER_PX,
      originY,
      zoom
    );
    const farGhost = makeCandidate('00000000-0000-0000-0000-000000000013', farLon, farLat, zoom, {
      hasActiveListing: false,
      socialScore: 0,
      worldX: originX + suppressionThresholdUnits + TILE_UNITS_PER_PX,
      worldY: originY,
    });

    const groups = groupCandidatesForTile(tile, [active, suppressedGhost, farGhost]);
    const activeGroup = groups.find((group) => group.nodeClass === 'active');

    expect(groups).toHaveLength(1);
    expect(activeGroup?.primaryPropertyId).toBe(active.id);
    expect(groups.find((group) => group.primaryPropertyId === suppressedGhost.id)).toBeUndefined();
    expect(groups.find((group) => group.primaryPropertyId === farGhost.id)).toBeUndefined();
  });

  it('keeps listing-backed zero-social candidates active below ghost reveal zoom while hiding true ghosts', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const listed = makeCandidate('00000000-0000-0000-0000-000000000013', baseLon, baseLat, zoom, {
      hasActiveListing: true,
      socialScore: 0,
      recentSocialScore: 0,
      marketState: 'for-sale',
    });
    const hiddenGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000014',
      baseLon + 0.001,
      baseLat + 0.001,
      zoom,
      {
        hasActiveListing: false,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'not-listed',
      }
    );

    const groups = groupCandidatesForTile(tile, [listed, hiddenGhost]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('single');
    expect(groups[0].primaryPropertyId).toBe(listed.id);
    expect(groups[0].propertyIds).toEqual([listed.id]);
    expect(groups[0].activeListingCount).toBe(1);
    expect(groups[0].completedListingCount).toBe(0);
    expect(groups[0].socialCount).toBe(0);
    expect(groups[0].socialScoreTotal).toBe(0);
  });

  it('keeps completed listing-backed zero-social candidates active below ghost reveal zoom', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const sold = makeCandidate('00000000-0000-0000-0000-000000000018', baseLon, baseLat, zoom, {
      hasActiveListing: false,
      hasCompletedListing: true,
      socialScore: 0,
      recentSocialScore: 0,
      marketState: 'sold',
    });

    const groups = groupCandidatesForTile(tile, [sold]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('single');
    expect(groups[0].primaryPropertyId).toBe(sold.id);
    expect(groups[0].activeListingCount).toBe(0);
    expect(groups[0].completedListingCount).toBe(1);
    expect(groups[0].socialCount).toBe(0);
    expect(groups[0].marketState).toBe('sold');
  });

  it('keeps completed listing-only groups active and counts them separately from active listings', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1600;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1600;
    const sold = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000019',
      originX,
      originY,
      zoom,
      {
        hasActiveListing: false,
        hasCompletedListing: true,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'sold',
      }
    );
    const rented = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000020',
      originX + 24,
      originY,
      zoom,
      {
        hasActiveListing: false,
        hasCompletedListing: true,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'rented',
      }
    );

    const groups = groupCandidatesForTile(tile, [sold, rented]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].activeListingCount).toBe(0);
    expect(groups[0].completedListingCount).toBe(2);
    expect(groups[0].socialCount).toBe(0);
  });

  it('keeps active listing and social visuals additive when grouped with completed listings', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1800;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1800;
    const completed = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000023',
      originX,
      originY,
      zoom,
      {
        hasActiveListing: false,
        hasCompletedListing: true,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'sold',
      }
    );
    const activeListing = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000024',
      originX + 18,
      originY,
      zoom,
      {
        hasActiveListing: true,
        hasCompletedListing: false,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'for-sale',
      }
    );
    const social = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000025',
      originX + 36,
      originY,
      zoom,
      {
        hasActiveListing: false,
        hasCompletedListing: false,
        socialScore: 4,
        recentSocialScore: 4,
        marketState: 'not-listed',
      }
    );

    const groups = groupCandidatesForTile(tile, [completed, activeListing, social]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].activeListingCount).toBe(1);
    expect(groups[0].completedListingCount).toBe(1);
    expect(groups[0].socialCount).toBe(1);
    expect(groups[0].recentSocialCount).toBe(1);
  });

  it('preserves listing-only and social-only semantics while dropping ghost candidates after scoping', () => {
    const hiddenZoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const revealedZoom = GHOST_NODE_REVEAL_ZOOM;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const ghostLon = baseLon + 0.002;
    const hiddenTile = tileForCoordinate(baseLon, baseLat, hiddenZoom);
    const revealedTile = tileForCoordinate(ghostLon, baseLat, revealedZoom);
    const listingOnly = makeCandidate(
      '00000000-0000-0000-0000-000000000071',
      baseLon,
      baseLat,
      hiddenZoom,
      {
        hasActiveListing: false,
        hasCompletedListing: true,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'sold',
      }
    );
    const socialOnly = makeCandidate(
      '00000000-0000-0000-0000-000000000072',
      baseLon + 0.001,
      baseLat,
      hiddenZoom,
      {
        hasActiveListing: false,
        hasCompletedListing: false,
        socialScore: 0.8,
        recentSocialScore: 0.8,
        marketState: 'not-listed',
      }
    );
    const hiddenGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000073',
      ghostLon,
      baseLat,
      hiddenZoom,
      {
        hasActiveListing: false,
        hasCompletedListing: false,
        socialScore: 0.1,
        recentSocialScore: 0.1,
        marketState: 'not-listed',
      }
    );
    const revealedGhost = makeCandidate(hiddenGhost.id, ghostLon, baseLat, revealedZoom, {
      hasActiveListing: false,
      hasCompletedListing: false,
      socialScore: 0.1,
      recentSocialScore: 0.1,
      marketState: 'not-listed',
    });

    const hiddenGroups = groupCandidatesForTile(hiddenTile, [listingOnly, socialOnly, hiddenGhost]);
    const revealedGroups = groupCandidatesForTile(revealedTile, [revealedGhost]);

    expect(hiddenGroups).toHaveLength(2);
    expect(hiddenGroups.find((group) => group.primaryPropertyId === listingOnly.id)).toMatchObject({
      nodeClass: 'active',
      groupKind: 'single',
      completedListingCount: 1,
      socialCount: 0,
      marketState: 'sold',
    });
    expect(hiddenGroups.find((group) => group.primaryPropertyId === socialOnly.id)).toMatchObject({
      nodeClass: 'active',
      groupKind: 'single',
      activeListingCount: 0,
      completedListingCount: 0,
      socialCount: 1,
      marketState: 'not-listed',
    });
    expect(
      hiddenGroups.find((group) => group.primaryPropertyId === hiddenGhost.id)
    ).toBeUndefined();
    expect(revealedGroups).toHaveLength(0);
  });

  it('keeps a single unique view below active-node semantics', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const viewed = makeCandidate('00000000-0000-0000-0000-000000000015', baseLon, baseLat, zoom, {
      hasActiveListing: false,
      socialScore: 0.1,
      recentSocialScore: 0.1,
      marketState: 'not-listed',
    });

    const groups = groupCandidatesForTile(tile, [viewed]);

    expect(groups).toHaveLength(0);
  });

  it('allows enough unique-view interest to promote a non-listing node', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const viewed = makeCandidate('00000000-0000-0000-0000-000000000016', baseLon, baseLat, zoom, {
      hasActiveListing: false,
      socialScore: 0.8,
      recentSocialScore: 0.8,
      marketState: 'not-listed',
    });

    const groups = groupCandidatesForTile(tile, [viewed]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('single');
    expect(groups[0].primaryPropertyId).toBe(viewed.id);
    expect(groups[0].activeListingCount).toBe(0);
    expect(groups[0].socialCount).toBe(1);
    expect(groups[0].recentSocialCount).toBe(1);
    expect(groups[0].socialScoreTotal).toBe(0.8);
    expect(groups[0].recentSocialScoreTotal).toBe(0.8);
  });

  it('drops revealed one-view non-listing nodes instead of emitting ghost nodes', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const viewed = makeCandidate('00000000-0000-0000-0000-000000000017', baseLon, baseLat, zoom, {
      hasActiveListing: false,
      socialScore: 0.1,
      recentSocialScore: 0.1,
      marketState: 'not-listed',
    });

    const groups = groupCandidatesForTile(tile, [viewed]);

    expect(groups).toHaveLength(0);
  });

  it('drops selected-area not-listed candidates with zero listing and social counts', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const selectedAreaCandidate = makeCandidate(
      '00000000-0000-0000-0000-000000000018',
      baseLon,
      baseLat,
      zoom,
      {
        hasActiveListing: false,
        hasCompletedListing: false,
        socialScore: 0,
        recentSocialScore: 0,
        commentCount: 0,
        marketState: 'not-listed',
      }
    );

    const groups = groupCandidatesForTile(tile, [selectedAreaCandidate]);

    expect(groups).toHaveLength(0);
  });

  it('does not build ghost clusters once legacy ghosts would reveal', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1500;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1700;
    const [ghostLonA, ghostLatA] = worldUnitsToLngLat(originX, originY, zoom);
    const [ghostLonB, ghostLatB] = worldUnitsToLngLat(originX + 40, originY + 30, zoom);
    const [activeLon, activeLat] = worldUnitsToLngLat(originX + 1200, originY, zoom);

    const ghostA = makeCandidate(
      '00000000-0000-0000-0000-000000000041',
      ghostLonA,
      ghostLatA,
      zoom,
      { hasActiveListing: false, socialScore: 0 }
    );
    const ghostB = makeCandidate(
      '00000000-0000-0000-0000-000000000042',
      ghostLonB,
      ghostLatB,
      zoom,
      { hasActiveListing: false, socialScore: 0 }
    );
    const active = makeCandidate(
      '00000000-0000-0000-0000-000000000043',
      activeLon,
      activeLat,
      zoom,
      { hasActiveListing: true, socialScore: 18, commentCount: 4 }
    );

    const groups = groupCandidatesForTile(tile, [ghostA, ghostB, active]);
    const ghostGroup = groups.find((group) => group.nodeClass === 'ghost');
    const activeGroup = groups.find((group) => group.nodeClass === 'active');

    expect(groups).toHaveLength(1);
    expect(activeGroup?.groupKind).toBe('single');
    expect(ghostGroup).toBeUndefined();
  });

  it('orders preview members by grouping priority and caps them to the preview member limit', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 2048;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 2048;

    const specs = Array.from({ length: PROPERTY_PREVIEW_MEMBER_LIMIT + 5 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, '0')}`,
      socialScore:
        index === 0 ? 80 : index === 1 ? 80 : index === 2 ? 80 : index === 3 ? 65 : 64 - index,
      hasActiveListing: index !== 2,
      commentCount:
        index === 0
          ? 2
          : index === 1
            ? 5
            : index === 2
              ? 99
              : PROPERTY_PREVIEW_MEMBER_LIMIT + 5 - index,
    }));

    const candidates = specs.map((spec, index) => {
      const [lon, lat] = worldUnitsToLngLat(
        originX + (index % 6) * 12,
        originY + Math.floor(index / 6) * 12,
        zoom
      );
      return makeCandidate(spec.id, lon, lat, zoom, {
        socialScore: spec.socialScore,
        hasActiveListing: spec.hasActiveListing,
        commentCount: spec.commentCount,
      });
    });

    const expectedOrder = [...candidates]
      .sort(
        (a, b) =>
          b.socialScore - a.socialScore ||
          Number(b.hasActiveListing) - Number(a.hasActiveListing) ||
          b.commentCount - a.commentCount ||
          a.id.localeCompare(b.id)
      )
      .map((candidate) => candidate.id);

    const [group] = groupCandidatesForTile(tile, candidates);

    expect(group.groupKind).toBe('cluster');
    expect(group.pointCount).toBe(candidates.length);
    expect(group.propertyIds).toEqual(expectedOrder);
    expect(group.previewPropertyIds).toEqual(expectedOrder.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT));
    expect(group.previewPropertyIds).toHaveLength(PROPERTY_PREVIEW_MEMBER_LIMIT);
    expect(group.previewPropertyIds).toEqual(
      group.propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT)
    );
  });

  it('aggregates very large active clusters without spread argument overflow', () => {
    const zoom = 17;
    const tile = { z: zoom, x: 100, y: 100 };
    const worldX = tile.x * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const worldY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const memberCount = 140_000;
    const candidates = Array.from({ length: memberCount }, (_, index) =>
      makeCandidateAtWorld(makePropertyId(index), worldX, worldY, zoom, {
        socialScore: index % 97,
        recentSocialScore: index % 53,
        commentCount: 1,
        hasActiveListing: index % 2 === 0,
        hasCompletedListing: index % 2 !== 0,
        marketState: index % 2 === 0 ? 'for-sale' : 'sold',
      })
    );

    const groups = groupCandidatesForTile(tile, candidates);

    expect(groups).toHaveLength(1);
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(memberCount);
    expect(groups[0].propertyIds).toHaveLength(memberCount);
    expect(groups[0].previewPropertyIds).toHaveLength(PROPERTY_PREVIEW_MEMBER_LIMIT);
    expect(groups[0].activeListingCount).toBe(memberCount / 2);
    expect(groups[0].completedListingCount).toBe(memberCount / 2);
    expect(groups[0].socialScoreMax).toBe(96);
    expect(groups[0].commentCount).toBe(memberCount);
    expect(groups[0].bbox).toEqual([
      groups[0].coordinate[0],
      groups[0].coordinate[1],
      groups[0].coordinate[0],
      groups[0].coordinate[1],
    ]);
  }, 30_000);

  it('can omit full cluster property id membership while retaining capped previews for pyramid builds', () => {
    const zoom = 17;
    const tile = { z: zoom, x: 100, y: 100 };
    const worldX = tile.x * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const worldY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const candidates = Array.from({ length: PROPERTY_PREVIEW_MEMBER_LIMIT + 20 }, (_, index) =>
      makeCandidateAtWorld(makePropertyId(index), worldX, worldY, zoom, {
        socialScore: PROPERTY_PREVIEW_MEMBER_LIMIT + 20 - index,
      })
    );

    const [group] = groupCandidatesForTile(tile, candidates, {
      clusterPropertyIdRetention: 'preview-only',
    });

    expect(group.groupKind).toBe('cluster');
    expect(group.pointCount).toBe(candidates.length);
    expect(group.propertyIds).toEqual([]);
    expect(group.previewPropertyIds).toHaveLength(PROPERTY_PREVIEW_MEMBER_LIMIT);
    expect(group.previewPropertyIds).toEqual(
      [...candidates]
        .sort((a, b) => b.socialScore - a.socialScore || a.id.localeCompare(b.id))
        .slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT)
        .map((candidate) => candidate.id)
    );
  });

  it('emits a cross-edge group from only the tile that owns the representative anchor', () => {
    const zoom = 17;
    const ownerTile = { z: zoom, x: 100, y: 100 };
    const neighborTile = { z: zoom, x: 101, y: 100 };
    const worldXLeft = ownerTile.x * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT - 30;
    const worldXRight = neighborTile.x * PROPERTY_TILE_EXTENT + 20;
    const worldY = ownerTile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const [ownerLon, ownerLat] = worldUnitsToLngLat(worldXLeft, worldY, zoom);
    const [neighborLon, neighborLat] = worldUnitsToLngLat(worldXRight, worldY, zoom);

    const left = makeCandidate('00000000-0000-0000-0000-000000000021', ownerLon, ownerLat, zoom, {
      socialScore: 70,
      commentCount: 2,
    });
    const right = makeCandidate(
      '00000000-0000-0000-0000-000000000022',
      neighborLon,
      neighborLat,
      zoom,
      {
        socialScore: 10,
      }
    );

    const ownerGroups = groupCandidatesForTile(ownerTile, [left, right]);
    const neighborGroups = groupCandidatesForTile(neighborTile, [left, right]);

    expect(ownerGroups).toHaveLength(1);
    expect(ownerGroups[0].groupKind).toBe('cluster');
    expect(ownerGroups[0].primaryPropertyId).toBe(left.id);
    expect(neighborGroups).toHaveLength(0);
  });

  it('hydrates nearby singles from a shared neighborhood pass', async () => {
    const lon = 5.471235;
    const lat = 51.443432;
    const zoom = 17;
    const propertyId = '00000000-0000-4000-a000-0000000000aa';
    const txExecuteMock = jest
      .fn()
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: propertyId,
          has_active_listing: true,
          social_score: 8,
          recent_social_score: 8,
          comment_count: 2,
          market_state: 'for-sale',
          lon,
          lat,
        },
      ] as never);
    const transactionSpy = jest
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback) => callback({ execute: txExecuteMock } as never));

    const executeSpy = jest
      .spyOn(db, 'execute')
      .mockResolvedValueOnce([
        {
          id: propertyId,
          country_code: 'NL',
          street: 'Mockstraat',
          house_number: 12,
          house_number_addition: 'A',
          city: 'Eindhoven',
          postal_code: '5611 AA',
          asking_price: 359000,
          thumbnail_url: 'https://cdn.example.com/mock-thumb.jpg',
        },
      ] as never)
      .mockImplementation(() => {
        throw new Error('resolveNearbyGroupedFeature should only execute one shared detail query');
      });

    const result = await resolveNearbyGroupedFeature(lon, lat, zoom);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(txExecuteMock).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result?.groupKind).toBe('single');
    expect(result?.nodeClass).toBe('active');
    expect(result?.primaryPropertyId).toBe(propertyId);
    expect(result?.address).toBe('Mockstraat 12A, 5611 AA Eindhoven');
    expect(result?.city).toBe('Eindhoven');
    expect(result?.askingPrice).toBe(359000);
    expect(result?.thumbnailUrl).toBe('https://cdn.example.com/mock-thumb.jpg');
    expect(result?.distanceMeters).toBe(0);
  });

  it('serializes grouped singles as thin preview seeds for tile transport', () => {
    const feature = serializeGroupForTile({
      nodeClass: 'active',
      groupKind: 'single',
      primaryPropertyId: '00000000-0000-4000-a000-0000000000bb',
      pointCount: 1,
      propertyIds: ['00000000-0000-4000-a000-0000000000bb'],
      previewPropertyIds: ['00000000-0000-4000-a000-0000000000bb'],
      coordinate: [5.47, 51.44],
      bbox: null,
      activeListingCount: 1,
      completedListingCount: 0,
      socialCount: 1,
      recentSocialCount: 1,
      socialScoreTotal: 3,
      socialScoreMax: 3,
      recentSocialScoreTotal: 1,
      commentCount: 2,
      address: 'Mockstraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      countryCode: 'NL',
      askingPrice: 359000,
      officialValuation: null,
      officialValuationYear: null,
      thumbnailUrl: 'https://cdn.example.com/mock-thumb.jpg',
      hasActiveListing: true,
      marketState: 'for-sale',
      ownerTile: { z: 17, x: 67478, y: 43551 },
      anchorWorldX: 0,
      anchorWorldY: 0,
    });

    expect(feature).toMatchObject({
      address: 'Mockstraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      countryCode: 'NL',
      askingPrice: 359000,
      officialValuation: null,
      officialValuationYear: null,
      officialValuationSource: 'woz',
      officialValuationExpectedYear: 2025,
      officialValuationSupportsWeb: false,
      officialValuationSupportsNative: false,
      thumbnailUrl: 'https://cdn.example.com/mock-thumb.jpg',
      hasActiveListing: true,
      marketState: 'for-sale',
    });
    expect(feature).not.toHaveProperty('streetName');
    expect(feature).not.toHaveProperty('houseNumber');
    expect(feature).not.toHaveProperty('houseNumberAddition');
    expect(feature).not.toHaveProperty('postalCode');
    expect(feature).not.toHaveProperty('yearBuilt');
    expect(feature).not.toHaveProperty('floorAreaM2');
  });

  it('omits incomplete cluster property ids from low-zoom and large MVT transport', () => {
    const propertyIds = Array.from({ length: PROPERTY_PREVIEW_MEMBER_LIMIT + 2 }, (_, index) =>
      makePropertyId(index + 10_000)
    );
    const cluster = makeCanonicalGroup(10_000, {
      groupKind: 'cluster',
      pointCount: propertyIds.length,
      primaryPropertyId: propertyIds[0],
      propertyIds,
      previewPropertyIds: propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
      address: null,
      city: null,
      askingPrice: null,
      thumbnailUrl: null,
      hasActiveListing: null,
      marketState: null,
    });
    const lowZoomFeature = serializeGroupForTile(cluster, { z: 10, x: 511, y: 340 });
    const transitionFeature = serializeGroupForTile(cluster, { z: 14, x: 8418, y: 5428 });
    const largeHighZoomFeature = serializeGroupForTile(cluster, { z: 17, x: 67478, y: 43551 });
    const boundedHighZoomFeature = serializeGroupForTile(
      {
        ...cluster,
        pointCount: PROPERTY_PREVIEW_MEMBER_LIMIT,
        propertyIds: propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
      },
      { z: 17, x: 67478, y: 43551 }
    );
    const singleFeature = serializeGroupForTile(makeCanonicalGroup(10_100), {
      z: 10,
      x: 511,
      y: 340,
    });

    expect(lowZoomFeature.property_ids).toBe('');
    expect(transitionFeature.property_ids).toBe('');
    expect(largeHighZoomFeature.property_ids).toBe('');
    expect(lowZoomFeature.membership_complete).toBe(false);
    expect(lowZoomFeature.read_state_coverage).toBe('partial');
    expect(transitionFeature.membership_complete).toBe(false);
    expect(transitionFeature.read_state_coverage).toBe('partial');
    expect(largeHighZoomFeature.membership_complete).toBe(false);
    expect(largeHighZoomFeature.read_state_coverage).toBe('partial');
    expect(lowZoomFeature.preview_property_ids).toBe(
      propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).join(',')
    );
    expect(transitionFeature.preview_property_ids).toBe(
      propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).join(',')
    );
    expect(boundedHighZoomFeature.property_ids).toBe(
      propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).join(',')
    );
    expect(boundedHighZoomFeature.membership_complete).toBe(true);
    expect(boundedHighZoomFeature.read_state_coverage).toBe('complete');
    expect(singleFeature.property_ids).toBe(singleFeature.primary_property_id);
    expect(singleFeature.preview_property_ids).toBe(singleFeature.primary_property_id);
    expect(singleFeature.membership_complete).toBe(true);
    expect(singleFeature.read_state_coverage).toBe('complete');
  });

  it('encodes dense MVT feature sets through typed SQL values without JSONB expansion', async () => {
    const groups = Array.from({ length: 192 }, (_, index) => makeCanonicalGroup(index));
    const timings: Array<{ stage: string; itemCount?: number }> = [];
    let renderedMvtSql = '';
    const executeSpy = jest.spyOn(db, 'execute').mockImplementation((async (query: unknown) => {
      renderedMvtSql = renderSql(query as SQL)
        .replace(/\s+/g, ' ')
        .trim();
      return [{ mvt: Buffer.from('dense-mvt') }] as never;
    }) as never);

    const result = await buildMvtForGroups({ z: 17, x: 67478, y: 43551 }, groups, {
      onStageTiming: (timing) => {
        timings.push({ stage: timing.stage, itemCount: timing.itemCount });
      },
    });

    expect(result.toString()).toBe('dense-mvt');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(renderedMvtSql).toContain('feature_rows ( lon, lat, node_class');
    expect(renderedMvtSql).toContain(') AS ( VALUES');
    expect(renderedMvtSql).not.toContain('jsonb_array_elements');
    expect(renderedMvtSql).not.toContain('feature->>');
    expect(renderedMvtSql).not.toContain('::jsonb');
    expect(timings).toEqual(
      expect.arrayContaining([
        { stage: 'MVT feature construction', itemCount: groups.length },
        { stage: 'MVT SQL encoding', itemCount: 1 },
      ])
    );
  });

  it('does not place unbounded low-zoom cluster membership into MVT VALUES params', async () => {
    const propertyIds = Array.from({ length: 140_000 }, (_, index) =>
      makePropertyId(index + 20_000)
    );
    const omittedMemberId = propertyIds[PROPERTY_PREVIEW_MEMBER_LIMIT + 1];
    const cluster = makeCanonicalGroup(20_000, {
      groupKind: 'cluster',
      pointCount: propertyIds.length,
      primaryPropertyId: propertyIds[0],
      propertyIds,
      previewPropertyIds: propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
      address: null,
      city: null,
      askingPrice: null,
      thumbnailUrl: null,
      hasActiveListing: null,
      marketState: null,
    });
    let renderedMvtParams: unknown[] = [];
    const executeSpy = jest.spyOn(db, 'execute').mockImplementation((async (query: unknown) => {
      renderedMvtParams = renderSqlQuery(query as SQL).params;
      return [{ mvt: Buffer.from('bounded-mvt') }] as never;
    }) as never);

    const result = await buildMvtForGroups({ z: 10, x: 511, y: 340 }, [cluster]);

    expect(result.toString()).toBe('bounded-mvt');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(renderedMvtParams).toContain('');
    expect(renderedMvtParams).toContain(
      propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).join(',')
    );
    expect(
      renderedMvtParams.some(
        (param) => typeof param === 'string' && param.includes(omittedMemberId)
      )
    ).toBe(false);
  });

  it('applies map filters before grouping clustered active sale candidates', async () => {
    const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
    const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
    // Keep this fixture outside the seeded European dataset so the cluster only
    // contains the rows created by this test.
    const baseLon = -40.25;
    const baseLat = -32.5;
    const zoom = 20;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);

    await db.execute(sql`
      INSERT INTO properties (
        id,
        country_code,
        street,
        house_number,
        city,
        postal_code,
        status,
        geometry
      )
      VALUES
        (
          ${propertyIds[0]},
          'NL',
          'Filter Cluster Street',
          1,
          'Filterstad',
          '9999AA',
          'active',
          ST_SetSRID(ST_MakePoint(${baseLon}, ${baseLat}), 4326)
        ),
        (
          ${propertyIds[1]},
          'NL',
          'Filter Cluster Street',
          2,
          'Filterstad',
          '9999AA',
          'active',
          ST_SetSRID(ST_MakePoint(${baseLon}, ${baseLat}), 4326)
        )
    `);

    await db.execute(sql`
      INSERT INTO canonical_listings (
        id,
        property_id,
        source_name,
        canonical_url,
        display_url,
        status,
        verification_state,
        origin_summary,
        asking_price,
        price_type,
        first_seen_at,
        last_seen_at,
        last_reconciled_at,
        created_at,
        updated_at
      )
      VALUES
        (
          ${listingIds[0]},
          ${propertyIds[0]},
          'funda',
          ${`https://example.com/filter-cluster-${listingIds[0]}`},
          ${`https://example.com/filter-cluster-${listingIds[0]}`},
          'active',
          'provisional',
          'user',
          325000,
          'sale',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days'
        ),
        (
          ${listingIds[1]},
          ${propertyIds[1]},
          'funda',
          ${`https://example.com/filter-cluster-${listingIds[1]}`},
          ${`https://example.com/filter-cluster-${listingIds[1]}`},
          'active',
          'provisional',
          'user',
          825000,
          'sale',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day'
        )
    `);

    try {
      const unfilteredGroups = await buildCanonicalGroupsForTile(tile);
      const filteredGroups = await buildCanonicalGroupsForTile(
        tile,
        normalizeMapFilters({ salePriceFrom: 600000 })
      );

      const unfilteredCluster = unfilteredGroups.find((group) =>
        propertyIds.every((propertyId) => group.propertyIds.includes(propertyId))
      );
      expect(unfilteredCluster).toBeDefined();
      expect(unfilteredCluster?.groupKind).toBe('cluster');
      expect(unfilteredCluster?.pointCount).toBe(2);

      const filteredGroup = filteredGroups.find((group) =>
        group.propertyIds.includes(propertyIds[1])
      );
      expect(filteredGroup).toBeDefined();
      expect(filteredGroup?.groupKind).toBe('single');
      expect(filteredGroup?.pointCount).toBe(1);
      expect(filteredGroup?.propertyIds).toEqual([propertyIds[1]]);
      expect(filteredGroups.some((group) => group.propertyIds.includes(propertyIds[0]))).toBe(
        false
      );
    } finally {
      await db.execute(
        sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`
      );
    }
  }, 30000);

  it('preserves tile-local listing market state, price, invalid exclusion, and thumbnail ordering', async () => {
    const propertyId = crypto.randomUUID();
    const listingIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const baseLon = -41.25;
    const baseLat = -33.5;
    const tile = tileForCoordinate(baseLon, baseLat, 20);

    await db.execute(sql`
      INSERT INTO properties (
        id,
        country_code,
        street,
        house_number,
        city,
        postal_code,
        status,
        geometry
      )
      VALUES (
        ${propertyId},
        'NL',
        'Tile Facts Street',
        7,
        'Factstad',
        '9998AA',
        'active',
        ST_SetSRID(ST_MakePoint(${baseLon}, ${baseLat}), 4326)
      )
    `);

    await db.execute(sql`
      INSERT INTO canonical_listings (
        id,
        property_id,
        source_name,
        canonical_url,
        display_url,
        status,
        verification_state,
        origin_summary,
        asking_price,
        price_type,
        thumbnail_url,
        first_seen_at,
        last_seen_at,
        last_reconciled_at,
        created_at,
        updated_at
      )
      VALUES
        (
          ${listingIds[0]},
          ${propertyId},
          'pararius',
          ${`https://example.com/tile-facts-${listingIds[0]}`},
          ${`https://example.com/tile-facts-${listingIds[0]}`},
          'active',
          'provisional',
          'user',
          2100,
          NULL,
          'https://cdn.example.com/active-rent.jpg',
          NOW() - INTERVAL '3 days',
          NOW() - INTERVAL '3 days',
          NOW() - INTERVAL '3 days',
          NOW() - INTERVAL '3 days',
          NOW() - INTERVAL '3 days'
        ),
        (
          ${listingIds[1]},
          ${propertyId},
          'funda',
          ${`https://example.com/tile-facts-${listingIds[1]}`},
          ${`https://example.com/tile-facts-${listingIds[1]}`},
          'sold',
          'provisional',
          'user',
          475000,
          'buy',
          'https://cdn.example.com/newer-sold.jpg',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day'
        ),
        (
          ${listingIds[2]},
          ${propertyId},
          'funda',
          ${`https://example.com/tile-facts-${listingIds[2]}`},
          ${`https://example.com/tile-facts-${listingIds[2]}`},
          'active',
          'invalid',
          'user',
          999999,
          'sale',
          'https://cdn.example.com/invalid-active.jpg',
          NOW(),
          NOW(),
          NOW(),
          NOW(),
          NOW()
        )
    `);

    try {
      const groups = await buildCanonicalGroupsForTile(tile);
      const group = groups.find((candidate) => candidate.primaryPropertyId === propertyId);

      expect(group).toBeDefined();
      expect(group?.groupKind).toBe('single');
      expect(group?.hasActiveListing).toBe(true);
      expect(group?.marketState).toBe('for-rent');
      expect(group?.askingPrice).toBe(2100);
      expect(group?.thumbnailUrl).toBe('https://cdn.example.com/active-rent.jpg');
      expect(group?.address).toBe('Tile Facts Street 7, 9998AA Factstad');

      const rentFilteredGroups = await buildCanonicalGroupsForTile(
        tile,
        normalizeMapFilters({ rentPriceFrom: 2000, rentPriceTo: 2200 })
      );
      expect(
        rentFilteredGroups.some((candidate) => candidate.primaryPropertyId === propertyId)
      ).toBe(true);

      const saleFilteredGroups = await buildCanonicalGroupsForTile(
        tile,
        normalizeMapFilters({ marketState: ['for-sale'], salePriceFrom: 900000 })
      );
      expect(
        saleFilteredGroups.some((candidate) => candidate.primaryPropertyId === propertyId)
      ).toBe(false);
    } finally {
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    }
  }, 30000);
});

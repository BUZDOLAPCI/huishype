import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { getDefaultPropertyTilePyramidSlot } from '../../services/property-tile-pyramid.js';
import type { FastifyInstance } from 'fastify';

type SavedCurrentPointer = {
  coverage_id: string;
  filter_signature: string;
  max_zoom: number;
  pyramid_kind: string;
  current_version_id: string;
  previous_version_id: string | null;
  current_promoted_at: string;
  promotion_reason: string | null;
  created_at: string;
  updated_at: string;
};

async function restoreCurrentPointerMetadata(input: {
  slot: ReturnType<typeof getDefaultPropertyTilePyramidSlot>;
  currentVersionId: string;
  previousVersionId: string | null;
  currentPromotedAt: string;
  promotionReason: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const txRows = await tx.execute<{ txid: string }>(sql`
      SELECT txid_current()::bigint::text AS txid
    `);
    const txid = Array.from(txRows)[0]?.txid;
    if (!txid) {
      throw new Error('Failed to acquire transaction id for current pointer metadata restore');
    }

    await tx.execute(sql`
      INSERT INTO property_tile_pyramid_promotion_intents (
        txid,
        version_id,
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        actor,
        reason
      )
      VALUES (
        ${txid}::bigint,
        ${input.currentVersionId}::uuid,
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.maxZoom},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        'health.integration.test',
        'restore health integration fixture current pointer metadata'
      )
      ON CONFLICT (txid, version_id) DO NOTHING
    `);

    await tx.execute(sql`
      INSERT INTO property_tile_pyramid_current (
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        current_version_id,
        previous_version_id,
        current_promoted_at,
        promotion_reason,
        updated_at
      )
      VALUES (
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.maxZoom},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        ${input.currentVersionId}::uuid,
        NULL,
        ${input.currentPromotedAt}::timestamptz,
        ${input.promotionReason},
        NOW()
      )
      ON CONFLICT (coverage_id, filter_signature, max_zoom, pyramid_kind)
      DO UPDATE SET
        current_version_id = EXCLUDED.current_version_id,
        previous_version_id = property_tile_pyramid_current.current_version_id,
        current_promoted_at = EXCLUDED.current_promoted_at,
        promotion_reason = EXCLUDED.promotion_reason,
        updated_at = NOW()
    `);

    await tx.execute(sql`
      UPDATE property_tile_pyramid_current
      SET
        previous_version_id = ${input.previousVersionId}::uuid,
        current_promoted_at = ${input.currentPromotedAt}::timestamptz,
        promotion_reason = ${input.promotionReason},
        updated_at = NOW()
      WHERE coverage_id = ${input.slot.coverageId}
        AND filter_signature = ${input.slot.filterSignature}
        AND max_zoom = ${input.slot.maxZoom}
        AND pyramid_kind = ${input.slot.pyramidKind}::property_tile_pyramid_kind
    `);
  });
}

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  );
  return { x, y };
}

describe('GET /health', () => {
  let app: FastifyInstance | undefined;
  let fixtureVersionId: string | undefined;
  let fixtureCandidateSnapshotId: string | undefined;
  let savedCurrentPointer: SavedCurrentPointer | undefined;

  beforeAll(async () => {
    await installPromotedPyramidFixture();
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await restorePromotedPyramidFixture();
    if (app) {
      await app.close();
    }
  });

  it('should pass API health with a promoted property tile pyramid', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid.status).toBe('ok');
    expect(body.propertyTilePyramid.currentVersionId).toEqual(expect.any(String));
    expect(body.propertyTilePyramid.degradedReason).toBeNull();
  });

  it('should keep canonical health status scoped to API availability', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid.currentVersionId).toEqual(expect.any(String));
    expect(body.propertyTilePyramid.degradedReason).toBeNull();
    expect(body.propertyTilePyramid.terminalFailureCount).toBe(0);
  });

  it('should ignore stale terminal failures older than the current promoted pyramid', async () => {
    const slot = getDefaultPropertyTilePyramidSlot();
    const terminalVersionId = randomUUID();
    const unique = randomUUID();

    try {
      await db.execute(sql`
        INSERT INTO property_tile_pyramid_versions (
          id,
          coverage_id,
          filter_signature,
          max_zoom,
          pyramid_kind,
          config_hash,
          build_inputs_hash,
          source_watermark_hash,
          status,
          terminal_reason,
          requested_at,
          updated_at
        )
        SELECT
          ${terminalVersionId}::uuid,
          ${slot.coverageId},
          ${slot.filterSignature},
          ${slot.maxZoom},
          ${slot.pyramidKind}::property_tile_pyramid_kind,
          ${`health-stale-terminal-config-${unique}`},
          ${`health-stale-terminal-inputs-${unique}`},
          ${`health-stale-terminal-watermarks-${unique}`},
          'failed_terminal',
          'historical candidate failed before current promotion',
          current_promoted_at - interval '1 hour',
          now()
        FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
      `);

      const response = await app!.inject({
        method: 'GET',
        url: '/health',
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.propertyTilePyramid.status).toBe('ok');
      expect(body.propertyTilePyramid.currentVersionId).toEqual(expect.any(String));
      expect(body.propertyTilePyramid.terminalFailureCount).toBe(0);
    } finally {
      await db.execute(sql`
        DELETE FROM property_tile_pyramid_versions
        WHERE id = ${terminalVersionId}::uuid
      `);
    }
  });

  it('should expose an explicit non-gating degraded mode', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health?allowDegraded=true',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(['ok', 'degraded']).toContain(body.status);
    if (body.status === 'degraded') {
      expect(body.propertyTilePyramid.status).toBe('degraded');
      expect(
        body.propertyTilePyramid.degradedReason ||
          body.propertyTilePyramid.activeCandidateVersionId ||
          body.propertyTilePyramid.retryableFailureDueAt ||
          body.propertyTilePyramid.terminalFailureCount > 0
      ).toBeTruthy();
    }
  });

  it('should keep /health alive but fail strict pyramid readiness when the promoted pyramid pointer is missing', async () => {
    const slot = getDefaultPropertyTilePyramidSlot();

    await db.execute(sql`
      DELETE FROM property_tile_pyramid_current
      WHERE coverage_id = ${slot.coverageId}
        AND filter_signature = ${slot.filterSignature}
        AND max_zoom = ${slot.maxZoom}
        AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
    `);

    try {
      const response = await app!.inject({
        method: 'GET',
        url: '/health',
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.propertyTilePyramid.status).toBe('degraded');
      expect(body.propertyTilePyramid.currentVersionId).toBeNull();
      expect(body.propertyTilePyramid.degradedReason).toBe('no-current-promoted-pyramid');
      expect(body.propertyTilePyramid.terminalFailureCount).toBeGreaterThanOrEqual(0);

      const strictResponse = await app!.inject({
        method: 'GET',
        url: '/health/property-tile-pyramid',
      });
      const strictBody = JSON.parse(strictResponse.body);

      expect(strictResponse.statusCode).toBe(503);
      expect(strictBody.status).toBe('degraded');
      expect(strictBody.propertyTilePyramid.status).toBe('degraded');
      expect(strictBody.propertyTilePyramid.degradedReason).toBe('no-current-promoted-pyramid');
    } finally {
      await restorePromotedPyramidFixture();
      fixtureVersionId = undefined;
      fixtureCandidateSnapshotId = undefined;
      await installPromotedPyramidFixture();
    }
  });

  it('should include expected response shape', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('propertyTilePyramid');
    expect(body.propertyTilePyramid).toHaveProperty('status');
    expect(body.propertyTilePyramid).toHaveProperty('currentVersionId');
    expect(body.propertyTilePyramid).toHaveProperty('degradedReason');

    expect(typeof body.status).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('should return a valid ISO timestamp', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('should return uptime as a positive number', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/health',
    });
    const body = JSON.parse(response.body);
    expect(body.uptime).toBeGreaterThan(0);
  });

  async function installPromotedPyramidFixture(): Promise<void> {
    const slot = getDefaultPropertyTilePyramidSlot();
    fixtureVersionId = randomUUID();
    fixtureCandidateSnapshotId = randomUUID();
    const unique = randomUUID();
    const sourceWatermarkHash = `health-watermarks-${unique}`;
    const fixtureCenter = { lon: 5.4697, lat: 51.4416 };
    const fixtureTile = lonLatToTile(fixtureCenter.lon, fixtureCenter.lat, slot.maxZoom);
    const coverageSnapshot = {
      bounds: {
        minLon: fixtureCenter.lon - 0.00001,
        minLat: fixtureCenter.lat - 0.00001,
        maxLon: fixtureCenter.lon + 0.00001,
        maxLat: fixtureCenter.lat + 0.00001,
      },
      minZoom: slot.maxZoom,
      maxZoom: slot.maxZoom,
    };

    const [currentPointer] = Array.from(
      await db.execute<SavedCurrentPointer>(sql`
        SELECT
          coverage_id,
          filter_signature,
          max_zoom,
          pyramid_kind::text AS pyramid_kind,
          current_version_id::text AS current_version_id,
          previous_version_id::text AS previous_version_id,
          current_promoted_at::text AS current_promoted_at,
          promotion_reason,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      `)
    );
    savedCurrentPointer = currentPointer;

    await db.execute(sql`
      INSERT INTO property_tile_candidate_source_snapshots (
        id,
        coverage_id,
        filter_signature,
        pyramid_kind,
        source_watermark_hash,
        comparable_source_watermark_hash,
        source_watermarks_json,
        status,
        candidate_row_count,
        fact_row_count,
        social_fact_row_count,
        grouping_fact_row_count,
        build_finished_at
      )
      VALUES (
        ${fixtureCandidateSnapshotId}::uuid,
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${sourceWatermarkHash},
        ${sourceWatermarkHash},
        ${JSON.stringify({ sources: [{ source: 'health.integration.test' }] })}::jsonb,
        'ready',
        0,
        0,
        0,
        0,
        now()
      )
    `);

    await db.execute(sql`
      INSERT INTO property_tile_pyramid_versions (
        id,
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        config_hash,
        build_inputs_hash,
        source_watermark_hash,
        source_watermarks_json,
        candidate_snapshot_id,
        coverage_snapshot_json,
        status,
        expected_tile_count,
        validated_tile_count,
        validation_summary,
        validated_at
      )
      VALUES (
        ${fixtureVersionId}::uuid,
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.maxZoom},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${`health-config-${unique}`},
        ${`health-inputs-${unique}`},
        ${sourceWatermarkHash},
        ${JSON.stringify({ sources: [{ source: 'health.integration.test' }] })}::jsonb,
        ${fixtureCandidateSnapshotId}::uuid,
        ${JSON.stringify(coverageSnapshot)}::jsonb,
        'validated',
        1,
        1,
        ${JSON.stringify({ expectedTileCount: 1, observedTileCount: 1 })}::jsonb,
        now()
      )
    `);

    await db.execute(sql`
      INSERT INTO property_tile_pyramid_tiles (
        version_id,
        z,
        x,
        y,
        tile_status,
        validation_status,
        node_count,
        etag,
        validated_at
      )
      VALUES (
        ${fixtureVersionId}::uuid,
        ${slot.maxZoom},
        ${fixtureTile.x},
        ${fixtureTile.y},
        'valid_empty',
        'validated',
        0,
        ${`health-${unique}`},
        now()
      )
    `);

    await db.execute(sql`
      SELECT promote_property_tile_pyramid_version(
        ${fixtureVersionId}::uuid,
        ${savedCurrentPointer?.current_version_id ?? null}::uuid,
        'health integration fixture',
        'health.integration.test'
      )
    `);
  }

  async function restorePromotedPyramidFixture(): Promise<void> {
    if (!fixtureVersionId) {
      return;
    }

    const slot = getDefaultPropertyTilePyramidSlot();

    if (savedCurrentPointer) {
      await restoreCurrentPointerMetadata({
        slot,
        currentVersionId: savedCurrentPointer.current_version_id,
        previousVersionId: savedCurrentPointer.previous_version_id,
        currentPromotedAt: savedCurrentPointer.current_promoted_at,
        promotionReason: savedCurrentPointer.promotion_reason,
      });
    } else {
      await db.execute(sql`
        DELETE FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND current_version_id = ${fixtureVersionId}::uuid
      `);
    }

    await db.execute(sql`
      DELETE FROM property_tile_pyramid_audit
      WHERE actor = 'health.integration.test'
        AND reason IN (
          'health integration fixture',
          'restore health integration fixture',
          'restore health integration fixture current pointer metadata'
        )
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_promotion_intents
      WHERE actor = 'health.integration.test'
        AND reason IN (
          'health integration fixture',
          'restore health integration fixture current pointer metadata'
        )
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_audit
      WHERE version_id = ${fixtureVersionId}::uuid
        AND actor = 'health.integration.test'
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_tiles
      WHERE version_id = ${fixtureVersionId}::uuid
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_versions
      WHERE id = ${fixtureVersionId}::uuid
    `);
    if (fixtureCandidateSnapshotId) {
      await db.execute(sql`
        DELETE FROM property_tile_candidate_source_snapshots
        WHERE id = ${fixtureCandidateSnapshotId}::uuid
      `);
    }
  }
});

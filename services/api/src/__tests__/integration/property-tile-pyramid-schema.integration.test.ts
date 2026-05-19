import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';

const coveragePrefix = `schema-promotion-${crypto.randomUUID()}`;

type TileStatus = 'pending' | 'valid_empty' | 'valid_nodes' | 'valid_encoded' | 'failed';
type ValidationStatus = 'pending' | 'validated' | 'failed';

async function cleanupPyramidSchemaTestRows(): Promise<void> {
  await db.execute(sql`
    DELETE FROM property_tile_pyramid_current
    WHERE coverage_id LIKE ${`${coveragePrefix}%`}
  `);
  await db.execute(sql`
    DELETE FROM property_tile_candidate_source_current
    WHERE coverage_id LIKE ${`${coveragePrefix}%`}
  `);
  await db.execute(sql`
    DELETE FROM property_tile_pyramid_versions
    WHERE coverage_id LIKE ${`${coveragePrefix}%`}
  `);
  await db.execute(sql`
    DELETE FROM property_tile_candidate_source_snapshots
    WHERE coverage_id LIKE ${`${coveragePrefix}%`}
  `);
}

async function insertPyramidVersion(input?: {
  coverageId?: string;
  expectedTileCount?: number;
  validatedTileCount?: number;
  configFilterSignature?: string;
}): Promise<string> {
  const versionId = crypto.randomUUID();
  const unique = crypto.randomUUID();
  const coverageId = input?.coverageId ?? `${coveragePrefix}-${unique}`;
  const expectedTileCount = input?.expectedTileCount ?? 2;
  const validatedTileCount = input?.validatedTileCount ?? expectedTileCount;
  const configHash = crypto.createHash('sha256').update(`config-${unique}`).digest('hex');
  const buildInputsHash = crypto.createHash('sha256').update(`inputs-${unique}`).digest('hex');
  const sourceWatermarkHash = crypto
    .createHash('sha256')
    .update(`watermarks-${unique}`)
    .digest('hex');
  const coverageConfigHash = crypto.createHash('sha256').update(`coverage-${unique}`).digest('hex');
  const coverageSnapshot = {
    coverageId,
    filterSignature: 'public-default',
    minZoom: 1,
    maxZoom: 1,
    bounds: {
      minLon: -180,
      minLat: 66,
      maxLon: expectedTileCount === 1 ? -1 : 0,
      maxLat: 85,
    },
  };
  const configSnapshot = {
    pipelineVersion: 'property-tile-pyramid:v1',
    servingSlot: {
      coverageId,
      filterSignature: input?.configFilterSignature ?? 'public-default',
      maxZoom: 1,
      pyramidKind: 'public_default_low_zoom',
    },
    defaultFilter: {
      signature: input?.configFilterSignature ?? 'public-default',
      filters: {
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
        activity: 'all',
      },
    },
    coverageConfigHash,
  };
  const groupingConstants = {
    pipelineVersion: 'property-tile-pyramid:v1',
    canonicalGrouping: {
      filterSignature: 'public-default',
    },
    mvtEncoding: {
      layerName: 'properties',
      extent: 4096,
    },
  };
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
      status,
      expected_tile_count,
      validated_tile_count,
      coverage_snapshot_json,
      config_snapshot_json,
      grouping_constants_json,
      validation_summary,
      validated_at
    )
    VALUES (
      ${versionId}::uuid,
      ${coverageId},
      'public-default',
      1,
      'public_default_low_zoom',
      ${configHash},
      ${buildInputsHash},
      ${sourceWatermarkHash},
      ${JSON.stringify({
        sources: [
          {
            source: 'schema-integration-test',
            watermarkValue: unique,
          },
        ],
      })}::jsonb,
      'validated',
      ${expectedTileCount},
      ${validatedTileCount},
      ${JSON.stringify(coverageSnapshot)}::jsonb,
      ${JSON.stringify(configSnapshot)}::jsonb,
      ${JSON.stringify(groupingConstants)}::jsonb,
      ${JSON.stringify({
        expectedTileCount,
        observedTileCount: validatedTileCount,
      })}::jsonb,
      now()
    )
  `);
  return versionId;
}

async function insertTileManifest(input: {
  versionId: string;
  x: number;
  tileStatus: TileStatus;
  validationStatus: ValidationStatus;
  nodeCount?: number;
}): Promise<void> {
  const payload = input.tileStatus === 'valid_encoded' ? Buffer.from('encoded tile') : null;
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
      payload,
      payload_sha256,
      payload_generated_at,
      validated_at,
      last_error
    )
    VALUES (
      ${input.versionId}::uuid,
      1,
      ${input.x},
      0,
      ${input.tileStatus}::property_tile_pyramid_tile_status,
      ${input.validationStatus}::property_tile_pyramid_tile_validation_status,
      ${input.nodeCount ?? (input.tileStatus === 'valid_empty' ? 0 : 1)},
      ${input.tileStatus === 'pending' || input.tileStatus === 'failed' ? null : `etag-${input.x}`},
      ${payload},
      ${payload ? crypto.createHash('sha256').update(payload).digest('hex') : null},
      ${payload ? sql`now()` : null},
      ${input.validationStatus === 'validated' ? sql`now()` : null},
      ${input.validationStatus === 'failed' ? 'failed validation' : null}
    )
  `);
}

async function insertPyramidNode(input: {
  versionId: string;
  x: number;
  representativePropertyId?: string;
}): Promise<void> {
  const propertyId = input.representativePropertyId ?? crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO property_tile_pyramid_nodes (
      version_id,
      node_id,
      z,
      x,
      y,
      render_lon,
      render_lat,
      render_geometry,
      anchor_world_x,
      anchor_world_y,
      node_class,
      group_kind,
      point_count,
      representative_property_id,
      preview_property_ids,
      preview_count,
      active_listing_count,
      completed_listing_count,
      social_count,
      recent_social_count,
      social_score_total,
      social_score_max,
      recent_social_score_total,
      comment_count,
      tap_radius_px,
      tap_priority_score
    )
    VALUES (
      ${input.versionId}::uuid,
      ${`node-${input.x}`},
      1,
      ${input.x},
      0,
      -1,
      70,
      ST_SetSRID(ST_MakePoint(-1, 70), 4326),
      0,
      0,
      'active',
      'single',
      1,
      ${propertyId}::uuid,
      ARRAY[${propertyId}::uuid],
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      24,
      1
    )
  `);
}

async function promote(
  versionId: string,
  expectedPreviousVersionId: string | null = null
): Promise<void> {
  await db.execute(sql`
    SELECT promote_property_tile_pyramid_version(
      ${versionId}::uuid,
      ${expectedPreviousVersionId}::uuid,
      'schema integration test',
      'jest'
    )
  `);
}

async function expectDbFailure(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action();
  } catch (error) {
    const cause = (error as { cause?: { message?: string; detail?: string } }).cause;
    expect(
      [error instanceof Error ? error.message : String(error), cause?.message, cause?.detail]
        .filter(Boolean)
        .join('\n')
    ).toMatch(pattern);
    return;
  }

  throw new Error('Expected database operation to fail');
}

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function insertCandidateSourceSnapshot(input: {
  coverageId: string;
  filterSignature?: string;
  status?: 'building' | 'ready' | 'failed' | 'superseded';
}): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const unique = crypto.randomUUID();
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
      ${snapshotId}::uuid,
      ${input.coverageId},
      ${input.filterSignature ?? 'public-default'},
      'public_default_low_zoom',
      ${sha(`candidate-source-${unique}`)},
      ${sha(`candidate-comparable-${unique}`)},
      ${JSON.stringify({ sources: [{ source: 'schema-candidate-source', unique }] })}::jsonb,
      ${input.status ?? 'ready'},
      0,
      0,
      0,
      0,
      ${input.status === undefined || input.status === 'ready' ? sql`now()` : null}
    )
  `);
  return snapshotId;
}

async function insertDefaultSlotVersionWithCandidate(input: {
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
  candidateSourceWatermarkHash: string;
  candidateComparableSourceWatermarkHash: string;
}): Promise<{ versionId: string; candidateSnapshotId: string }> {
  const versionId = crypto.randomUUID();
  const candidateSnapshotId = crypto.randomUUID();
  const unique = crypto.randomUUID();

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
      ${candidateSnapshotId}::uuid,
      'public_default_low_zoom',
      'default',
      'public_default_low_zoom',
      ${input.candidateSourceWatermarkHash},
      ${input.candidateComparableSourceWatermarkHash},
      ${JSON.stringify({
        sources: [{ source: 'schema-candidate-source', unique }],
        comparableSourceWatermarkHash: input.candidateComparableSourceWatermarkHash,
      })}::jsonb,
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
      config_snapshot_json,
      grouping_constants_json,
      status,
      expected_tile_count,
      validated_tile_count,
      validation_summary,
      validated_at
    )
    VALUES (
      ${versionId}::uuid,
      'public_default_low_zoom',
      'default',
      0,
      'public_default_low_zoom',
      ${sha(`config-${unique}`)},
      ${sha(`inputs-${unique}`)},
      ${input.sourceWatermarkHash},
      ${JSON.stringify(input.sourceWatermarksJson)}::jsonb,
      ${candidateSnapshotId}::uuid,
      ${JSON.stringify({
        bounds: { minLon: -180, minLat: -85, maxLon: 180, maxLat: 85 },
        maxZoom: 0,
      })}::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
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
      ${versionId}::uuid,
      0,
      0,
      0,
      'valid_empty',
      'validated',
      0,
      ${`schema-default-${unique}`},
      now()
    )
  `);

  return { versionId, candidateSnapshotId };
}

describe('property tile pyramid schema safeguards', () => {
  afterEach(async () => {
    await cleanupPyramidSchemaTestRows();
  });

  it('exposes the expected catalog constraints, indexes, functions, and triggers', async () => {
    const constraints = Array.from(
      await db.execute<{ conname: string }>(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid IN (
        'property_tile_pyramid_versions'::regclass,
        'property_tile_pyramid_current'::regclass,
        'property_tile_pyramid_tiles'::regclass,
        'property_tile_pyramid_nodes'::regclass,
        'property_tile_candidate_source_snapshots'::regclass,
        'property_tile_candidate_source_current'::regclass,
        'property_tile_listing_candidates'::regclass,
        'property_tile_listing_facts'::regclass,
        'property_tile_social_facts'::regclass,
        'property_tile_grouping_facts'::regclass
      )
    `)
    ).map((row) => row.conname);
    expect(constraints).toEqual(
      expect.arrayContaining([
        'property_tile_pyramid_versions_zoom_check',
        'property_tile_pyramid_current_pk',
        'property_tile_pyramid_current_version_fk',
        'property_tile_pyramid_tiles_pk',
        'property_tile_pyramid_tiles_validation_check',
        'property_tile_pyramid_nodes_pk',
        'property_tile_pyramid_nodes_tile_fk',
        'property_tile_candidate_source_snapshots_status_check',
        'property_tile_candidate_source_snapshots_counts_check',
        'property_tile_candidate_source_current_pk',
        'property_tile_listing_candidates_pkey',
        'property_tile_listing_facts_pkey',
        'property_tile_social_facts_pkey',
        'property_tile_grouping_facts_pkey',
        'property_tile_grouping_facts_market_state_check',
      ])
    );

    const indexes = Array.from(
      await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN (
        'property_tile_pyramid_versions',
        'property_tile_pyramid_current',
        'property_tile_pyramid_tiles',
        'property_tile_pyramid_nodes',
        'property_tile_candidate_source_snapshots',
        'property_tile_listing_candidates',
        'property_tile_listing_facts',
        'property_tile_social_facts',
        'property_tile_grouping_facts'
      )
    `)
    ).map((row) => row.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'property_tile_pyramid_versions_build_identity_idx',
        'property_tile_pyramid_versions_active_slot_idx',
        'property_tile_pyramid_versions_slot_status_idx',
        'property_tile_pyramid_current_version_idx',
        'property_tile_pyramid_tiles_status_idx',
        'property_tile_pyramid_tiles_promotion_invalid_idx',
        'property_tile_pyramid_nodes_tile_idx',
        'property_tile_pyramid_nodes_render_geometry_idx',
        'property_tile_pyramid_versions_candidate_snapshot_idx',
        'property_tile_candidate_source_snapshots_ready_idx',
        'property_tile_candidate_source_snapshots_status_idx',
        'property_tile_listing_candidates_snapshot_id_idx',
        'property_tile_listing_candidates_snapshot_geometry_gist_idx',
        'property_tile_listing_facts_snapshot_market_state_idx',
        'property_tile_social_facts_snapshot_id_idx',
        'property_tile_social_facts_geometry_gist_idx',
        'property_tile_social_facts_snapshot_last_social_at_idx',
        'property_tile_grouping_facts_snapshot_id_idx',
        'property_tile_grouping_facts_snapshot_geometry_gist_idx',
        'property_tile_grouping_facts_snapshot_market_state_idx',
        'property_tile_grouping_facts_snapshot_last_social_at_idx',
        'property_tile_grouping_facts_visible_snapshot_geometry_gist_idx',
      ])
    );

    const snapshotColumns = Array.from(
      await db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'property_tile_candidate_source_snapshots'
    `)
    ).map((row) => row.column_name);
    expect(snapshotColumns).toContain('social_fact_row_count');
    expect(snapshotColumns).toContain('grouping_fact_row_count');

    const extensions = Array.from(
      await db.execute<{ extname: string }>(sql`
      SELECT extname
      FROM pg_extension
      WHERE extname = 'btree_gist'
    `)
    ).map((row) => row.extname);
    expect(extensions).toContain('btree_gist');

    const functions = Array.from(
      await db.execute<{ proname: string }>(sql`
      SELECT proname
      FROM pg_proc
      WHERE proname IN (
        'property_tile_pyramid_assert_promotable',
        'promote_property_tile_pyramid_version',
        'property_tile_pyramid_versions_guard',
        'property_tile_pyramid_current_guard',
        'property_tile_pyramid_current_promoted_constraint',
        'property_tile_candidate_source_current_guard',
        'property_tile_candidate_source_snapshots_current_guard'
      )
    `)
    ).map((row) => row.proname);
    expect(functions).toEqual(
      expect.arrayContaining([
        'property_tile_pyramid_assert_promotable',
        'promote_property_tile_pyramid_version',
        'property_tile_pyramid_versions_guard',
        'property_tile_pyramid_current_guard',
        'property_tile_pyramid_current_promoted_constraint',
        'property_tile_candidate_source_current_guard',
        'property_tile_candidate_source_snapshots_current_guard',
      ])
    );

    const triggers = Array.from(
      await db.execute<{ tgname: string }>(sql`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid IN (
        'property_tile_pyramid_versions'::regclass,
        'property_tile_pyramid_current'::regclass,
        'property_tile_pyramid_source_watermarks'::regclass,
        'property_tile_candidate_source_current'::regclass,
        'property_tile_candidate_source_snapshots'::regclass
      )
        AND NOT tgisinternal
    `)
    ).map((row) => row.tgname);
    expect(triggers).toEqual(
      expect.arrayContaining([
        'property_tile_pyramid_versions_guard',
        'property_tile_pyramid_current_guard',
        'property_tile_pyramid_current_promoted_constraint',
        'property_tile_pyramid_source_watermarks_guard',
        'property_tile_candidate_source_current_guard',
        'property_tile_candidate_source_snapshots_current_guard',
      ])
    );
  });

  it('rejects promotion when expected manifest coverage is missing', async () => {
    const versionId = await insertPyramidVersion({ expectedTileCount: 2, validatedTileCount: 2 });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });

    await expectDbFailure(
      () => promote(versionId),
      /manifest coverage 1 does not match expected tile count 2/
    );
  });

  it('rejects direct current pointers to unpromoted versions', async () => {
    const coverageId = `${coveragePrefix}-direct-current-unpromoted`;
    const versionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });

    await expectDbFailure(
      () =>
        db.execute(sql`
        INSERT INTO property_tile_pyramid_current (
          coverage_id,
          filter_signature,
          max_zoom,
          pyramid_kind,
          current_version_id,
          current_promoted_at
        )
        VALUES (
          ${coverageId},
          'public-default',
          1,
          'public_default_low_zoom',
          ${versionId}::uuid,
          now()
        )
      `),
      /current pyramid version .* must be promoted, got validated/
    );
  });

  it('rejects direct current pointers whose version belongs to another serving slot', async () => {
    const versionId = await insertPyramidVersion({
      coverageId: `${coveragePrefix}-slot-a`,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });

    await expectDbFailure(
      () =>
        db.execute(sql`
        INSERT INTO property_tile_pyramid_current (
          coverage_id,
          filter_signature,
          max_zoom,
          pyramid_kind,
          current_version_id,
          current_promoted_at
        )
        VALUES (
          ${`${coveragePrefix}-slot-b`},
          'public-default',
          1,
          'public_default_low_zoom',
          ${versionId}::uuid,
          now()
        )
      `),
      /current pyramid version .* does not match serving slot/
    );
  });

  it('rejects promotion when a manifest row is not validated and promotable', async () => {
    const versionId = await insertPyramidVersion({ expectedTileCount: 2, validatedTileCount: 2 });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await insertTileManifest({
      versionId,
      x: 1,
      tileStatus: 'pending',
      validationStatus: 'pending',
      nodeCount: 0,
    });

    await expectDbFailure(() => promote(versionId), /unvalidated or invalid tile manifest rows/);
  });

  it('rejects promotion when identity snapshots disagree with the serving slot', async () => {
    const versionId = await insertPyramidVersion({
      expectedTileCount: 1,
      validatedTileCount: 1,
      configFilterSignature: 'corrupt-filter',
    });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });

    await expectDbFailure(() => promote(versionId), /config snapshot does not match serving slot/);
  });

  it('rejects pyramid nodes that are not attached to a tile manifest row', async () => {
    const versionId = await insertPyramidVersion({ expectedTileCount: 1, validatedTileCount: 1 });

    await expectDbFailure(
      () => insertPyramidNode({ versionId, x: 0 }),
      /property_tile_pyramid_nodes_tile_fk|violates foreign key constraint/
    );
  });

  it('promotes complete validated manifest coverage and preserves the stable serving slot', async () => {
    const coverageId = `${coveragePrefix}-complete`;
    const versionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 2,
      validatedTileCount: 2,
    });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await insertTileManifest({
      versionId,
      x: 1,
      tileStatus: 'valid_encoded',
      validationStatus: 'validated',
      nodeCount: 1,
    });
    await insertPyramidNode({ versionId, x: 1 });

    await promote(versionId);

    const rows = Array.from(
      await db.execute<{
        status: string;
        current_version_id: string;
        config_hash_in_pointer: string | null;
      }>(sql`
      SELECT
        v.status::text,
        c.current_version_id::text,
        cols.column_name AS config_hash_in_pointer
      FROM property_tile_pyramid_versions v
      JOIN property_tile_pyramid_current c
        ON c.current_version_id = v.id
      LEFT JOIN information_schema.columns cols
        ON cols.table_name = 'property_tile_pyramid_current'
       AND cols.column_name = 'config_hash'
      WHERE v.id = ${versionId}::uuid
    `)
    );

    expect(rows[0]).toEqual({
      status: 'promoted',
      current_version_id: versionId,
      config_hash_in_pointer: null,
    });
  });

  it('keeps compare-and-swap promotion failures from advancing the target version', async () => {
    const coverageId = `${coveragePrefix}-cas`;
    const firstVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: firstVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(firstVersionId);

    const secondVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: secondVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });

    await expectDbFailure(
      () => promote(secondVersionId, crypto.randomUUID()),
      /compare-and-swap failed/
    );

    const rows = Array.from(
      await db.execute<{ status: string; current_version_id: string }>(sql`
      SELECT v.status::text, c.current_version_id::text
      FROM property_tile_pyramid_versions v
      CROSS JOIN property_tile_pyramid_current c
      WHERE v.id = ${secondVersionId}::uuid
        AND c.coverage_id = ${coverageId}
        AND c.filter_signature = 'public-default'
        AND c.max_zoom = 1
        AND c.pyramid_kind = 'public_default_low_zoom'
    `)
    );

    expect(rows[0]).toEqual({
      status: 'validated',
      current_version_id: firstVersionId,
    });
  });

  it('marks promoted versions that are no longer current or previous as superseded', async () => {
    const coverageId = `${coveragePrefix}-promoted-lifecycle`;
    const firstVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: firstVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(firstVersionId);

    const secondVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: secondVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(secondVersionId, firstVersionId);

    const thirdVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: thirdVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(thirdVersionId, secondVersionId);

    const rows = Array.from(
      await db.execute<{
        id: string;
        status: string;
        is_current: boolean;
        is_previous: boolean;
        superseded: boolean;
        superseded_reason: string | null;
      }>(sql`
        SELECT
          v.id::text,
          v.status::text,
          c.current_version_id = v.id AS is_current,
          c.previous_version_id = v.id AS is_previous,
          v.superseded_at IS NOT NULL AS superseded,
          v.validation_summary#>>'{superseded,reason}' AS superseded_reason
        FROM property_tile_pyramid_versions v
        JOIN property_tile_pyramid_current c
          ON c.coverage_id = v.coverage_id
         AND c.filter_signature = v.filter_signature
         AND c.max_zoom = v.max_zoom
         AND c.pyramid_kind = v.pyramid_kind
        WHERE v.id IN (${firstVersionId}::uuid, ${secondVersionId}::uuid, ${thirdVersionId}::uuid)
        ORDER BY array_position(
          ARRAY[${firstVersionId}::uuid, ${secondVersionId}::uuid, ${thirdVersionId}::uuid],
          v.id
        )
      `)
    );

    expect(rows).toEqual([
      {
        id: firstVersionId,
        status: 'promoted',
        is_current: false,
        is_previous: false,
        superseded: true,
        superseded_reason: 'promoted-version-no-longer-current-or-previous',
      },
      {
        id: secondVersionId,
        status: 'promoted',
        is_current: false,
        is_previous: true,
        superseded: false,
        superseded_reason: null,
      },
      {
        id: thirdVersionId,
        status: 'promoted',
        is_current: true,
        is_previous: false,
        superseded: false,
        superseded_reason: null,
      },
    ]);
  });

  it('blocks direct current pointer moves to an already-promoted version', async () => {
    const coverageId = `${coveragePrefix}-direct-current-promoted`;
    const firstVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: firstVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(firstVersionId);

    const secondVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: secondVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(secondVersionId, firstVersionId);

    await expectDbFailure(
      () =>
        db.execute(sql`
        UPDATE property_tile_pyramid_current
        SET
          current_version_id = ${firstVersionId}::uuid,
          previous_version_id = ${secondVersionId}::uuid,
          current_promoted_at = now(),
          promotion_reason = 'direct bypass'
        WHERE coverage_id = ${coverageId}
          AND filter_signature = 'public-default'
          AND max_zoom = 1
          AND pyramid_kind = 'public_default_low_zoom'
      `),
      /current pyramid pointer changes must use promote_property_tile_pyramid_version/
    );
  });

  it('blocks direct current pointer metadata rewrites', async () => {
    const coverageId = `${coveragePrefix}-direct-current-metadata`;
    const firstVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: firstVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(firstVersionId);

    const secondVersionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId: secondVersionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });
    await promote(secondVersionId, firstVersionId);

    await expectDbFailure(
      () =>
        db.execute(sql`
        UPDATE property_tile_pyramid_current
        SET promotion_reason = 'direct metadata bypass'
        WHERE coverage_id = ${coverageId}
          AND filter_signature = 'public-default'
          AND max_zoom = 1
          AND pyramid_kind = 'public_default_low_zoom'
      `),
      /current pyramid pointer changes must use promote_property_tile_pyramid_version/
    );
  });

  it('rejects candidate source current rows whose snapshot is non-ready or from another slot', async () => {
    const coverageId = `${coveragePrefix}-candidate-current`;
    const otherCoverageId = `${coveragePrefix}-candidate-current-other`;
    const readyOtherSlotSnapshotId = await insertCandidateSourceSnapshot({
      coverageId: otherCoverageId,
    });
    const buildingSnapshotId = await insertCandidateSourceSnapshot({
      coverageId,
      status: 'building',
    });

    await expectDbFailure(
      () =>
        db.execute(sql`
        INSERT INTO property_tile_candidate_source_current (
          coverage_id,
          filter_signature,
          pyramid_kind,
          snapshot_id
        )
        VALUES (
          ${coverageId},
          'public-default',
          'public_default_low_zoom',
          ${readyOtherSlotSnapshotId}::uuid
        )
      `),
      /candidate source current snapshot .* must be ready and match serving slot/
    );

    await expectDbFailure(
      () =>
        db.execute(sql`
        INSERT INTO property_tile_candidate_source_current (
          coverage_id,
          filter_signature,
          pyramid_kind,
          snapshot_id
        )
        VALUES (
          ${coverageId},
          'public-default',
          'public_default_low_zoom',
          ${buildingSnapshotId}::uuid
        )
      `),
      /candidate source current snapshot .* must be ready and match serving slot/
    );
  });

  it('rejects updates that make the current candidate source snapshot non-ready', async () => {
    const coverageId = `${coveragePrefix}-candidate-current-status`;
    const snapshotId = await insertCandidateSourceSnapshot({ coverageId });

    await db.execute(sql`
      INSERT INTO property_tile_candidate_source_current (
        coverage_id,
        filter_signature,
        pyramid_kind,
        snapshot_id
      )
      VALUES (
        ${coverageId},
        'public-default',
        'public_default_low_zoom',
        ${snapshotId}::uuid
      )
    `);

    await expectDbFailure(
      () =>
        db.execute(sql`
        UPDATE property_tile_candidate_source_snapshots
        SET status = 'superseded'
        WHERE id = ${snapshotId}::uuid
      `),
      /candidate source snapshot .* is current and must remain ready/
    );
  });

  it('requires candidate source snapshots for registered configurable serving slots', async () => {
    const coverageId = `${coveragePrefix}-configurable-source`;
    const snapshotId = await insertCandidateSourceSnapshot({ coverageId });
    await db.execute(sql`
      INSERT INTO property_tile_candidate_source_current (
        coverage_id,
        filter_signature,
        pyramid_kind,
        snapshot_id
      )
      VALUES (
        ${coverageId},
        'public-default',
        'public_default_low_zoom',
        ${snapshotId}::uuid
      )
    `);

    const versionId = await insertPyramidVersion({
      coverageId,
      expectedTileCount: 1,
      validatedTileCount: 1,
    });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });

    await expectDbFailure(
      () => promote(versionId),
      /property tile pyramid version .* has no candidate source snapshot/
    );
  });

  it('blocks direct validated-to-promoted updates that bypass the promotion function', async () => {
    const versionId = await insertPyramidVersion({ expectedTileCount: 1, validatedTileCount: 1 });
    await insertTileManifest({
      versionId,
      x: 0,
      tileStatus: 'valid_empty',
      validationStatus: 'validated',
      nodeCount: 0,
    });

    await expectDbFailure(
      () =>
        db.execute(sql`
        UPDATE property_tile_pyramid_versions
        SET status = 'promoted'
        WHERE id = ${versionId}::uuid
      `),
      /direct promoted property tile pyramid version updates are not allowed/
    );
  });

  it('blocks direct inserted promoted rows that bypass the promotion function', async () => {
    const versionId = crypto.randomUUID();
    const unique = crypto.randomUUID();

    await expectDbFailure(
      () =>
        db.execute(sql`
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
          expected_tile_count,
          validated_tile_count,
          promoted_at
        )
        VALUES (
          ${versionId}::uuid,
          ${`${coveragePrefix}-direct-insert-${unique}`},
          'public-default',
          1,
          'public_default_low_zoom',
          ${`config-${unique}`},
          ${`inputs-${unique}`},
          ${`watermarks-${unique}`},
          'promoted',
          0,
          0,
          now()
        )
      `),
      /direct inserted promoted property tile pyramid versions are not allowed/
    );
  });

  it('matches candidate source snapshots against comparable source watermark hashes', async () => {
    const comparableHash = sha('candidate-comparable-source');
    const { versionId, candidateSnapshotId } = await insertDefaultSlotVersionWithCandidate({
      sourceWatermarkHash: sha('version-source-with-projection-fingerprints'),
      sourceWatermarksJson: {
        sources: [{ source: 'schema-version-source' }],
        comparableSourceWatermarkHash: comparableHash,
      },
      candidateSourceWatermarkHash: sha('candidate-source-before-projection-fingerprints'),
      candidateComparableSourceWatermarkHash: comparableHash,
    });

    try {
      await db.execute(sql`SELECT property_tile_pyramid_assert_promotable(${versionId}::uuid)`);
    } finally {
      await db.execute(sql`DELETE FROM property_tile_pyramid_versions WHERE id = ${versionId}::uuid`);
      await db.execute(sql`
        DELETE FROM property_tile_candidate_source_snapshots
        WHERE id = ${candidateSnapshotId}::uuid
      `);
    }
  });

  it('uses repair base comparable hashes when validating attached candidate snapshots', async () => {
    const comparableHash = sha('repair-candidate-comparable-source');
    const { versionId, candidateSnapshotId } = await insertDefaultSlotVersionWithCandidate({
      sourceWatermarkHash: sha('repair-version-source'),
      sourceWatermarksJson: {
        propertyTilePyramidRepair: {
          baseComparableSourceWatermarkHash: comparableHash,
          baseSourceWatermarkHash: sha('repair-base-source-with-projection-fingerprints'),
          reason: 'missing-tile-repair',
        },
      },
      candidateSourceWatermarkHash: sha('repair-candidate-source'),
      candidateComparableSourceWatermarkHash: comparableHash,
    });

    try {
      await db.execute(sql`SELECT property_tile_pyramid_assert_promotable(${versionId}::uuid)`);
    } finally {
      await db.execute(sql`DELETE FROM property_tile_pyramid_versions WHERE id = ${versionId}::uuid`);
      await db.execute(sql`
        DELETE FROM property_tile_candidate_source_snapshots
        WHERE id = ${candidateSnapshotId}::uuid
      `);
    }
  });
});

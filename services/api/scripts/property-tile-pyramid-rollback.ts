import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { closeConnection, db } from '../src/db/index.js';

type CliOptions = {
  coverageId: string | null;
  filterSignature: string | null;
  maxZoom: number | null;
  pyramidKind: string | null;
  toVersionId: string | null;
  execute: boolean;
  actor: string;
  reason: string;
};

type CurrentPointerRow = {
  coverage_id: string;
  filter_signature: string;
  max_zoom: number;
  pyramid_kind: string;
  current_version_id: string;
  previous_version_id: string | null;
  current_promoted_at: string;
};

type VersionRow = {
  id: string;
  coverage_id: string;
  filter_signature: string;
  max_zoom: number;
  pyramid_kind: string;
  status: string;
  config_hash: string;
  source_watermark_hash: string;
  source_watermarks_json: string;
};

const PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID = 'playwright_property_tile_pyramid_fixture';

function isDirectRun(): boolean {
  return process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @huishype/api pyramid:rollback -- [options]
  pnpm --filter @huishype/api pyramid:rollback -- --coverage-id public_default_low_zoom --filter-signature default --max-zoom 10 --execute

Options:
  --coverage-id <id>          Serving slot coverage id. Optional when only one current pointer exists.
  --filter-signature <value>  Serving slot filter signature. Optional when only one current pointer exists.
  --max-zoom <zoom>           Serving slot max zoom. Optional when only one current pointer exists.
  --pyramid-kind <kind>       Serving slot kind. Optional when only one current pointer exists.
  --to-version <uuid>         Promoted version to roll back to. Defaults to current previous_version_id.
  --actor <name>              Audit actor. Defaults to property-tile-pyramid-rollback-cli.
  --reason <text>             Audit reason.
  --execute                   Apply the rollback. Without this flag the command is a dry run.
  --help                      Show this help.

The command updates property_tile_pyramid_current only after verifying that the
target version is already promoted and belongs to the same serving slot. If the
default previous_version_id points at a Playwright fixture version, pass an
explicit --to-version for the intended real rollback target.`);
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    coverageId: null,
    filterSignature: null,
    maxZoom: null,
    pyramidKind: null,
    toVersionId: null,
    execute: false,
    actor: 'property-tile-pyramid-rollback-cli',
    reason: 'operator rollback',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--coverage-id') {
      options.coverageId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--filter-signature') {
      options.filterSignature = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--max-zoom') {
      options.maxZoom = parsePositiveInteger(argv[index + 1], '--max-zoom');
      index += 1;
      continue;
    }

    if (arg === '--pyramid-kind') {
      options.pyramidKind = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--to-version') {
      options.toVersionId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--actor') {
      options.actor = argv[index + 1] ?? options.actor;
      index += 1;
      continue;
    }

    if (arg === '--reason') {
      options.reason = argv[index + 1] ?? options.reason;
      index += 1;
      continue;
    }

    if (arg === '--execute') {
      options.execute = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function findCurrentPointer(options: CliOptions): Promise<CurrentPointerRow> {
  const rows = Array.from(
    await db.execute<CurrentPointerRow>(sql`
    SELECT
      coverage_id,
      filter_signature,
      max_zoom,
      pyramid_kind::text AS pyramid_kind,
      current_version_id::text AS current_version_id,
      previous_version_id::text AS previous_version_id,
      current_promoted_at::text AS current_promoted_at
    FROM property_tile_pyramid_current
    WHERE (${options.coverageId}::text IS NULL OR coverage_id = ${options.coverageId})
      AND (${options.filterSignature}::text IS NULL OR filter_signature = ${options.filterSignature})
      AND (${options.maxZoom}::integer IS NULL OR max_zoom = ${options.maxZoom})
      AND (${options.pyramidKind}::text IS NULL OR pyramid_kind::text = ${options.pyramidKind})
    ORDER BY updated_at DESC
  `)
  );

  if (rows.length === 0) {
    throw new Error('No property tile pyramid current pointer matched the requested slot');
  }
  if (rows.length > 1) {
    const slots = rows.map(
      (row) => `${row.coverage_id}/${row.filter_signature}/${row.max_zoom}/${row.pyramid_kind}`
    );
    throw new Error(
      `Multiple current pointers matched; pass slot flags. Matches: ${slots.join(', ')}`
    );
  }

  return rows[0];
}

export async function validateRollbackTargetVersion(
  targetVersionId: string,
  executor: Pick<typeof db, 'execute'> = db,
): Promise<void> {
  await executor.execute(sql`
    SELECT property_tile_pyramid_assert_promotable(${targetVersionId}::uuid)
  `);
}

function sourceWatermarksContainPlaywrightRuntime(sourceWatermarksJson: string): boolean {
  try {
    return JSON.stringify(JSON.parse(sourceWatermarksJson)).includes('playwright-runtime');
  } catch {
    return sourceWatermarksJson.includes('playwright-runtime');
  }
}

export function isPlaywrightFixtureVersion(
  version: Pick<
    VersionRow,
    'coverage_id' | 'config_hash' | 'source_watermark_hash' | 'source_watermarks_json'
  >
): boolean {
  return (
    version.coverage_id === PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID ||
    version.config_hash.startsWith('playwright-config-') ||
    version.source_watermark_hash.startsWith('playwright-watermarks-') ||
    sourceWatermarksContainPlaywrightRuntime(version.source_watermarks_json)
  );
}

async function findTargetVersion(
  pointer: CurrentPointerRow,
  targetVersionId: string
): Promise<VersionRow> {
  const rows = Array.from(
    await db.execute<VersionRow>(sql`
    SELECT
      id::text AS id,
      coverage_id,
      filter_signature,
      max_zoom,
      pyramid_kind::text AS pyramid_kind,
      status::text AS status,
      config_hash,
      source_watermark_hash,
      source_watermarks_json::text AS source_watermarks_json
    FROM property_tile_pyramid_versions
    WHERE id = ${targetVersionId}::uuid
      AND coverage_id = ${pointer.coverage_id}
      AND filter_signature = ${pointer.filter_signature}
      AND max_zoom = ${pointer.max_zoom}
      AND pyramid_kind = ${pointer.pyramid_kind}::property_tile_pyramid_kind
    LIMIT 1
  `)
  );

  const target = rows[0];
  if (!target) {
    throw new Error(`Target version ${targetVersionId} was not found in the current serving slot`);
  }
  if (target.status !== 'promoted') {
    throw new Error(`Target version ${targetVersionId} must be promoted, got ${target.status}`);
  }

  await validateRollbackTargetVersion(targetVersionId);

  return target;
}

async function applyRollback(
  pointer: CurrentPointerRow,
  target: VersionRow,
  options: CliOptions
): Promise<void> {
  await db.transaction(async (tx) => {
    const lockedRows = Array.from(
      await tx.execute<CurrentPointerRow>(sql`
      SELECT
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind::text AS pyramid_kind,
        current_version_id::text AS current_version_id,
        previous_version_id::text AS previous_version_id,
        current_promoted_at::text AS current_promoted_at
      FROM property_tile_pyramid_current
      WHERE coverage_id = ${pointer.coverage_id}
        AND filter_signature = ${pointer.filter_signature}
        AND max_zoom = ${pointer.max_zoom}
        AND pyramid_kind = ${pointer.pyramid_kind}::property_tile_pyramid_kind
      FOR UPDATE
    `)
    );
    const locked = lockedRows[0];
    if (!locked || locked.current_version_id !== pointer.current_version_id) {
      throw new Error('Current pointer changed before rollback could be applied');
    }

    await validateRollbackTargetVersion(target.id, tx);

    await tx.execute(sql`
      SELECT promote_property_tile_pyramid_version(
        ${target.id}::uuid,
        ${pointer.current_version_id}::uuid,
        ${options.reason},
        ${options.actor}
      )
    `);
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pointer = await findCurrentPointer(options);
  const targetSelectedFromPreviousPointer = options.toVersionId == null;
  const targetVersionId = options.toVersionId ?? pointer.previous_version_id;

  if (!targetVersionId) {
    throw new Error('Current pointer has no previous_version_id; pass --to-version explicitly');
  }

  const target = await findTargetVersion(pointer, targetVersionId);
  const targetIsPlaywrightFixture = isPlaywrightFixtureVersion(target);

  if (targetSelectedFromPreviousPointer && targetIsPlaywrightFixture) {
    if (!options.execute) {
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            blocked: true,
            blockReason: 'default previous_version_id is a Playwright fixture version',
            slot: {
              coverageId: pointer.coverage_id,
              filterSignature: pointer.filter_signature,
              maxZoom: pointer.max_zoom,
              pyramidKind: pointer.pyramid_kind,
            },
            fromVersionId: pointer.current_version_id,
            defaultPreviousVersionId: target.id,
            targetIsPlaywrightFixture,
          },
          null,
          2
        )
      );
    }

    throw new Error(
      `Refusing default rollback to Playwright fixture version ${target.id}; pass --to-version with the intended real promoted target.`
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: options.execute ? 'execute' : 'dry-run',
        slot: {
          coverageId: pointer.coverage_id,
          filterSignature: pointer.filter_signature,
          maxZoom: pointer.max_zoom,
          pyramidKind: pointer.pyramid_kind,
        },
        fromVersionId: pointer.current_version_id,
        toVersionId: target.id,
        targetIsPlaywrightFixture,
        targetSelection: targetSelectedFromPreviousPointer ? 'previous_version_id' : 'explicit',
        reason: options.reason,
        actor: options.actor,
      },
      null,
      2
    )
  );

  if (!options.execute) {
    console.log('Dry run only. Pass --execute to apply this rollback.');
    return;
  }

  await applyRollback(pointer, target, options);
  console.log('Property tile pyramid rollback applied.');
}

if (isDirectRun()) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

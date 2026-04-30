import { sql } from 'drizzle-orm';
import { closeConnection, db } from '../db/index.js';

type ProjectionCommand = 'rebuild' | 'validate';

type CliOptions = {
  command: ProjectionCommand;
  minZoom: number;
  maxZoom: number;
};

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @huishype/api db:rebuild-map-projections [-- --min-zoom 0 --max-zoom 16]
  pnpm --filter @huishype/api db:validate-map-projections

Commands:
  rebuild    Rebuild Martin map projection tables and bucket memberships.
  validate   Run projection integrity checks.

Options:
  --min-zoom <z>   Lowest bucket zoom to rebuild. Default: 0.
  --max-zoom <z>   Highest bucket zoom to rebuild. Default: 16.
  --help           Show this help.`);
}

function parseZoom(value: string | undefined, label: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 22) {
    throw new Error(`${label} must be an integer from 0 through 22`);
  }
  return parsed;
}

function parseArgs(argv: string[], defaultCommand: ProjectionCommand): CliOptions {
  let command = defaultCommand;
  let minZoom = 0;
  let maxZoom = 16;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === 'rebuild' || arg === 'validate') {
      command = arg;
      continue;
    }
    if (arg === '--min-zoom') {
      minZoom = parseZoom(argv[index + 1], '--min-zoom');
      index += 1;
      continue;
    }
    if (arg === '--max-zoom') {
      maxZoom = parseZoom(argv[index + 1], '--max-zoom');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (minZoom > maxZoom) {
    throw new Error('--min-zoom must be less than or equal to --max-zoom');
  }

  return { command, minZoom, maxZoom };
}

async function rebuild(minZoom: number, maxZoom: number): Promise<void> {
  const rows = await db.execute<{
    projection_name: string;
    row_count: string | number | bigint;
  }>(sql`
    SELECT projection_name, row_count
    FROM martin_tiles.rebuild_map_projections(${minZoom}, ${maxZoom})
  `);

  console.log(`Rebuilt map projections for zooms ${minZoom}-${maxZoom}`);
  for (const row of rows) {
    console.log(`${row.projection_name}: ${row.row_count.toString()}`);
  }
}

async function validate(): Promise<void> {
  const rows = await db.execute<{
    check_name: string;
    ok: boolean;
    detail: string;
  }>(sql`
    SELECT check_name, ok, detail
    FROM martin_tiles.validate_map_projections()
  `);

  let failed = false;
  for (const row of rows) {
    console.log(`${row.ok ? 'ok' : 'fail'} ${row.check_name}: ${row.detail}`);
    failed ||= !row.ok;
  }

  if (failed) {
    throw new Error('Map projection validation failed');
  }
}

const defaultCommand = process.argv[1]?.includes('validate') ? 'validate' : 'rebuild';
const options = parseArgs(process.argv.slice(2), defaultCommand);

Promise.resolve(options.command === 'validate' ? validate() : rebuild(options.minZoom, options.maxZoom))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });

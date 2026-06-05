import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { closeConnection, db } from '../db/index.js';
import { rebuildLocationSearchAreas } from '../services/location-search-areas.js';

dotenv.config({ quiet: true });

type CliArgs = {
  countries: string[];
  force: boolean;
  ifEmpty: boolean;
  profile: boolean;
};

type CountRow = {
  count: number | string;
};

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const countryIdx = args.indexOf('--country');
  const countryValue =
    countryIdx !== -1 && countryIdx + 1 < args.length ? args[countryIdx + 1] : '';
  const countries =
    countryValue.trim() === ''
      ? []
      : countryValue
          .split(',')
          .map((country) => country.trim().toUpperCase())
          .filter(Boolean);

  return {
    countries,
    force:
      args.includes('--force') ||
      process.env.FORCE_LOCATION_SEARCH_AREA_REBUILD === 'true',
    ifEmpty: args.includes('--if-empty'),
    profile: args.includes('--profile'),
  };
}

async function countExistingLocationSearchAreas(): Promise<number> {
  const rows = Array.from(
    (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM location_search_areas`
    )) as Iterable<CountRow>
  );
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const start = Date.now();
  const args = parseArgs();

  if (args.ifEmpty && !args.force) {
    const existingCount = await countExistingLocationSearchAreas();
    if (existingCount > 0) {
      console.log(
        `Skipping location_search_areas rebuild: ${existingCount.toLocaleString('en-US')} rows already exist. Use --force or FORCE_LOCATION_SEARCH_AREA_REBUILD=true to rebuild anyway.`
      );
      return;
    }
  }

  console.log('Rebuilding location_search_areas...');
  if (args.countries.length > 0) {
    console.log(`Countries: ${args.countries.join(', ')}`);
  }

  const result = await rebuildLocationSearchAreas({
    countries: args.countries,
    profile: args.profile,
    logger: {
      info(message, details) {
        console.log(message, details ?? {});
      },
    },
  });

  console.log(
    `location_search_areas rebuilt: ${result.beforeCount.toLocaleString('en-US')} -> ${result.afterCount.toLocaleString('en-US')} rows in ${formatTime(Date.now() - start)}`
  );
}

main()
  .catch((error) => {
    console.error('Failed to rebuild location_search_areas:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });

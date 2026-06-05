import dotenv from 'dotenv';
import { closeConnection } from '../src/db/index.js';
import { rebuildLocationSearchAreas } from '../src/services/location-search-areas.js';

dotenv.config({ quiet: true });

type CliArgs = {
  countries: string[];
  profile: boolean;
  rebuildOvertureMemberships: boolean;
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
    profile: args.includes('--profile'),
    rebuildOvertureMemberships: args.includes('--rebuild-overture-memberships'),
  };
}

async function main() {
  const start = Date.now();
  const args = parseArgs();
  console.log('Rebuilding location_search_areas...');
  if (args.countries.length > 0) {
    console.log(`Countries: ${args.countries.join(', ')}`);
  }
  if (args.rebuildOvertureMemberships) {
    console.log('Rebuilding Overture property memberships first...');
  }

  const result = await rebuildLocationSearchAreas({
    countries: args.countries,
    profile: args.profile,
    rebuildOvertureMemberships: args.rebuildOvertureMemberships,
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

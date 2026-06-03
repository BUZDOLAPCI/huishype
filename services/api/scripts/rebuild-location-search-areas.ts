import dotenv from 'dotenv';
import { closeConnection } from '../src/db/index.js';
import { rebuildLocationSearchAreas } from '../src/services/location-search-areas.js';

dotenv.config({ quiet: true });

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

async function main() {
  const start = Date.now();
  console.log('Rebuilding location_search_areas...');

  const result = await rebuildLocationSearchAreas({
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

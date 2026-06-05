#!/bin/sh
set -e

# Run database migrations if requested
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  node services/api/dist/migrate.js
  echo "Migrations complete."
fi

if [ "$RUN_LOCATION_SEARCH_AREA_REBUILD" = "true" ]; then
  echo "Checking location_search_areas rebuild..."
  node services/api/dist/scripts/rebuild-location-search-areas.js --if-empty
  echo "location_search_areas rebuild check complete."
fi

exec "$@"

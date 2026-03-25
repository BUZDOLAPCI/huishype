#!/bin/sh
set -e

# Run database migrations if requested
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  node services/api/dist/migrate.js
  echo "Migrations complete."
fi

exec "$@"

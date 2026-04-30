-- Run as a database owner/admin for the target HuisHype database.
-- Replace the password before applying in production.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'martin_tile') THEN
    CREATE ROLE martin_tile LOGIN PASSWORD 'martin_tile_dev';
  ELSE
    ALTER ROLE martin_tile LOGIN PASSWORD 'martin_tile_dev';
  END IF;
END
$$;

ALTER ROLE martin_tile SET statement_timeout = '2s';
ALTER ROLE martin_tile SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE martin_tile SET lock_timeout = '500ms';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO martin_tile', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO martin_tile;
GRANT USAGE ON SCHEMA martin_tiles TO martin_tile;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO martin_tile;
GRANT SELECT ON ALL TABLES IN SCHEMA martin_tiles TO martin_tile;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA martin_tiles TO martin_tile;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO martin_tile;
ALTER DEFAULT PRIVILEGES IN SCHEMA martin_tiles GRANT SELECT ON TABLES TO martin_tile;
ALTER DEFAULT PRIVILEGES IN SCHEMA martin_tiles GRANT EXECUTE ON FUNCTIONS TO martin_tile;

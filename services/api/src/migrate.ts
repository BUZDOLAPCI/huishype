/**
 * Programmatic database migration runner for production.
 * Uses drizzle-orm's migrator (no drizzle-kit needed at runtime).
 *
 * Usage: node dist/migrate.js
 * Expects DATABASE_URL in environment.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

try {
  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './services/api/drizzle' });
  console.log('Migrations completed successfully');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await sql.end();
}

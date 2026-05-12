import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const maxConnections = parsePositiveInt(
  process.env.DATABASE_POOL_MAX,
  config.isTest ? 2 : 10,
);

// Create the postgres connection
const queryClient = postgres(config.database.url, {
  max: maxConnections,
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Fail connection after 10 seconds
});

// Create the drizzle database instance with schema
export const db = drizzle(queryClient, { schema });
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReservedQueryClient = Awaited<ReturnType<typeof queryClient.reserve>>;

export async function reserveDbConnection(): Promise<ReservedQueryClient> {
  return queryClient.reserve();
}

// Export for use in tests or graceful shutdown.
// Idempotent: safe to call multiple times (e.g. app.close() + jest teardown).
let connectionClosed = false;
export const closeConnection = async () => {
  if (connectionClosed) return;
  connectionClosed = true;
  await queryClient.end();
};

// Re-export schema types for convenience
export * from './schema.js';

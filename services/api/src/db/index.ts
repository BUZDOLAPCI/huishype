import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

// Create the postgres connection
const queryClient = postgres(config.database.url, {
  max: 10, // Max pool size
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Fail connection after 10 seconds
});

// Create the drizzle database instance with schema
export const db = drizzle(queryClient, { schema });

// Export for use in tests or graceful shutdown
export const closeConnection = async () => {
  await queryClient.end();
};

// Re-export schema types for convenience
export * from './schema.js';

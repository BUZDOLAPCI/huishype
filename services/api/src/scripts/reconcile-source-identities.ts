import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getAllListingSourceNames } from '@huishype/shared/config';
import * as schema from '../db/schema.js';
import { reconcileSourceIdentityCheckpoint } from '../services/ingest/identity-reconciliation-checkpoint.js';

const usage = 'Usage: reconcile-source-identities --source funda [--execute [--once]]';

export function parseReconciliationOptions(args: string[]) {
  let sourceName: string | undefined;
  let execute = false;
  let once = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--source' && sourceName === undefined) sourceName = args[++index];
    else if (arg === '--execute' && !execute) execute = true;
    else if (arg === '--once' && !once) once = true;
    else throw new Error(usage);
  }
  if (!sourceName || !getAllListingSourceNames().includes(sourceName)) throw new Error(usage);
  if (once && !execute) throw new Error('--once requires --execute.');
  return { sourceName, execute, once };
}

export async function runReconciliationCli(args: string[], databaseUrl: string | undefined) {
  const options = parseReconciliationOptions(args);
  if (!databaseUrl) throw new Error('DATABASE_URL is required for identity reconciliation.');
  // Startup migration needs no app auth configuration, Redis, or application pool.
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const database = drizzle(client, { schema });
    return await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, options.sourceName, options));
  } finally {
    await client.end();
  }
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === directRunUrl) {
  try {
    console.log(JSON.stringify(await runReconciliationCli(process.argv.slice(2), process.env.DATABASE_URL)));
  } catch (error) {
    console.error(JSON.stringify({ error: 'IDENTITY_RECONCILIATION_FAILED',
      message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}

import { db, closeConnection } from '../db/index.js';
import { getAllListingSourceNames } from '@huishype/shared/config';
import { reconcileLegacySourceIdentities } from '../services/ingest/identity.js';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const sourceName = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
if (!sourceName || !getAllListingSourceNames().includes(sourceName)
  || args.some((arg, index) => index !== sourceIndex + 1 && !['--source', '--execute'].includes(arg))) {
  console.error('Usage: tsx src/scripts/reconcile-source-identities.ts --source funda [--execute]');
  process.exitCode = 1;
} else {
  try {
    const report = await db.transaction((tx) => reconcileLegacySourceIdentities(tx, sourceName, { dryRun: !args.includes('--execute') }));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
await closeConnection();

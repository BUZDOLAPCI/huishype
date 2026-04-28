import { getAllListingSourceNames } from '@huishype/shared/config';
import { closeConnection } from '../db/index.js';
import { closeRedisConnection } from '../lib/redis.js';
import {
  closeIngestQueues,
  enqueueIngestBatch,
  forceRecoverSkippedCompletedIngestBatches,
  listBlockedSourceBatchesAtWatermark,
  listForceSkippedBatchRecoveryCandidates,
  requeueBlockedSourceBatchesAtWatermark,
  requestLatestListingsRefresh,
} from '../services/ingest/index.js';

interface CliOptions {
  sourceName: string;
  limit: number;
  execute: boolean;
  requeueBlocked: boolean;
  forceRecoverMissing: boolean;
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @huishype/api ingest:recover -- --source funda [--limit 25] [--execute]
  node dist/scripts/ingest-recovery.js --source funda --requeue-blocked --execute
  node dist/scripts/ingest-recovery.js --source funda --force-recover-missing --limit 10 --execute

Options:
  --source <name>              Listing source to recover, for example funda or pararius.
  --limit <count>              Max blocked batches and max force-recovery candidates. Default: 25.
  --execute                    Apply changes. Without this flag the script is a dry run.
  --requeue-blocked            Requeue batches at the current source watermark.
  --force-recover-missing      Replay completed batches that still have missing mirror observations.
  --help                       Show this help.

If no action flag is supplied, both actions are inspected or executed.`);
}

function parseArgs(argv: string[]): CliOptions {
  let sourceName: string | null = null;
  let limit = 25;
  let execute = false;
  let requeueBlocked = false;
  let forceRecoverMissing = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--source') {
      sourceName = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      const parsed = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      index += 1;
      continue;
    }

    if (arg === '--execute') {
      execute = true;
      continue;
    }

    if (arg === '--requeue-blocked') {
      requeueBlocked = true;
      continue;
    }

    if (arg === '--force-recover-missing') {
      forceRecoverMissing = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!sourceName) {
    throw new Error('--source is required');
  }

  const validSources = getAllListingSourceNames();
  if (!validSources.includes(sourceName)) {
    throw new Error(`Unknown source "${sourceName}". Expected one of: ${validSources.join(', ')}`);
  }

  if (!requeueBlocked && !forceRecoverMissing) {
    requeueBlocked = true;
    forceRecoverMissing = true;
  }

  return {
    sourceName,
    limit,
    execute,
    requeueBlocked,
    forceRecoverMissing,
  };
}

function summarizeIds(label: string, ids: string[]): void {
  console.log(`${label}: ${ids.length}`);
  for (const id of ids.slice(0, 10)) {
    console.log(`  - ${id}`);
  }
  if (ids.length > 10) {
    console.log(`  ... ${ids.length - 10} more`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Ingest recovery for source "${options.sourceName}"`);
  console.log(`Mode: ${options.execute ? 'execute' : 'dry-run'}`);
  console.log(`Limit: ${options.limit}`);

  if (!options.execute) {
    console.log('Dry run only. Pass --execute to update batches, enqueue jobs, or replay observations.');
  }

  if (options.requeueBlocked) {
    console.log('\nBlocked batches at current watermark');
    if (options.execute) {
      const requeued = await requeueBlockedSourceBatchesAtWatermark(options.sourceName, options.limit);
      for (const batch of requeued) {
        await enqueueIngestBatch(batch.id);
      }

      summarizeIds('Requeued and enqueued batches', requeued.map((batch) => batch.id));
      const byPreviousStatus = requeued.reduce<Record<string, number>>((counts, batch) => {
        counts[batch.previousStatus] = (counts[batch.previousStatus] ?? 0) + 1;
        return counts;
      }, {});
      console.log(`Previous statuses: ${JSON.stringify(byPreviousStatus)}`);
    } else {
      const candidates = await listBlockedSourceBatchesAtWatermark(options.sourceName, options.limit);
      summarizeIds('Would requeue/enqueue batches', candidates.map((batch) => batch.id));
      const byStatus = candidates.reduce<Record<string, number>>((counts, batch) => {
        counts[batch.status] = (counts[batch.status] ?? 0) + 1;
        return counts;
      }, {});
      console.log(`Current statuses: ${JSON.stringify(byStatus)}`);
    }
  }

  if (options.forceRecoverMissing) {
    console.log('\nCompleted batches with missing mirror observations');
    if (options.execute) {
      const result = await forceRecoverSkippedCompletedIngestBatches(options.sourceName, options.limit);
      for (const batchId of result.recoveredBatchIds) {
        await requestLatestListingsRefresh({
          requestedBy: 'ingest-batch',
          batchId,
        });
      }
      console.log(`Candidates inspected: ${result.candidateCount}`);
      console.log(`Recovered observations: ${result.recoveredObservationCount}`);
      console.log(`Maintenance refresh jobs requested: ${result.recoveredBatchIds.length}`);
      summarizeIds('Batches with recovered observations', result.recoveredBatchIds);
    } else {
      const candidates = await listForceSkippedBatchRecoveryCandidates(options.sourceName, options.limit);
      summarizeIds('Would force-recover completed batches', candidates.map((batch) => batch.id));
      const missingAccounting = candidates.filter((batch) => batch.skippedCount > 0).length;
      console.log(`Candidates with skipped_count > 0: ${missingAccounting}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeIngestQueues();
    await closeRedisConnection();
    await closeConnection();
  });

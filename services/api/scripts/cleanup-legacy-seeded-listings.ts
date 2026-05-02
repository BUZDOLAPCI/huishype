import { closeConnection } from '../src/db/index.js';
import {
  cleanupLegacySeededListings,
  type LegacySeededListingCleanupSource,
} from '../src/services/legacy-seeded-listing-cleanup.js';

type CliOptions = {
  source: LegacySeededListingCleanupSource;
  limit: number;
  execute: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    source: 'both',
    limit: 25,
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (arg === '--source') {
      const value = argv[index + 1];
      if (value !== 'funda' && value !== 'pararius' && value !== 'both') {
        throw new Error('--source must be one of: funda, pararius, both');
      }
      options.source = value;
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const value = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--limit must be a positive integer');
      }
      options.limit = value;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: pnpm --filter @huishype/api listings:cleanup-legacy-seeds [options]',
        '',
        'Options:',
        '  --source funda|pararius|both  Source to validate (default: both)',
        '  --limit N                     Candidates to validate this run (default: 25)',
        '  --execute                     Persist strong source-backed outcomes',
        '',
        'Default mode is a dry-run: candidates are validated but no rows are written.',
      ].join('\n'));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printSummary(summary: Awaited<ReturnType<typeof cleanupLegacySeededListings>>) {
  console.log(`Mode: ${summary.execute ? 'execute' : 'dry-run'}`);
  console.log(`Source: ${summary.source}`);
  console.log(`Limit: ${summary.limit}`);
  console.log('Candidate totals:');
  console.log(`  funda: ${summary.candidateCounts.funda}`);
  console.log(`  pararius: ${summary.candidateCounts.pararius}`);

  const sample = summary.candidates.slice(0, 5);
  if (sample.length > 0) {
    console.log('Sample candidates:');
    for (const candidate of sample) {
      console.log(
        `  ${candidate.sourceName} ${candidate.canonicalListingId} property=${candidate.propertyId} url=${candidate.canonicalUrl ?? candidate.displayUrl ?? '(id-only)'}`,
      );
    }
  }

  console.log('Run outcome:');
  console.log(`  validated count: ${summary.validatedCount}`);
  console.log(`  changed count: ${summary.changedCount}`);
  console.log(`  kept active count: ${summary.keptActiveCount}`);
  console.log(`  skipped temporary/error count: ${summary.temporaryErrorCount}`);
  console.log(`  skipped total count: ${summary.skippedCount}`);
  console.log(`  materialized view refresh request count: ${summary.maintenanceRefreshRequestCount}`);
  if (summary.maintenanceBatchIds.length > 0) {
    console.log(`  materialized view refresh request ids: ${summary.maintenanceBatchIds.join(', ')}`);
  }

  const outcomeCounts = new Map<string, number>();
  for (const result of summary.results) {
    const key = result.validation
      ? `${result.validation.state}:${result.validation.sourceStatus ?? 'missing'}:${result.classification.reason}`
      : `no_validation:${result.classification.reason}`;
    outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
  }
  if (outcomeCounts.size > 0) {
    console.log('Outcome counts:');
    for (const [key, count] of [...outcomeCounts.entries()].sort()) {
      console.log(`  ${key}: ${count}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await cleanupLegacySeededListings(options);
  printSummary(summary);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });

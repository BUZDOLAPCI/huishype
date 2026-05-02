import { closeConnection } from '../db/index.js';
import {
  cleanupLegacySeededListings,
  type LegacySeededListingCleanupSource,
} from '../services/legacy-seeded-listing-cleanup.js';

type CliOptions = {
  source: LegacySeededListingCleanupSource;
  limit: number;
  execute: boolean;
  delayMs: number;
  maxConsecutiveTemporaryErrors: number | null;
};

function parsePositiveIntegerFlag(name: string, rawValue: string | undefined): number {
  const value = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeIntegerFlag(name: string, rawValue: string | undefined): number {
  const value = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    source: 'both',
    limit: 25,
    execute: false,
    delayMs: 2_000,
    maxConsecutiveTemporaryErrors: 5,
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
      options.limit = parsePositiveIntegerFlag('--limit', argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--delay-ms') {
      options.delayMs = parseNonNegativeIntegerFlag('--delay-ms', argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--max-consecutive-temporary-errors') {
      const value = parseNonNegativeIntegerFlag('--max-consecutive-temporary-errors', argv[index + 1]);
      options.maxConsecutiveTemporaryErrors = value === 0 ? null : value;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: pnpm --filter @huishype/api listings:cleanup-legacy-seeds [options]',
        'Production image: node services/api/dist/scripts/cleanup-legacy-seeded-listings.js [options]',
        '',
        'Options:',
        '  --source funda|pararius|both          Source to validate (default: both)',
        '  --limit N                             Candidates to validate this run (default: 25)',
        '  --delay-ms N                          Delay between candidates (default: 2000)',
        '  --max-consecutive-temporary-errors N  Stop after N temporary errors in a row (default: 5, 0 disables)',
        '  --execute                             Persist strong source-backed outcomes',
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
  console.log(`Delay between candidates: ${summary.delayMs}ms`);
  console.log(
    `Max consecutive temporary errors: ${summary.maxConsecutiveTemporaryErrors ?? 'disabled'}`,
  );
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
  console.log(`  processed candidate count: ${summary.processedCandidateCount}`);
  console.log(`  unprocessed candidate count: ${summary.unprocessedCandidateCount}`);
  console.log(`  validated count: ${summary.validatedCount}`);
  console.log(`  changed count: ${summary.changedCount}`);
  console.log(`  kept active count: ${summary.keptActiveCount}`);
  console.log(`  skipped temporary/error count: ${summary.temporaryErrorCount}`);
  console.log(`  skipped total count: ${summary.skippedCount}`);
  console.log(`  materialized view refresh request count: ${summary.maintenanceRefreshRequestCount}`);
  if (summary.stoppedEarlyReason !== null) {
    console.log(`  stopped early reason: ${summary.stoppedEarlyReason}`);
  }
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

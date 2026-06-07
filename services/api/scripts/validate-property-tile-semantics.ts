import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import {
  assertEndpointSemanticCoverage,
  buildDefaultPropertyTileSemanticSamples,
  validatePropertyTileResponse,
  type TileSemanticSummary,
  type ValidationEndpoint,
  type ValidationFailure,
  type ValidationWarning,
} from '../src/scripts/property-tile-semantic-validation.js';
import { propertyTilePath, type PropertyTileSample } from '../src/scripts/property-tile-benchmark-samples.js';

type ValidationOptions = {
  endpoints: ValidationEndpoint[];
  timeoutMs: number;
  jsonOut?: string;
  dryRun: boolean;
  allowAllEmpty: boolean;
};

type FetchResult = {
  status: number;
  headers: Headers;
  payload: Uint8Array;
  elapsedMs: number;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_TIMEOUT_MS = 60_000;

function printUsage() {
  console.log(`Validate semantic shape of sampled public property MVT tiles.

Usage:
  pnpm --filter @huishype/api validate:property-tiles [options]

Options:
  --base-url <url>             Single endpoint base URL.
                               Env fallback: PROPERTY_TILE_VALIDATION_BASE_URL,
                               then PROPERTY_TILE_BENCHMARK_BASE_URL.
                               Default: ${DEFAULT_BASE_URL}.
  --main-base-url <url>        Main endpoint base URL. Env fallback:
                               PROPERTY_TILE_VALIDATION_MAIN_BASE_URL, then
                               PROPERTY_TILE_BENCHMARK_MAIN_BASE_URL.
  --candidate-base-url <url>   Candidate endpoint base URL. Env fallback:
                               PROPERTY_TILE_VALIDATION_CANDIDATE_BASE_URL, then
                               PROPERTY_TILE_BENCHMARK_CANDIDATE_BASE_URL.
  --timeout-ms <ms>            Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --json-out <path>            Write summaries, warnings, and failures as JSON.
  --allow-all-empty            Do not fail when every sampled tile is 204/empty.
                               Use only for intentionally empty fixtures.
  --dry-run                    Print resolved endpoints and sampled tiles.
  --help                       Show this help.

Checks:
  - Decodes the properties MVT layer with @mapbox/vector-tile + pbf.
  - Validates point feature shape, required properties, cluster point counts,
    bbox fields, representative UUIDs, membership coverage, and active-only
    node classes.
  - Validates first-response promoted pyramid headers when seen:
    x-tile-cache=precomputed, x-huishype-tile-status=pyramid-promoted|pyramid-empty,
    and x-huishype-pyramid-version.

Main/candidate:
  Provide --main-base-url and/or --candidate-base-url, or the matching env vars,
  to validate both endpoints in one run. Without those, the script validates the
  single --base-url target.`);
}

function parseArgs(argv: string[]): ValidationOptions {
  let baseUrl =
    process.env.PROPERTY_TILE_VALIDATION_BASE_URL ??
    process.env.PROPERTY_TILE_BENCHMARK_BASE_URL ??
    DEFAULT_BASE_URL;
  let mainBaseUrl =
    process.env.PROPERTY_TILE_VALIDATION_MAIN_BASE_URL ??
    process.env.PROPERTY_TILE_BENCHMARK_MAIN_BASE_URL;
  let candidateBaseUrl =
    process.env.PROPERTY_TILE_VALIDATION_CANDIDATE_BASE_URL ??
    process.env.PROPERTY_TILE_BENCHMARK_CANDIDATE_BASE_URL;
  const options: Omit<ValidationOptions, 'endpoints'> = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    allowAllEmpty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--base-url') {
      baseUrl = readValue(argv, ++index, '--base-url');
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg === '--main-base-url') {
      mainBaseUrl = readValue(argv, ++index, '--main-base-url');
      continue;
    }
    if (arg.startsWith('--main-base-url=')) {
      mainBaseUrl = arg.slice('--main-base-url='.length);
      continue;
    }
    if (arg === '--candidate-base-url') {
      candidateBaseUrl = readValue(argv, ++index, '--candidate-base-url');
      continue;
    }
    if (arg.startsWith('--candidate-base-url=')) {
      candidateBaseUrl = arg.slice('--candidate-base-url='.length);
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(readValue(argv, ++index, '--timeout-ms'), '--timeout-ms');
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }
    if (arg === '--json-out') {
      options.jsonOut = readValue(argv, ++index, '--json-out');
      continue;
    }
    if (arg.startsWith('--json-out=')) {
      options.jsonOut = arg.slice('--json-out='.length);
      continue;
    }
    if (arg === '--allow-all-empty') {
      options.allowAllEmpty = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const endpoints = buildEndpoints({ baseUrl, mainBaseUrl, candidateBaseUrl });
  if (options.jsonOut === '') {
    throw new Error('--json-out requires a non-empty path');
  }
  return { ...options, endpoints };
}

function buildEndpoints(input: {
  baseUrl: string;
  mainBaseUrl?: string;
  candidateBaseUrl?: string;
}): ValidationEndpoint[] {
  const endpoints: ValidationEndpoint[] = [];
  if (input.mainBaseUrl) endpoints.push({ label: 'main', baseUrl: normalizeBaseUrl(input.mainBaseUrl) });
  if (input.candidateBaseUrl) {
    endpoints.push({ label: 'candidate', baseUrl: normalizeBaseUrl(input.candidateBaseUrl) });
  }
  if (endpoints.length === 0) {
    endpoints.push({ label: 'current', baseUrl: normalizeBaseUrl(input.baseUrl) });
  }
  return endpoints;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/+$/, '');
  new URL(normalized);
  return normalized;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

async function fetchTile(
  endpoint: ValidationEndpoint,
  sample: PropertyTileSample,
  timeoutMs: number
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${endpoint.baseUrl}${propertyTilePath(sample)}`;
  const startedAt = performance.now();

  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      payload,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printDryRun(endpoints: ValidationEndpoint[], samples: PropertyTileSample[]) {
  console.log('Property tile semantic validation dry run');
  console.log('endpoints:');
  for (const endpoint of endpoints) {
    console.log(`- ${endpoint.label}: ${endpoint.baseUrl}`);
  }
  console.log('tiles:');
  for (const sample of samples) {
    console.log(`- ${sample.city}: ${propertyTilePath(sample)}`);
  }
}

function printSummary(summaries: TileSemanticSummary[], warnings: ValidationWarning[], failures: ValidationFailure[]) {
  console.error('');
  console.error('Semantic validation summary');
  for (const summary of summaries) {
    console.error(
      `${summary.endpoint} ${summary.city} ${summary.tile}: status=${summary.status}, features=${summary.featureCount}, singles=${summary.singleCount}, clusters=${summary.clusterCount}, active=${summary.activeCount}, points=${summary.pointCountTotal}, cache=${summary.tileCache || '-'}, tile_status=${summary.tileStatus || '-'}`
    );
  }

  if (warnings.length > 0) {
    console.error('');
    console.error('Warnings');
    for (const warning of warnings) {
      console.error(`- ${warning.endpoint} ${warning.tile}: ${warning.message}`);
    }
  }

  if (failures.length > 0) {
    console.error('');
    console.error('Failures');
    for (const failure of failures) {
      console.error(`- ${failure.endpoint} ${failure.tile}: ${failure.message}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const samples = buildDefaultPropertyTileSemanticSamples();
  const summaries: TileSemanticSummary[] = [];
  const warnings: ValidationWarning[] = [];
  const failures: ValidationFailure[] = [];

  if (options.dryRun) {
    printDryRun(options.endpoints, samples);
    return;
  }

  for (const endpoint of options.endpoints) {
    for (const sample of samples) {
      const tile = `${sample.z}/${sample.x}/${sample.y}`;
      try {
        const response = await fetchTile(endpoint, sample, options.timeoutMs);
        const result = validatePropertyTileResponse({
          endpoint,
          sample,
          status: response.status,
          headers: response.headers,
          payload: response.payload,
        });
        summaries.push(result.summary);
        warnings.push(...result.warnings);
        failures.push(...result.failures);
        console.error(
          `${endpoint.label} ${tile} ${response.status} ${response.payload.byteLength} bytes ${response.elapsedMs.toFixed(1)}ms`
        );
      } catch (error) {
        failures.push({
          endpoint: endpoint.label,
          tile,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  failures.push(...assertEndpointSemanticCoverage(summaries, options.allowAllEmpty));
  printSummary(summaries, warnings, failures);

  if (options.jsonOut) {
    await writeFile(
      options.jsonOut,
      `${JSON.stringify({ summaries, warnings, failures }, null, 2)}\n`,
      'utf8'
    );
    console.error(`JSON summary written to ${options.jsonOut}`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

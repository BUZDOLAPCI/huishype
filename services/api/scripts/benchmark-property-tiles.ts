import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  buildRepresentativePropertyTileSamples,
  propertyTilePath,
  type PropertyTileSample,
} from '../src/scripts/property-tile-benchmark-samples.js';

type Phase = 'cold' | 'warm';
type ZoomBand = 'z4-z10' | 'z11-z13' | 'z14-z17';

type TileRequest = PropertyTileSample;

export type BenchmarkOptions = {
  baseUrl: string;
  warmPasses: number;
  timeoutMs: number;
  jsonOut?: string;
  failColdGenOverMs?: number;
  failColdP95GenOverMs?: number;
};

export type BenchmarkRow = TileRequest & {
  phase: Phase;
  status: number | 'error';
  bytes: number;
  elapsedClientMs: number;
  xTileCache: string;
  xTileGenerationTime: string;
  xTileQueueTime: string;
  xTileCoalesced: string;
  xTileBudgetMs: string;
  xHuisHypeTileStatus: string;
};

type PhaseSummary = {
  phase: Phase;
  requests: number;
  okStatuses: number;
  unexpectedStatuses: number;
  errors: number;
  avgClientMs: number;
  p50ClientMs: number;
  p95ClientMs: number;
  maxClientMs: number;
  avgBytes: number;
  generationTimeMs: {
    count: number;
    avg: number;
    p50: number;
    p95: number;
    max: number;
  };
};

type ColdZoomBandSummary = Omit<PhaseSummary, 'phase'> & {
  zoomBand: ZoomBand;
};

export type BenchmarkSummary = {
  generatedAt: string;
  baseUrl: string;
  tiles: number;
  passes: {
    cold: number;
    warm: number;
  };
  rows: BenchmarkRow[];
  byPhase: PhaseSummary[];
  byColdZoomBand: ColdZoomBandSummary[];
  unexpectedStatuses: BenchmarkRow[];
  failures: string[];
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_WARM_PASSES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;

const CSV_COLUMNS = [
  'city',
  'z',
  'x',
  'y',
  'phase',
  'status',
  'bytes',
  'elapsed_client_ms',
  'x_tile_cache',
  'x_tile_generation_time',
  'x_tile_queue_time',
  'x_tile_coalesced',
  'x_tile_budget_ms',
  'x_huishype_tile_status',
] as const;

function printUsage(): void {
  console.log(`Benchmark property tile requests.

Usage:
  pnpm --filter @huishype/api benchmark:property-tiles [options]

Options:
  --base-url <url>       API base URL. Defaults to ${DEFAULT_BASE_URL}.
                         Env fallback: PROPERTY_TILE_BENCHMARK_BASE_URL.
  --warm-passes <count>  Number of repeated warm passes after the first pass.
                         Defaults to ${DEFAULT_WARM_PASSES}.
  --timeout-ms <ms>      Per-request timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --json-out <path>      Write rows and summary metrics to a JSON file.
  --fail-cold-gen-over-ms <ms>
                         Exit non-zero when any cold x-tile-generation-time
                         exceeds this threshold.
  --fail-cold-p95-gen-over-ms <ms>
                         Exit non-zero when p95 cold x-tile-generation-time
                         across the representative tile set exceeds this
                         threshold.
  --help                 Show this help.

Notes:
  The benchmark uses representative heavy public tiles: dense z13
  Amsterdam/Utrecht/Rotterdam, low-zoom Randstad/city tiles, z10 pyramid edge,
  z11-z13 transition tiles, z14-z16 detail tiles, and z17 ghost-reveal city
  tiles.

  The benchmark uses /tiles/properties/:z/:x/:y.pbf with no cache-busting query
  parameter. To approximate a cold server memory cache, restart the API before
  running this script. The cold pass measures dynamic zoom bands first
  (z14-z17, then z11-z13, then z4-z10) so main is not warmed by large dynamic
  low-zoom requests before high-zoom dynamic samples. The server cache key is
  tile plus normalized filter signature, so a unique query parameter would not
  create a distinct server tile-cache key and can obscure filter semantics.`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {
    baseUrl: process.env.PROPERTY_TILE_BENCHMARK_BASE_URL ?? DEFAULT_BASE_URL,
    warmPasses: DEFAULT_WARM_PASSES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (!value) throw new Error('--base-url requires a value');
      options.baseUrl = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg === '--warm-passes') {
      const value = argv[index + 1];
      if (!value) throw new Error('--warm-passes requires a value');
      options.warmPasses = parsePositiveInteger(value, '--warm-passes');
      index += 1;
      continue;
    }

    if (arg.startsWith('--warm-passes=')) {
      options.warmPasses = parsePositiveInteger(
        arg.slice('--warm-passes='.length),
        '--warm-passes'
      );
      continue;
    }

    if (arg === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value) throw new Error('--timeout-ms requires a value');
      options.timeoutMs = parsePositiveInteger(value, '--timeout-ms');
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }

    if (arg === '--json-out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--json-out requires a value');
      options.jsonOut = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--json-out=')) {
      options.jsonOut = arg.slice('--json-out='.length);
      continue;
    }

    if (arg === '--fail-cold-gen-over-ms') {
      const value = argv[index + 1];
      if (!value) throw new Error('--fail-cold-gen-over-ms requires a value');
      options.failColdGenOverMs = parseNonNegativeNumber(value, '--fail-cold-gen-over-ms');
      index += 1;
      continue;
    }

    if (arg.startsWith('--fail-cold-gen-over-ms=')) {
      options.failColdGenOverMs = parseNonNegativeNumber(
        arg.slice('--fail-cold-gen-over-ms='.length),
        '--fail-cold-gen-over-ms'
      );
      continue;
    }

    if (arg === '--fail-cold-p95-gen-over-ms') {
      const value = argv[index + 1];
      if (!value) throw new Error('--fail-cold-p95-gen-over-ms requires a value');
      options.failColdP95GenOverMs = parseNonNegativeNumber(value, '--fail-cold-p95-gen-over-ms');
      index += 1;
      continue;
    }

    if (arg.startsWith('--fail-cold-p95-gen-over-ms=')) {
      options.failColdP95GenOverMs = parseNonNegativeNumber(
        arg.slice('--fail-cold-p95-gen-over-ms='.length),
        '--fail-cold-p95-gen-over-ms'
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  new URL(options.baseUrl);
  if (options.jsonOut === '') {
    throw new Error('--json-out requires a non-empty path');
  }
  return options;
}

function buildTileRequests(): TileRequest[] {
  return buildRepresentativePropertyTileSamples();
}

function getZoomBand(tile: Pick<TileRequest, 'z'>): ZoomBand | null {
  if (tile.z >= 4 && tile.z <= 10) return 'z4-z10';
  if (tile.z >= 11 && tile.z <= 13) return 'z11-z13';
  if (tile.z >= 14 && tile.z <= 17) return 'z14-z17';
  return null;
}

function buildColdTileRequests(requests: TileRequest[]): TileRequest[] {
  const order: Array<ZoomBand | null> = ['z14-z17', 'z11-z13', 'z4-z10', null];
  const originalIndex = new Map(requests.map((request, index) => [request, index]));

  return [...requests].sort((left, right) => {
    const leftOrder = order.indexOf(getZoomBand(left));
    const rightOrder = order.indexOf(getZoomBand(right));
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function rowToCsv(row: BenchmarkRow): string {
  return [
    row.city,
    row.z,
    row.x,
    row.y,
    row.phase,
    row.status,
    row.bytes,
    row.elapsedClientMs.toFixed(1),
    row.xTileCache,
    row.xTileGenerationTime,
    row.xTileQueueTime,
    row.xTileCoalesced,
    row.xTileBudgetMs,
    row.xHuisHypeTileStatus,
  ]
    .map(csvEscape)
    .join(',');
}

function getHeader(headers: Headers, name: string): string {
  return headers.get(name) ?? '';
}

async function fetchTile(
  baseUrl: string,
  request: TileRequest,
  phase: Phase,
  timeoutMs: number
): Promise<BenchmarkRow> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${propertyTilePath(request)}`;
  const startedAt = performance.now();

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.arrayBuffer();
    const elapsedClientMs = performance.now() - startedAt;

    return {
      ...request,
      phase,
      status: response.status,
      bytes: body.byteLength,
      elapsedClientMs,
      xTileCache: getHeader(response.headers, 'x-tile-cache'),
      xTileGenerationTime: getHeader(response.headers, 'x-tile-generation-time'),
      xTileQueueTime: getHeader(response.headers, 'x-tile-queue-time'),
      xTileCoalesced: getHeader(response.headers, 'x-tile-coalesced'),
      xTileBudgetMs: getHeader(response.headers, 'x-tile-budget-ms'),
      xHuisHypeTileStatus: getHeader(response.headers, 'x-huishype-tile-status'),
    };
  } catch (error) {
    const elapsedClientMs = performance.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...request,
      phase,
      status: 'error',
      bytes: 0,
      elapsedClientMs,
      xTileCache: message,
      xTileGenerationTime: '',
      xTileQueueTime: '',
      xTileCoalesced: '',
      xTileBudgetMs: '',
      xHuisHypeTileStatus: '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

function parseDurationMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:ms)?$/i);
  if (!match) return null;
  return Number(match[1]);
}

function isUnavailablePyramidTile(row: BenchmarkRow): boolean {
  return row.xTileCache === 'pyramid-unavailable';
}

function buildPyramidUnavailablePreconditionFailure(
  rows: BenchmarkRow[],
  baseUrl: string
): string | null {
  const unavailableRows = rows.filter(isUnavailablePyramidTile);
  if (unavailableRows.length === 0) {
    return null;
  }

  const statuses = Array.from(
    new Set(unavailableRows.map((row) => row.xHuisHypeTileStatus || 'unknown'))
  ).join(', ');
  const probe = unavailableRows[0];

  return (
    `Low-zoom pyramid benchmark precondition failed: ${unavailableRows.length} tile request(s) ` +
    `returned X-Tile-Cache=pyramid-unavailable (tile statuses: ${statuses}). ` +
    `benchmark:property-tiles:gate requires a promoted current property tile pyramid before ` +
    `measuring low-zoom public tiles. If status is pyramid-build-active or pyramid-build-enqueued, ` +
    `start/verify the worker with "docker compose --profile worker up -d worker" or ` +
    `"pnpm --filter @huishype/worker dev", wait for promotion, then rerun. ` +
    `Readiness probe: curl -I ${baseUrl}${propertyTilePath(probe)} should report ` +
    `X-Tile-Cache=precomputed.`
  );
}

export function isExpectedStatus(row: BenchmarkRow): boolean {
  return (row.status === 200 || row.status === 204) && !isUnavailablePyramidTile(row);
}

function buildPhaseSummary(rows: BenchmarkRow[], phase: Phase): PhaseSummary {
  const phaseRows = rows.filter((row) => row.phase === phase);
  return summarizePhaseRows(phaseRows, { phase });
}

function buildColdZoomBandSummary(rows: BenchmarkRow[], zoomBand: ZoomBand): ColdZoomBandSummary {
  const bandRows = rows.filter((row) => row.phase === 'cold' && getZoomBand(row) === zoomBand);
  return summarizePhaseRows(bandRows, { zoomBand });
}

function summarizePhaseRows<TIdentity extends { phase: Phase } | { zoomBand: ZoomBand }>(
  phaseRows: BenchmarkRow[],
  identity: TIdentity
): TIdentity & Omit<PhaseSummary, 'phase'> {
  const expectedRows = phaseRows.filter(isExpectedStatus);
  const clientTimes = expectedRows.map((row) => row.elapsedClientMs);
  const generationTimes = expectedRows
    .map((row) => parseDurationMs(row.xTileGenerationTime))
    .filter((value): value is number => value !== null);

  return {
    ...identity,
    requests: phaseRows.length,
    okStatuses: expectedRows.length,
    unexpectedStatuses: phaseRows.filter(
      (row) => typeof row.status === 'number' && !isExpectedStatus(row)
    ).length,
    errors: phaseRows.filter((row) => row.status === 'error').length,
    avgClientMs: average(clientTimes),
    p50ClientMs: percentile(clientTimes, 50),
    p95ClientMs: percentile(clientTimes, 95),
    maxClientMs: max(clientTimes),
    avgBytes: Math.round(average(expectedRows.map((row) => row.bytes))),
    generationTimeMs: {
      count: generationTimes.length,
      avg: average(generationTimes),
      p50: percentile(generationTimes, 50),
      p95: percentile(generationTimes, 95),
      max: max(generationTimes),
    },
  } as TIdentity & Omit<PhaseSummary, 'phase'>;
}

export function buildSummary(rows: BenchmarkRow[], options: BenchmarkOptions): BenchmarkSummary {
  const byPhase = (['cold', 'warm'] as const).map((phase) => buildPhaseSummary(rows, phase));
  const byColdZoomBand = (['z4-z10', 'z11-z13', 'z14-z17'] as const).map((zoomBand) =>
    buildColdZoomBandSummary(rows, zoomBand)
  );
  const unexpectedStatuses = rows.filter((row) => !isExpectedStatus(row));
  const failures = unexpectedStatuses.map((row) =>
    isUnavailablePyramidTile(row)
      ? `${row.city} ${row.z}/${row.x}/${row.y} ${row.phase} unavailable pyramid tile status=${row.status} tile_status=${row.xHuisHypeTileStatus || 'unknown'}`
      : `${row.city} ${row.z}/${row.x}/${row.y} ${row.phase} returned status ${row.status}`
  );
  const pyramidUnavailablePreconditionFailure = buildPyramidUnavailablePreconditionFailure(
    rows,
    options.baseUrl
  );
  if (pyramidUnavailablePreconditionFailure) {
    failures.push(pyramidUnavailablePreconditionFailure);
  }

  const failColdGenOverMs = options.failColdGenOverMs;
  if (failColdGenOverMs !== undefined) {
    const coldGenerationFailures = rows
      .filter((row) => row.phase === 'cold' && isExpectedStatus(row))
      .map((row) => ({
        row,
        generationMs: parseDurationMs(row.xTileGenerationTime),
      }))
      .filter(
        (entry): entry is { row: BenchmarkRow; generationMs: number } =>
          entry.generationMs !== null && entry.generationMs > failColdGenOverMs
      );

    for (const { row, generationMs } of coldGenerationFailures) {
      failures.push(
        `${row.city} ${row.z}/${row.x}/${row.y} cold generation ${generationMs.toFixed(
          1
        )}ms exceeded ${failColdGenOverMs.toFixed(1)}ms`
      );
    }
  }

  const failColdP95GenOverMs = options.failColdP95GenOverMs;
  if (failColdP95GenOverMs !== undefined) {
    const coldSummary = byPhase.find((summary) => summary.phase === 'cold');
    const coldP95 = coldSummary?.generationTimeMs.p95 ?? 0;
    const coldGenerationCount = coldSummary?.generationTimeMs.count ?? 0;
    if (coldGenerationCount === 0) {
      failures.push('No cold x-tile-generation-time values were available for p95 budget check');
    } else if (coldP95 > failColdP95GenOverMs) {
      failures.push(
        `cold p95 generation ${coldP95.toFixed(1)}ms exceeded ${failColdP95GenOverMs.toFixed(
          1
        )}ms across representative heavy tiles`
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    tiles: buildTileRequests().length,
    passes: {
      cold: 1,
      warm: options.warmPasses,
    },
    rows,
    byPhase,
    byColdZoomBand,
    unexpectedStatuses,
    failures,
  };
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

function printSummary(summary: BenchmarkSummary): void {
  console.error('');
  console.error('Summary');
  for (const phaseSummary of summary.byPhase) {
    console.error(
      `${phaseSummary.phase}: requests=${phaseSummary.requests}, ok_statuses=${
        phaseSummary.okStatuses
      }, unexpected_statuses=${phaseSummary.unexpectedStatuses}, errors=${
        phaseSummary.errors
      }, avg_client_ms=${formatMs(phaseSummary.avgClientMs)}, p50_client_ms=${formatMs(
        phaseSummary.p50ClientMs
      )}, p95_client_ms=${formatMs(phaseSummary.p95ClientMs)}, max_client_ms=${formatMs(
        phaseSummary.maxClientMs
      )}, avg_bytes=${phaseSummary.avgBytes}, gen_count=${
        phaseSummary.generationTimeMs.count
      }, p50_gen_ms=${formatMs(phaseSummary.generationTimeMs.p50)}, p95_gen_ms=${formatMs(
        phaseSummary.generationTimeMs.p95
      )}, max_gen_ms=${formatMs(phaseSummary.generationTimeMs.max)}`
    );
  }

  console.error('');
  console.error('Cold zoom bands');
  for (const bandSummary of summary.byColdZoomBand) {
    console.error(
      `${bandSummary.zoomBand}: requests=${bandSummary.requests}, ok_statuses=${
        bandSummary.okStatuses
      }, unexpected_statuses=${bandSummary.unexpectedStatuses}, errors=${
        bandSummary.errors
      }, avg_client_ms=${formatMs(bandSummary.avgClientMs)}, p50_client_ms=${formatMs(
        bandSummary.p50ClientMs
      )}, p95_client_ms=${formatMs(bandSummary.p95ClientMs)}, max_client_ms=${formatMs(
        bandSummary.maxClientMs
      )}, avg_bytes=${bandSummary.avgBytes}, gen_count=${
        bandSummary.generationTimeMs.count
      }, p50_gen_ms=${formatMs(bandSummary.generationTimeMs.p50)}, p95_gen_ms=${formatMs(
        bandSummary.generationTimeMs.p95
      )}, max_gen_ms=${formatMs(bandSummary.generationTimeMs.max)}`
    );
  }

  if (summary.unexpectedStatuses.length > 0) {
    console.error('');
    console.error('Unexpected statuses');
    for (const row of summary.unexpectedStatuses) {
      console.error(
        `${row.phase} ${row.city} ${row.z}/${row.x}/${row.y}: status=${row.status}, cache=${row.xTileCache}, tile_status=${row.xHuisHypeTileStatus || 'unknown'}`
      );
    }
  }

  if (summary.failures.length > 0) {
    console.error('');
    console.error('Failures');
    for (const failure of summary.failures) {
      console.error(`- ${failure}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const requests = buildTileRequests();
  const coldRequests = buildColdTileRequests(requests);
  const rows: BenchmarkRow[] = [];

  console.error(`Base URL: ${options.baseUrl}`);
  console.error(`Tiles: ${requests.length} (representative heavy public)`);
  console.error(`Passes: 1 cold + ${options.warmPasses} warm`);
  console.error(
    'Cold-cache method: restart the API before running; this script does not clear caches or add cache-busting query params.'
  );
  console.error('Cold request order: z14-z17, z11-z13, z4-z10.');
  console.log(CSV_COLUMNS.join(','));

  for (const request of coldRequests) {
    const row = await fetchTile(options.baseUrl, request, 'cold', options.timeoutMs);
    rows.push(row);
    console.log(rowToCsv(row));
  }

  for (let pass = 0; pass < options.warmPasses; pass += 1) {
    for (const request of requests) {
      const row = await fetchTile(options.baseUrl, request, 'warm', options.timeoutMs);
      rows.push(row);
      console.log(rowToCsv(row));
    }
  }

  const summary = buildSummary(rows, options);
  printSummary(summary);

  if (options.jsonOut) {
    await writeFile(options.jsonOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.error(`JSON summary written to ${options.jsonOut}`);
  }

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

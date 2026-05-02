import { performance } from 'node:perf_hooks';

type Phase = 'cold' | 'warm';

type TileRequest = {
  city: string;
  z: number;
  x: number;
  y: number;
};

type BenchmarkOptions = {
  baseUrl: string;
  warmPasses: number;
  timeoutMs: number;
};

type BenchmarkRow = TileRequest & {
  phase: Phase;
  status: number | 'error';
  bytes: number;
  elapsedClientMs: number;
  xTileCache: string;
  xTileGenerationTime: string;
  xTileQueueTime: string;
  xTileCoalesced: string;
  xTileBudgetMs: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_WARM_PASSES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;

const REPRESENTATIVE_HEAVY_PUBLIC_TILES: TileRequest[] = [
  { city: 'Amsterdam dense z13', z: 13, x: 4206, y: 2692 },
  { city: 'Utrecht dense z13', z: 13, x: 4212, y: 2702 },
  { city: 'Rotterdam dense z13', z: 13, x: 4197, y: 2708 },
  { city: 'Randstad country z8', z: 8, x: 131, y: 84 },
  { city: 'Amsterdam low z9', z: 9, x: 262, y: 168 },
  { city: 'Utrecht low z9', z: 9, x: 263, y: 168 },
  { city: 'Rotterdam low z9', z: 9, x: 262, y: 169 },
  { city: 'Amsterdam ghost reveal z17', z: 17, x: 67321, y: 43076 },
  { city: 'Utrecht ghost reveal z17', z: 17, x: 67400, y: 43241 },
  { city: 'Rotterdam ghost reveal z17', z: 17, x: 67166, y: 43339 },
];

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
  --help                 Show this help.

Notes:
  The benchmark uses representative heavy public tiles: dense z13
  Amsterdam/Utrecht/Rotterdam, low-zoom Randstad/city tiles, and z17
  ghost-reveal city tiles.

  The benchmark uses /tiles/properties/:z/:x/:y.pbf with no cache-busting query
  parameter. To approximate a cold server memory cache, restart the API before
  running this script. The server cache key is tile plus normalized filter
  signature, so a unique query parameter would not create a distinct server
  tile-cache key and can obscure filter semantics.`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  new URL(options.baseUrl);
  return options;
}

function buildTileRequests(): TileRequest[] {
  const seen = new Set<string>();
  return REPRESENTATIVE_HEAVY_PUBLIC_TILES.filter((tile) => {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
  const url = `${baseUrl}/tiles/properties/${request.z}/${request.x}/${request.y}.pbf`;
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
    };
  } finally {
    clearTimeout(timeout);
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function printSummary(rows: BenchmarkRow[]): void {
  console.error('');
  console.error('Summary');
  for (const phase of ['cold', 'warm'] as const) {
    const phaseRows = rows.filter((row) => row.phase === phase);
    const successfulRows = phaseRows.filter((row) => typeof row.status === 'number');
    console.error(
      `${phase}: requests=${phaseRows.length}, avg_client_ms=${average(
        successfulRows.map((row) => row.elapsedClientMs)
      ).toFixed(1)}, avg_bytes=${Math.round(average(successfulRows.map((row) => row.bytes)))}`
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const requests = buildTileRequests();
  const rows: BenchmarkRow[] = [];

  console.error(`Base URL: ${options.baseUrl}`);
  console.error(`Tiles: ${requests.length} (representative heavy public)`);
  console.error(`Passes: 1 cold + ${options.warmPasses} warm`);
  console.error(
    'Cold-cache method: restart the API before running; this script does not clear caches or add cache-busting query params.'
  );
  console.log(CSV_COLUMNS.join(','));

  for (const request of requests) {
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

  printSummary(rows);

  if (rows.some((row) => row.status === 'error')) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

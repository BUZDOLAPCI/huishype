#!/usr/bin/env node

import process from 'node:process';
import { performance } from 'node:perf_hooks';

const REPORT_HEADERS = [
  'label',
  'target',
  'phase',
  'runs',
  'status',
  'bytes',
  'min',
  'p50',
  'p95',
  'max',
  'gen p50',
  'queue p50',
  'cache last',
  'coalesced',
];

const CITY_CENTERS = [
  { city: 'amsterdam', latitude: 52.3676, longitude: 4.9041 },
  { city: 'utrecht', latitude: 52.0907, longitude: 5.1214 },
  { city: 'rotterdam', latitude: 51.9244, longitude: 4.4777 },
];

const DENSE_DYNAMIC_Z13_TILES = [
  { label: 'amsterdam-z13', z: 13, x: 4206, y: 2692 },
  { label: 'utrecht-z13', z: 13, x: 4212, y: 2702 },
  { label: 'rotterdam-z13', z: 13, x: 4197, y: 2708 },
];

const REPRESENTATIVE_HEAVY_PUBLIC_LOW_ZOOM_TILES = [
  { label: 'randstad-country-z8', z: 8, x: 131, y: 84 },
  { label: 'amsterdam-low-z9', z: 9, x: 262, y: 168 },
  { label: 'utrecht-low-z9', z: 9, x: 263, y: 168 },
  { label: 'rotterdam-low-z9', z: 9, x: 262, y: 169 },
];

const REPRESENTATIVE_HEAVY_PUBLIC_DETAIL_Z17_TILES = [
  { label: 'amsterdam-detail-z17', z: 17, x: 67321, y: 43076 },
  { label: 'utrecht-detail-z17', z: 17, x: 67400, y: 43241 },
  { label: 'rotterdam-detail-z17', z: 17, x: 67166, y: 43339 },
];

const TILE_SETS = {
  'dense-dynamic-z13': buildDenseDynamicZ13TileSet(),
  'heavy-low-zoom': buildHeavyLowZoomTileSet(),
  'representative-heavy-public': buildRepresentativeHeavyPublicTileSet(),
};

function buildDenseDynamicZ13TileSet() {
  return buildFixedTileSet(DENSE_DYNAMIC_Z13_TILES);
}

function buildFixedTileSet(tiles) {
  return tiles.map((tile) => ({
    label: tile.label,
    path: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
  }));
}

function buildRepresentativeHeavyPublicTileSet() {
  return buildFixedTileSet([
    ...DENSE_DYNAMIC_Z13_TILES,
    ...REPRESENTATIVE_HEAVY_PUBLIC_LOW_ZOOM_TILES,
    ...REPRESENTATIVE_HEAVY_PUBLIC_DETAIL_Z17_TILES,
  ]);
}

function buildHeavyLowZoomTileSet() {
  return CITY_CENTERS.flatMap((city) =>
    [8, 9].map((z) => {
      const tile = lonLatToTile(city.longitude, city.latitude, z);

      return {
        label: `${city.city}-z${z}`,
        path: `/tiles/properties/${z}/${tile.x}/${tile.y}.pbf`,
      };
    })
  );
}

function lonLatToTile(longitude, latitude, z) {
  const scale = 2 ** z;
  const latitudeRad = (latitude * Math.PI) / 180;

  return {
    x: Math.floor(((longitude + 180) / 360) * scale),
    y: Math.floor(
      ((1 -
        Math.log(Math.tan(latitudeRad) + 1 / Math.cos(latitudeRad)) / Math.PI) /
        2) *
        scale
    ),
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://127.0.0.1:3100',
    method: 'GET',
    paths: [],
    headers: {},
    coldRuns: 1,
    warmRuns: 2,
    tileSet: null,
    includeReadTiles: false,
    label: 'current',
    format: 'markdown',
    dryRun: false,
  };

  let usedLegacyRuns = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? options.baseUrl;
      continue;
    }

    if (arg === '--method') {
      options.method = (argv[++index] ?? options.method).toUpperCase();
      continue;
    }

    if (arg === '--path') {
      const path = argv[++index];
      if (!path) {
        throw new Error('--path requires a value');
      }
      options.paths.push({
        label: path,
        path,
      });
      continue;
    }

    if (arg === '--header') {
      const header = argv[++index];
      if (!header || !header.includes(':')) {
        throw new Error('--header requires name:value');
      }
      const separatorIndex = header.indexOf(':');
      const name = header.slice(0, separatorIndex).trim();
      const value = header.slice(separatorIndex + 1).trim();
      options.headers[name] = value;
      continue;
    }

    if (arg === '--runs') {
      const runs = parsePositiveInteger(argv[++index], '--runs');
      options.coldRuns = 0;
      options.warmRuns = runs;
      usedLegacyRuns = true;
      continue;
    }

    if (arg === '--cold-runs') {
      options.coldRuns = parseNonNegativeInteger(argv[++index], '--cold-runs');
      continue;
    }

    if (arg === '--warm-runs') {
      options.warmRuns = parseNonNegativeInteger(argv[++index], '--warm-runs');
      continue;
    }

    if (arg === '--tile-set') {
      const tileSet = argv[++index];
      if (!tileSet || !TILE_SETS[tileSet]) {
        throw new Error(
          `--tile-set must be one of: ${Object.keys(TILE_SETS).join(', ')}`
        );
      }
      options.tileSet = tileSet;
      continue;
    }

    if (arg === '--include-read-tiles') {
      options.includeReadTiles = true;
      continue;
    }

    if (arg === '--label') {
      const label = argv[++index];
      if (!label) {
        throw new Error('--label requires a value');
      }
      options.label = label;
      continue;
    }

    if (arg === '--format') {
      const format = argv[++index];
      if (!['json', 'markdown'].includes(format)) {
        throw new Error('--format must be json or markdown');
      }
      options.format = format;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.paths.length === 0 && !options.tileSet) {
    options.tileSet = 'dense-dynamic-z13';
  }

  if (options.coldRuns === 0 && options.warmRuns === 0) {
    throw new Error('At least one of --cold-runs or --warm-runs must be greater than 0');
  }

  if (usedLegacyRuns && options.format === 'markdown') {
    options.format = 'json';
  }

  return options;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node tools/benchmark-property-tiles.mjs

  node tools/benchmark-property-tiles.mjs \\
    --tile-set heavy-low-zoom \\
    --label before \\
    --cold-runs 1 \\
    --warm-runs 3

  node tools/benchmark-property-tiles.mjs \\
    --base-url http://127.0.0.1:3100 \\
    --path /tiles/properties/13/4220/2726.pbf \\
    --path /tiles/properties/read/13/4220/2726.pbf \\
    --header x-session-id:bench-viewer \\
    --runs 3

Options:
  --tile-set dense-dynamic-z13
                             Fixed z13 Amsterdam/Utrecht/Rotterdam property tiles.
                             This avoids default low-zoom snapshots and profiles
                             dynamic cold/warm generation in dense cities.
  --tile-set heavy-low-zoom  Fixed z8-z9 Amsterdam/Utrecht/Rotterdam property tiles.
                             These may exercise low-zoom snapshot behavior.
  --tile-set representative-heavy-public
                             Representative heavy public regression set:
                             dense z13 city tiles, low-zoom Randstad/city tiles,
                             and z17 detail city tiles.
                             Defaults to dense-dynamic-z13 when no --path is provided.
  --include-read-tiles       Also benchmark /tiles/properties/read/... for each fixed tile.
  --cold-runs N              First-request phase count per target. Default: 1.
  --warm-runs N              Repeated-request phase count per target. Default: 2.
  --runs N                   Legacy alias: run each target N times as one warm phase.
  --label NAME               Report label for before/after comparisons. Default: current.
  --format markdown|json     Report format. Default: markdown.
  --dry-run                  Print resolved targets without requesting them.
`);
}

function resolveTargets(options) {
  const fixedTargets = options.tileSet ? TILE_SETS[options.tileSet] : [];
  const targets = [...fixedTargets, ...options.paths];

  if (options.includeReadTiles) {
    return targets.flatMap((target) => [
      target,
      {
        label: `${target.label}-read`,
        path: target.path.replace('/tiles/properties/', '/tiles/properties/read/'),
      },
    ]);
  }

  return targets;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function numberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function runRequest(baseUrl, target, method, headers, phase, runIndex) {
  const startedAt = performance.now();
  const response = await fetch(new URL(target.path, baseUrl), {
    method,
    headers,
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  const durationMs = performance.now() - startedAt;
  const generationMs = numberOrNull(response.headers.get('x-tile-generation-time'));
  const queueMs = numberOrNull(response.headers.get('x-tile-queue-time'));

  return {
    target: target.label,
    path: target.path,
    phase,
    run: runIndex + 1,
    status: response.status,
    bytes,
    durationMs,
    headers: {
      xTileCache: response.headers.get('x-tile-cache'),
      xTileGenerationTime: response.headers.get('x-tile-generation-time'),
      xTileCoalesced: response.headers.get('x-tile-coalesced'),
      xTileQueueTime: response.headers.get('x-tile-queue-time'),
      cacheControl: response.headers.get('cache-control'),
    },
    generationMs,
    queueMs,
  };
}

async function runPhase(options, target, phase, runs) {
  const samples = [];

  for (let run = 0; run < runs; run += 1) {
    samples.push(
      await runRequest(options.baseUrl, target, options.method, options.headers, phase, run)
    );
  }

  return summarizeSamples(options.label, target, phase, samples);
}

function summarizeSamples(label, target, phase, samples) {
  const durations = sortedMetric(samples, 'durationMs');
  const generations = sortedNullableMetric(samples, 'generationMs');
  const queues = sortedNullableMetric(samples, 'queueMs');
  const last = samples[samples.length - 1];

  return {
    label,
    target: target.label,
    path: target.path,
    phase,
    runs: samples.length,
    status: last?.status ?? null,
    bytes: last?.bytes ?? null,
    minMs: round(durations[0]),
    p50Ms: round(percentile(durations, 50)),
    p95Ms: round(percentile(durations, 95)),
    maxMs: round(durations[durations.length - 1]),
    generationP50Ms: generations.length > 0 ? round(percentile(generations, 50)) : null,
    queueP50Ms: queues.length > 0 ? round(percentile(queues, 50)) : null,
    cacheLast: last?.headers.xTileCache ?? null,
    coalescedLast: last?.headers.xTileCoalesced ?? null,
    samples,
  };
}

function sortedMetric(samples, key) {
  return samples.map((sample) => sample[key]).sort((left, right) => left - right);
}

function sortedNullableMetric(samples, key) {
  return samples
    .map((sample) => sample[key])
    .filter((value) => value != null)
    .sort((left, right) => left - right);
}

function round(value) {
  return value == null ? null : Number(value.toFixed(1));
}

function printDryRun(options, targets) {
  console.log(`# Property Tile Benchmark Dry Run`);
  console.log(`baseUrl: ${options.baseUrl}`);
  console.log(`method: ${options.method}`);
  console.log(`coldRuns: ${options.coldRuns}`);
  console.log(`warmRuns: ${options.warmRuns}`);
  console.log(`targets:`);

  for (const target of targets) {
    console.log(`- ${target.label}: ${target.path}`);
  }
}

function printMarkdown(summaries) {
  console.log(REPORT_HEADERS.join(' | '));
  console.log(REPORT_HEADERS.map(() => '---').join(' | '));

  for (const summary of summaries) {
    console.log(
      [
        summary.label,
        summary.target,
        summary.phase,
        summary.runs,
        summary.status,
        summary.bytes,
        formatMs(summary.minMs),
        formatMs(summary.p50Ms),
        formatMs(summary.p95Ms),
        formatMs(summary.maxMs),
        formatMs(summary.generationP50Ms),
        formatMs(summary.queueP50Ms),
        summary.cacheLast ?? '',
        summary.coalescedLast ?? '',
      ].join(' | ')
    );
  }
}

function formatMs(value) {
  return value == null ? '' : `${value}ms`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(options);

  if (targets.length === 0) {
    throw new Error('At least one --path or --tile-set target is required');
  }

  if (options.dryRun) {
    printDryRun(options, targets);
    return;
  }

  const summaries = [];

  for (const target of targets) {
    if (options.coldRuns > 0) {
      summaries.push(await runPhase(options, target, 'cold', options.coldRuns));
    }

    if (options.warmRuns > 0) {
      summaries.push(await runPhase(options, target, 'warm', options.warmRuns));
    }
  }

  if (options.format === 'json') {
    for (const summary of summaries) {
      console.log(JSON.stringify(summary));
    }
    return;
  }

  printMarkdown(summaries);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

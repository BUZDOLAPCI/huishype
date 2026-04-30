#!/usr/bin/env node

import process from 'node:process';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://127.0.0.1:3100',
    method: 'GET',
    paths: [],
    headers: {},
    runs: 1,
  };

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
      options.paths.push(path);
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
      const runs = Number.parseInt(argv[++index] ?? '', 10);
      if (!Number.isInteger(runs) || runs <= 0) {
        throw new Error('--runs must be a positive integer');
      }
      options.runs = runs;
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.paths.length === 0) {
    throw new Error('At least one --path is required');
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/benchmark-property-tiles.mjs \\
    --base-url http://127.0.0.1:3100 \\
    --path /tiles/public_property_nodes/13/4220/2726 \\
    --path /tiles/private_read_property_nodes/13/4220/2726?tile_session=TOKEN \\
    --header x-session-id:bench-viewer \\
    --runs 3
`);
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

async function runRequest(baseUrl, path, method, headers) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  const durationMs = performance.now() - startedAt;

  return {
    status: response.status,
    bytes,
    durationMs,
    generationHeader: response.headers.get('x-tile-generation-time'),
    cacheHeader: response.headers.get('x-tile-cache'),
    cacheControl: response.headers.get('cache-control'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  for (const path of options.paths) {
    const results = [];

    for (let run = 0; run < options.runs; run += 1) {
      results.push(await runRequest(options.baseUrl, path, options.method, options.headers));
    }

    const durations = results
      .map((result) => result.durationMs)
      .sort((left, right) => left - right);
    const last = results[results.length - 1];

    console.log(
      JSON.stringify({
        path,
        runs: options.runs,
        status: last.status,
        bytes: last.bytes,
        minMs: Number(durations[0].toFixed(1)),
        p50Ms: Number(percentile(durations, 50).toFixed(1)),
        p95Ms: Number(percentile(durations, 95).toFixed(1)),
        maxMs: Number(durations[durations.length - 1].toFixed(1)),
        generationHeader: last.generationHeader,
        cacheHeader: last.cacheHeader,
        cacheControl: last.cacheControl,
      })
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

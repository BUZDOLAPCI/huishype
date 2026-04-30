#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.MARTIN_BASE_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
const iterations = Number(process.env.MARTIN_BENCH_ITERATIONS || 20);
const warmups = Number(process.env.MARTIN_BENCH_WARMUPS || 3);
const timeoutMs = Number(process.env.MARTIN_BENCH_TIMEOUT_MS || 10000);

const defaultPaths = [
  '/tiles/public_property_nodes/13/4207/2692',
  '/tiles/buildings/15/16892/10898',
  '/tiles/trees/15/16892/10898',
  '/tiles/private_read_property_nodes/13/4207/2692',
  '/tiles/private_following_property_nodes/13/4207/2692',
];

const paths = (process.env.MARTIN_BENCH_PATHS || defaultPaths.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (paths.some((path) => path.includes('.pbf'))) {
  throw new Error('Benchmark paths must use Martin extensionless tile routes, not .pbf URLs.');
}

const fetchOnce = async (path) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/x-protobuf,*/*' },
    });
    const body = await response.arrayBuffer();
    const durationMs = performance.now() - startedAt;
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`${path} redirected with ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`${path} failed ${response.status} ${response.statusText}`);
    }
    return {
      durationMs,
      bytes: body.byteLength,
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
};

const results = [];

for (const path of paths) {
  for (let i = 0; i < warmups; i += 1) {
    await fetchOnce(path);
  }

  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    samples.push(await fetchOnce(path));
  }

  const durations = samples.map((sample) => sample.durationMs);
  const bytes = samples.map((sample) => sample.bytes);
  results.push({
    path,
    iterations,
    minMs: Math.min(...durations),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: Math.max(...durations),
    minBytes: Math.min(...bytes),
    maxBytes: Math.max(...bytes),
  });
}

console.table(
  results.map((result) => ({
    path: result.path,
    iterations: result.iterations,
    minMs: result.minMs.toFixed(1),
    p50Ms: result.p50Ms.toFixed(1),
    p95Ms: result.p95Ms.toFixed(1),
    maxMs: result.maxMs.toFixed(1),
    minBytes: result.minBytes,
    maxBytes: result.maxBytes,
  })),
);

console.log(JSON.stringify({ baseUrl, results }, null, 2));

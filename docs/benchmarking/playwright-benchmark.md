# Playwright Benchmark Harness

Run the web benchmark from the repo root:

```bash
pnpm test:e2e:benchmark
```

The harness uses the shared root Playwright wrapper and the dedicated `benchmark`
project. It benchmarks two fixed routes with repeated cold-browser runs:

- `/map/eindhoven/5651ha/beeldbuisring/41`
- `/feed`

Default execution uses `1` warmup run and `5` measured runs per route. Each
sample uses a fresh browser context so route state and browser cache do not leak
between samples.

Useful controls:

```bash
BENCHMARK_LABEL=before \
BENCHMARK_WARMUP_RUNS=1 \
BENCHMARK_MEASURED_RUNS=5 \
pnpm test:e2e:benchmark
```

Each run writes timestamped and `latest-*` artifacts under `test-results/benchmark/`:

- JSON with raw metrics and run metadata
- Markdown summary with medians and min/max ranges

Captured metrics:

- navigation timing for the map route and feed route
- time to first usable map
- scripted map pan and zoom settle latency
- total request counts and bytes
- tile request counts, duplicate ratio, and `x-tile-cache` / `x-tile-generation-time`
- grouped route-critical `fetch`/`xhr` request timings and payload bytes
- feed render timing and scripted scroll frame stats

For a light validation without executing the full benchmark flow:

```bash
pnpm test:e2e:benchmark -- --list
```

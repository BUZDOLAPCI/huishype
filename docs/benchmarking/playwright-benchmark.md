# Playwright Benchmark Harness

Run the web benchmark from the repo root:

```bash
pnpm test:e2e:benchmark
```

The harness uses the shared root Playwright wrapper and the dedicated `benchmark`
project. It benchmarks fixed map and feed routes with repeated cold and warm
cache runs:

- `/@52.114544,4.9239009,7.95z`
- `/@52.3626765,5.3574841,6.29z`
- `/@52.1247641,5.0314279,4.98z`
- `/@51.0394976,4.4103663,3.92z`
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
- feed post-ready scroll settle timing before synthetic scroll starts
- main-thread long-task count, duration, and blocking time where supported by the browser
- gated web render probe counts for the map and feed surfaces during benchmark runs

Feed scroll measurement waits for the feed route to reach its ready state, then
uses a bounded browser quiet check before starting the synthetic scroll:
Playwright `networkidle` first waits for pending fetches to settle, and an
in-page quiet check waits for stable feed geometry plus a short long-task quiet
window. If `networkidle` is noisy, the harness records a timeout and falls back
to the in-page quiet check instead of using an unbounded or fixed sleep.

Render probes report React commit counts and first/last commit timestamps only.
Intervals between commits are intentionally not summarized as render cost:
removing an unrelated request or commit can increase the gap between remaining
commits without making rendering slower. Use long-task and frame metrics for
render-cost regression analysis.

For a light validation without executing the full benchmark flow:

```bash
pnpm test:e2e:harness
```

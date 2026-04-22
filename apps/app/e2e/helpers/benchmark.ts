import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BENCHMARK_RESULT_DIR = path.join(
  process.env.BENCHMARK_RESULT_DIR || 'test-results/benchmark',
);
export const BENCHMARK_ROUTES = {
  map: '/map/eindhoven/5651ha/beeldbuisring/41',
  feed: '/feed',
} as const;

const VOLATILE_QUERY_KEYS = new Set(['access_token', 'token', 'ts', 'timestamp']);

export type RouteKey = keyof typeof BENCHMARK_ROUTES;

export type RequestMetric = {
  url: string;
  normalizedUrl: string;
  normalizedEndpoint: string;
  method: string;
  resourceType: string;
  status: number | null;
  ok: boolean;
  failed: boolean;
  durationMs: number;
  responseBytes: number | null;
  startedAt: string;
  headers: {
    age: string | null;
    cacheControl: string | null;
    contentLength: string | null;
    xTileCache: string | null;
    xTileGenerationTime: string | null;
  };
};

export type TileRequestSummary = {
  totalRequests: number;
  duplicateRequestCount: number;
  duplicateRequestKeys: string[];
  payloadBytes: {
    total: number;
    withKnownSize: number;
    unknownSizeCount: number;
  };
  xTileGenerationTimeMs: {
    count: number;
    min: number | null;
    max: number | null;
    avg: number | null;
    sum: number;
  };
  xTileCache: Record<string, number>;
};

export type FeedScrollSummary = {
  durationMs: number;
  totalFrames: number;
  longFrameCount: number;
  worstFrameMs: number | null;
  averageFrameMs: number | null;
};

export type RouteBenchmarkSample = {
  route: string;
  navigation: {
    gotoMs: number;
    domContentLoadedMs: number | null;
    loadEventMs: number | null;
    firstContentfulPaintMs: number | null;
  };
  requests: {
    total: number;
    byResourceType: Record<string, number>;
    failed: number;
    payloadBytes: {
      total: number;
      withKnownSize: number;
      unknownSizeCount: number;
    };
  };
  tiles: TileRequestSummary;
  criticalRequests: RequestGroupSummary[];
  consoleErrors: string[];
  map?: {
    usableMs: number;
    settle: {
      panMs: number;
      zoomMs: number;
    };
  };
  feed?: {
    renderMs: number;
    itemCount: number;
    state: 'cards' | 'empty' | 'error' | 'unknown';
    scroll?: FeedScrollSummary;
  };
};

export type NumberSummary = {
  avg: number | null;
  max: number | null;
  median: number | null;
  min: number | null;
  sampleCount: number;
};

export type RequestGroupSummary = {
  key: string;
  requestCount: number;
  failedCount: number;
  durationMs: NumberSummary;
  payloadBytes: {
    total: number;
    knownResponseCount: number;
    unknownSizeCount: number;
  };
  statuses: Record<string, number>;
  cacheControl: Record<string, number>;
  age: Record<string, number>;
};

export type RouteBenchmarkResult = {
  route: string;
  warmupRuns: number;
  measuredRuns: number;
  samples: RouteBenchmarkSample[];
  summary: {
    navigation: {
      gotoMs: NumberSummary;
      domContentLoadedMs: NumberSummary;
      loadEventMs: NumberSummary;
      firstContentfulPaintMs: NumberSummary;
    };
    requests: {
      total: NumberSummary;
      failed: NumberSummary;
      payloadTotalBytes: NumberSummary;
      byResourceType: Record<string, number>;
    };
    tiles: {
      totalRequests: NumberSummary;
      duplicateRequestCount: NumberSummary;
      duplicateRequestRatio: NumberSummary;
      payloadTotalBytes: NumberSummary;
      xTileGenerationTimeAvgMs: NumberSummary;
      xTileCache: Record<string, number>;
    };
    consoleErrorsPerRun: NumberSummary;
    criticalRequests: RequestGroupSummary[];
    map?: {
      usableMs: NumberSummary;
      settlePanMs: NumberSummary;
      settleZoomMs: NumberSummary;
    };
    feed?: {
      renderMs: NumberSummary;
      itemCount: NumberSummary;
      states: Record<string, number>;
      scroll?: {
        durationMs: NumberSummary;
        totalFrames: NumberSummary;
        longFrameCount: NumberSummary;
        worstFrameMs: NumberSummary;
        averageFrameMs: NumberSummary;
      };
    };
  };
};

export type BenchmarkRun = {
  metadata: {
    benchmarkLabel: string | null;
    command: string;
    dirtyTree: boolean;
    generatedAt: string;
    gitHead: string | null;
    hostname: string;
    measuredRuns: number;
    warmupRuns: number;
  };
  routes: Record<RouteKey, RouteBenchmarkResult>;
};

export function getBenchmarkWarmupRuns(): number {
  return parsePositiveInteger(process.env.BENCHMARK_WARMUP_RUNS, 1);
}

export function getBenchmarkMeasuredRuns(): number {
  return parsePositiveInteger(process.env.BENCHMARK_MEASURED_RUNS, 5);
}

export function getBenchmarkResultDir(): string {
  return BENCHMARK_RESULT_DIR;
}

export async function ensureBenchmarkResultDir(): Promise<string> {
  await mkdir(BENCHMARK_RESULT_DIR, { recursive: true });
  return BENCHMARK_RESULT_DIR;
}

export function captureGitMetadata(): BenchmarkRun['metadata'] {
  const safeExec = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };

  const status = safeExec(['status', '--porcelain']);

  return {
    benchmarkLabel: process.env.BENCHMARK_LABEL || null,
    command: 'pnpm test:e2e:benchmark',
    dirtyTree: Boolean(status),
    generatedAt: new Date().toISOString(),
    gitHead: safeExec(['rev-parse', 'HEAD']),
    hostname: process.env.HOSTNAME || 'unknown',
    measuredRuns: getBenchmarkMeasuredRuns(),
    warmupRuns: getBenchmarkWarmupRuns(),
  };
}

export function normalizeTileUrl(rawUrl: string): string {
  return normalizeUrl(rawUrl, VOLATILE_QUERY_KEYS);
}

export function normalizeEndpointUrl(rawUrl: string): string {
  return normalizeUrl(rawUrl, new Set([...VOLATILE_QUERY_KEYS, 'cursor']));
}

function normalizeUrl(rawUrl: string, volatileKeys: Set<string>): string {
  try {
    const url = new URL(rawUrl);
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !volatileKeys.has(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyCompare = leftKey.localeCompare(rightKey);
        return keyCompare !== 0 ? keyCompare : leftValue.localeCompare(rightValue);
      });
    const query = params.length > 0
      ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}`
      : '';
    return `${url.pathname}${query}`;
  } catch {
    return rawUrl;
  }
}

export function isTileRequest(url: string): boolean {
  return /(?:\/tiles?\/|[./](?:mvt|pbf|vector)(?:$|\?))/i.test(url);
}

export function isCriticalRequest(request: RequestMetric): boolean {
  return (
    !isTileRequest(request.url) &&
    (request.resourceType === 'fetch' || request.resourceType === 'xhr')
  );
}

export function summarizeRequests(requests: RequestMetric[]): RouteBenchmarkSample['requests'] {
  const byResourceType: Record<string, number> = {};
  let failed = 0;
  let totalBytes = 0;
  let withKnownSize = 0;
  let unknownSizeCount = 0;

  for (const request of requests) {
    byResourceType[request.resourceType] = (byResourceType[request.resourceType] || 0) + 1;
    if (request.failed || (request.status !== null && request.status >= 400)) {
      failed += 1;
    }

    if (request.responseBytes == null) {
      unknownSizeCount += 1;
    } else {
      withKnownSize += 1;
      totalBytes += request.responseBytes;
    }
  }

  return {
    total: requests.length,
    byResourceType,
    failed,
    payloadBytes: {
      total: totalBytes,
      withKnownSize,
      unknownSizeCount,
    },
  };
}

export function summarizeTileRequests(requests: RequestMetric[]): TileRequestSummary {
  const tileRequests = requests.filter((request) => isTileRequest(request.url));
  const duplicates = new Map<string, number>();
  const xTileCache: Record<string, number> = {};
  let totalBytes = 0;
  let withKnownSize = 0;
  let unknownSizeCount = 0;
  let sumGenerationTime = 0;
  let generationTimeCount = 0;
  let minGenerationTime = Number.POSITIVE_INFINITY;
  let maxGenerationTime = Number.NEGATIVE_INFINITY;

  for (const request of tileRequests) {
    duplicates.set(request.normalizedUrl, (duplicates.get(request.normalizedUrl) || 0) + 1);

    if (request.responseBytes == null) {
      unknownSizeCount += 1;
    } else {
      withKnownSize += 1;
      totalBytes += request.responseBytes;
    }

    const tileCache = request.headers.xTileCache;
    if (tileCache) {
      xTileCache[tileCache] = (xTileCache[tileCache] || 0) + 1;
    }

    const generationTimeRaw = request.headers.xTileGenerationTime;
    if (generationTimeRaw) {
      const value = Number.parseFloat(generationTimeRaw);
      if (Number.isFinite(value)) {
        generationTimeCount += 1;
        sumGenerationTime += value;
        minGenerationTime = Math.min(minGenerationTime, value);
        maxGenerationTime = Math.max(maxGenerationTime, value);
      }
    }
  }

  const duplicateRequestKeys = [...duplicates.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const duplicateRequestCount = [...duplicates.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );

  return {
    totalRequests: tileRequests.length,
    duplicateRequestCount,
    duplicateRequestKeys,
    payloadBytes: {
      total: totalBytes,
      withKnownSize,
      unknownSizeCount,
    },
    xTileGenerationTimeMs: {
      count: generationTimeCount,
      min: generationTimeCount > 0 ? minGenerationTime : null,
      max: generationTimeCount > 0 ? maxGenerationTime : null,
      avg: generationTimeCount > 0 ? sumGenerationTime / generationTimeCount : null,
      sum: sumGenerationTime,
    },
    xTileCache,
  };
}

export function summarizeCriticalRequests(requests: RequestMetric[]): RequestGroupSummary[] {
  const grouped = new Map<string, RequestMetric[]>();

  for (const request of requests) {
    if (!isCriticalRequest(request)) {
      continue;
    }

    const key = `${request.method} ${request.normalizedEndpoint}`;
    const group = grouped.get(key);
    if (group) {
      group.push(request);
    } else {
      grouped.set(key, [request]);
    }
  }

  return [...grouped.entries()]
    .map(([key, group]) => summarizeRequestGroup(key, group))
    .sort((left, right) => {
      const durationDelta = (right.durationMs.median || 0) - (left.durationMs.median || 0);
      if (durationDelta !== 0) {
        return durationDelta;
      }
      return right.requestCount - left.requestCount;
    });
}

function summarizeRequestGroup(key: string, group: RequestMetric[]): RequestGroupSummary {
  const statusCounts: Record<string, number> = {};
  const cacheControl: Record<string, number> = {};
  const age: Record<string, number> = {};
  const durations: number[] = [];
  let failedCount = 0;
  let knownResponseCount = 0;
  let totalBytes = 0;
  let unknownSizeCount = 0;

  for (const request of group) {
    if (Number.isFinite(request.durationMs) && request.durationMs >= 0) {
      durations.push(request.durationMs);
    }

    if (request.failed || (request.status !== null && request.status >= 400)) {
      failedCount += 1;
    }

    statusCounts[String(request.status ?? 'null')] = (statusCounts[String(request.status ?? 'null')] || 0) + 1;

    if (request.responseBytes == null) {
      unknownSizeCount += 1;
    } else {
      knownResponseCount += 1;
      totalBytes += request.responseBytes;
    }

    const cacheControlValue = request.headers.cacheControl || 'none';
    cacheControl[cacheControlValue] = (cacheControl[cacheControlValue] || 0) + 1;

    const ageValue = request.headers.age || 'none';
    age[ageValue] = (age[ageValue] || 0) + 1;
  }

  return {
    key,
    requestCount: group.length,
    failedCount,
    durationMs: summarizeNumbers(durations),
    payloadBytes: {
      total: totalBytes,
      knownResponseCount,
      unknownSizeCount,
    },
    statuses: statusCounts,
    cacheControl,
    age,
  };
}

export function aggregateRouteBenchmark(
  route: string,
  samples: RouteBenchmarkSample[],
  warmupRuns: number,
  measuredRuns: number,
): RouteBenchmarkResult {
  const mergedResourceTypes: Record<string, number> = {};
  const mergedTileCache: Record<string, number> = {};
  const mergedFeedStates: Record<string, number> = {};
  const allCriticalRequests = new Map<string, RequestGroupSummary[]>();

  for (const sample of samples) {
    for (const [resourceType, count] of Object.entries(sample.requests.byResourceType)) {
      mergedResourceTypes[resourceType] = (mergedResourceTypes[resourceType] || 0) + count;
    }

    for (const [key, count] of Object.entries(sample.tiles.xTileCache)) {
      mergedTileCache[key] = (mergedTileCache[key] || 0) + count;
    }

    if (sample.feed) {
      mergedFeedStates[sample.feed.state] = (mergedFeedStates[sample.feed.state] || 0) + 1;
    }

    for (const requestGroup of sample.criticalRequests) {
      const groups = allCriticalRequests.get(requestGroup.key);
      if (groups) {
        groups.push(requestGroup);
      } else {
        allCriticalRequests.set(requestGroup.key, [requestGroup]);
      }
    }
  }

  const aggregatedCriticalRequests = [...allCriticalRequests.entries()]
    .map(([key, groups]) => aggregateRequestGroups(key, groups))
    .sort((left, right) => {
      const durationDelta = (right.durationMs.median || 0) - (left.durationMs.median || 0);
      if (durationDelta !== 0) {
        return durationDelta;
      }
      return right.requestCount - left.requestCount;
    });

  const summary: RouteBenchmarkResult['summary'] = {
    navigation: {
      gotoMs: summarizeNumbers(samples.map((sample) => sample.navigation.gotoMs)),
      domContentLoadedMs: summarizeNumbers(samples.map((sample) => sample.navigation.domContentLoadedMs)),
      loadEventMs: summarizeNumbers(samples.map((sample) => sample.navigation.loadEventMs)),
      firstContentfulPaintMs: summarizeNumbers(samples.map((sample) => sample.navigation.firstContentfulPaintMs)),
    },
    requests: {
      total: summarizeNumbers(samples.map((sample) => sample.requests.total)),
      failed: summarizeNumbers(samples.map((sample) => sample.requests.failed)),
      payloadTotalBytes: summarizeNumbers(samples.map((sample) => sample.requests.payloadBytes.total)),
      byResourceType: mergedResourceTypes,
    },
    tiles: {
      totalRequests: summarizeNumbers(samples.map((sample) => sample.tiles.totalRequests)),
      duplicateRequestCount: summarizeNumbers(samples.map((sample) => sample.tiles.duplicateRequestCount)),
      duplicateRequestRatio: summarizeNumbers(
        samples.map((sample) => {
          if (sample.tiles.totalRequests === 0) {
            return 0;
          }
          return sample.tiles.duplicateRequestCount / sample.tiles.totalRequests;
        }),
      ),
      payloadTotalBytes: summarizeNumbers(samples.map((sample) => sample.tiles.payloadBytes.total)),
      xTileGenerationTimeAvgMs: summarizeNumbers(samples.map((sample) => sample.tiles.xTileGenerationTimeMs.avg)),
      xTileCache: mergedTileCache,
    },
    consoleErrorsPerRun: summarizeNumbers(samples.map((sample) => sample.consoleErrors.length)),
    criticalRequests: aggregatedCriticalRequests,
  };

  const mapSamples = samples.filter((sample): sample is RouteBenchmarkSample & { map: NonNullable<RouteBenchmarkSample['map']> } => Boolean(sample.map));
  if (mapSamples.length > 0) {
    summary.map = {
      usableMs: summarizeNumbers(mapSamples.map((sample) => sample.map.usableMs)),
      settlePanMs: summarizeNumbers(mapSamples.map((sample) => sample.map.settle.panMs)),
      settleZoomMs: summarizeNumbers(mapSamples.map((sample) => sample.map.settle.zoomMs)),
    };
  }

  const feedSamples = samples.filter((sample): sample is RouteBenchmarkSample & { feed: NonNullable<RouteBenchmarkSample['feed']> } => Boolean(sample.feed));
  if (feedSamples.length > 0) {
    summary.feed = {
      renderMs: summarizeNumbers(feedSamples.map((sample) => sample.feed.renderMs)),
      itemCount: summarizeNumbers(feedSamples.map((sample) => sample.feed.itemCount)),
      states: mergedFeedStates,
    };

    const scrollSamples = feedSamples.filter(
      (sample): sample is RouteBenchmarkSample & { feed: RouteBenchmarkSample['feed'] & { scroll: NonNullable<NonNullable<RouteBenchmarkSample['feed']>['scroll']> } } =>
        Boolean(sample.feed.scroll),
    );
    if (scrollSamples.length > 0) {
      summary.feed.scroll = {
        durationMs: summarizeNumbers(scrollSamples.map((sample) => sample.feed.scroll.durationMs)),
        totalFrames: summarizeNumbers(scrollSamples.map((sample) => sample.feed.scroll.totalFrames)),
        longFrameCount: summarizeNumbers(scrollSamples.map((sample) => sample.feed.scroll.longFrameCount)),
        worstFrameMs: summarizeNumbers(scrollSamples.map((sample) => sample.feed.scroll.worstFrameMs)),
        averageFrameMs: summarizeNumbers(scrollSamples.map((sample) => sample.feed.scroll.averageFrameMs)),
      };
    }
  }

  return {
    route,
    warmupRuns,
    measuredRuns,
    samples,
    summary,
  };
}

function aggregateRequestGroups(key: string, groups: RequestGroupSummary[]): RequestGroupSummary {
  const statuses: Record<string, number> = {};
  const cacheControl: Record<string, number> = {};
  const age: Record<string, number> = {};

  for (const group of groups) {
    mergeCounts(statuses, group.statuses);
    mergeCounts(cacheControl, group.cacheControl);
    mergeCounts(age, group.age);
  }

  return {
    key,
    requestCount: groups.reduce((sum, group) => sum + group.requestCount, 0),
    failedCount: groups.reduce((sum, group) => sum + group.failedCount, 0),
    durationMs: summarizeNumbers(groups.map((group) => group.durationMs.median)),
    payloadBytes: {
      total: groups.reduce((sum, group) => sum + group.payloadBytes.total, 0),
      knownResponseCount: groups.reduce((sum, group) => sum + group.payloadBytes.knownResponseCount, 0),
      unknownSizeCount: groups.reduce((sum, group) => sum + group.payloadBytes.unknownSizeCount, 0),
    },
    statuses,
    cacheControl,
    age,
  };
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

export async function writeBenchmarkArtifacts(
  baseName: string,
  benchmarkRun: BenchmarkRun,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const resultDir = await ensureBenchmarkResultDir();
  const timestamp = benchmarkRun.metadata.generatedAt
    .replaceAll(':', '-')
    .replaceAll('.', '-');
  const labelSuffix = benchmarkRun.metadata.benchmarkLabel
    ? `-${benchmarkRun.metadata.benchmarkLabel}`
    : '';
  const jsonName = `${timestamp}-${baseName}${labelSuffix}.json`;
  const markdownName = `${timestamp}-${baseName}${labelSuffix}.md`;
  const latestJsonName = `latest-${baseName}${labelSuffix}.json`;
  const latestMarkdownName = `latest-${baseName}${labelSuffix}.md`;
  const jsonPath = path.join(resultDir, jsonName);
  const markdownPath = path.join(resultDir, markdownName);
  const jsonContents = `${JSON.stringify(benchmarkRun, null, 2)}\n`;
  const markdownContents = renderBenchmarkMarkdown(benchmarkRun);

  await writeFile(jsonPath, jsonContents, 'utf8');
  await writeFile(markdownPath, markdownContents, 'utf8');
  await writeFile(path.join(resultDir, latestJsonName), jsonContents, 'utf8');
  await writeFile(path.join(resultDir, latestMarkdownName), markdownContents, 'utf8');

  return { jsonPath, markdownPath };
}

function renderBenchmarkMarkdown(benchmarkRun: BenchmarkRun): string {
  const lines: string[] = [
    '# Web Performance Benchmark',
    '',
    `Generated: ${benchmarkRun.metadata.generatedAt}`,
    `Benchmark label: ${benchmarkRun.metadata.benchmarkLabel ?? 'none'}`,
    `Dirty tree: ${benchmarkRun.metadata.dirtyTree ? 'yes' : 'no'}`,
    `Git head: ${benchmarkRun.metadata.gitHead ?? 'unknown'}`,
    `Host: ${benchmarkRun.metadata.hostname}`,
    `Command: ${benchmarkRun.metadata.command}`,
    `Warmup runs: ${benchmarkRun.metadata.warmupRuns}`,
    `Measured runs: ${benchmarkRun.metadata.measuredRuns}`,
    '',
  ];

  for (const [routeKey, route] of Object.entries(benchmarkRun.routes) as [RouteKey, RouteBenchmarkResult][]) {
    lines.push(`## ${routeKey} (${route.route})`);
    lines.push('');
    lines.push(`- goto median: ${formatSummaryMs(route.summary.navigation.gotoMs)}`);
    lines.push(`- domContentLoaded median: ${formatSummaryMs(route.summary.navigation.domContentLoadedMs)}`);
    lines.push(`- loadEvent median: ${formatSummaryMs(route.summary.navigation.loadEventMs)}`);
    lines.push(`- firstContentfulPaint median: ${formatSummaryMs(route.summary.navigation.firstContentfulPaintMs)}`);
    lines.push(`- requests median: ${formatSummaryNumber(route.summary.requests.total)}`);
    lines.push(`- failed requests median: ${formatSummaryNumber(route.summary.requests.failed)}`);
    lines.push(`- request bytes median: ${formatSummaryBytes(route.summary.requests.payloadTotalBytes)}`);
    lines.push(`- tile requests median: ${formatSummaryNumber(route.summary.tiles.totalRequests)}`);
    lines.push(`- duplicate tile requests median: ${formatSummaryNumber(route.summary.tiles.duplicateRequestCount)}`);
    lines.push(`- duplicate tile ratio median: ${formatPercent(route.summary.tiles.duplicateRequestRatio.median)}`);
    lines.push(`- tile generation avg median: ${formatSummaryMs(route.summary.tiles.xTileGenerationTimeAvgMs)}`);
    lines.push(`- tile cache headers: ${formatRecord(route.summary.tiles.xTileCache)}`);
    lines.push(`- console errors per run median: ${formatSummaryNumber(route.summary.consoleErrorsPerRun)}`);

    if (route.summary.map) {
      lines.push(`- map usable median: ${formatSummaryMs(route.summary.map.usableMs)}`);
      lines.push(`- map settle pan median: ${formatSummaryMs(route.summary.map.settlePanMs)}`);
      lines.push(`- map settle zoom median: ${formatSummaryMs(route.summary.map.settleZoomMs)}`);
    }

    if (route.summary.feed) {
      lines.push(`- feed render median: ${formatSummaryMs(route.summary.feed.renderMs)}`);
      lines.push(`- feed items median: ${formatSummaryNumber(route.summary.feed.itemCount)}`);
      lines.push(`- feed states: ${formatRecord(route.summary.feed.states)}`);
      if (route.summary.feed.scroll) {
        lines.push(`- feed scroll duration median: ${formatSummaryMs(route.summary.feed.scroll.durationMs)}`);
        lines.push(`- feed scroll frames median: ${formatSummaryNumber(route.summary.feed.scroll.totalFrames)}`);
        lines.push(`- feed long frames median: ${formatSummaryNumber(route.summary.feed.scroll.longFrameCount)}`);
        lines.push(`- feed worst frame median: ${formatSummaryMs(route.summary.feed.scroll.worstFrameMs)}`);
      }
    }

    if (route.summary.criticalRequests.length > 0) {
      lines.push('- critical requests:');
      for (const request of route.summary.criticalRequests.slice(0, 6)) {
        lines.push(
          `  - ${request.key}: duration median ${formatSummaryMs(request.durationMs)}, count ${request.requestCount}, payload ${formatBytes(request.payloadBytes.total)}, cache-control ${formatRecord(request.cacheControl)}`,
        );
      }
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function summarizeNumbers(values: Array<number | null | undefined>): NumberSummary {
  const filtered = values
    .filter((value): value is number => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (filtered.length === 0) {
    return {
      avg: null,
      max: null,
      median: null,
      min: null,
      sampleCount: 0,
    };
  }

  const sum = filtered.reduce((total, value) => total + value, 0);
  const middleIndex = Math.floor(filtered.length / 2);
  const median = filtered.length % 2 === 0
    ? (filtered[middleIndex - 1] + filtered[middleIndex]) / 2
    : filtered[middleIndex];

  return {
    avg: sum / filtered.length,
    max: filtered[filtered.length - 1],
    median,
    min: filtered[0],
    sampleCount: filtered.length,
  };
}

function formatSummaryMs(summary: NumberSummary): string {
  if (summary.sampleCount === 0 || summary.median == null) {
    return 'n/a';
  }

  return `${summary.median.toFixed(1)} ms (min ${summary.min?.toFixed(1)}, max ${summary.max?.toFixed(1)}, n=${summary.sampleCount})`;
}

function formatSummaryNumber(summary: NumberSummary): string {
  if (summary.sampleCount === 0 || summary.median == null) {
    return 'n/a';
  }

  return `${summary.median.toFixed(1)} (min ${summary.min?.toFixed(1)}, max ${summary.max?.toFixed(1)}, n=${summary.sampleCount})`;
}

function formatSummaryBytes(summary: NumberSummary): string {
  if (summary.sampleCount === 0 || summary.median == null) {
    return 'n/a';
  }

  return `${formatBytes(summary.median)} (min ${formatBytes(summary.min || 0)}, max ${formatBytes(summary.max || 0)}, n=${summary.sampleCount})`;
}

function formatPercent(value: number | null): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return 'none';
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

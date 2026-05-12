import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import path from 'node:path';
import {
  BENCHMARK_ROUTES,
  aggregateRouteBenchmark,
  type BenchmarkCacheMode,
  type BenchmarkRouteConfig,
  captureGitMetadata,
  type FeedScrollSummary,
  type FeedScrollSettleSummary,
  getBenchmarkCacheModes,
  getBenchmarkMeasuredRuns,
  getBenchmarkResultDir,
  getBenchmarkWarmupRuns,
  type MainThreadLongTaskSummary,
  normalizeEndpointUrl,
  normalizeTileUrl,
  type RenderProbeSummary,
  summarizeCriticalRequests,
  summarizeRequests,
  summarizeTileRequests,
  writeBenchmarkArtifacts,
  type BenchmarkRun,
  type RequestMetric,
  type RouteBenchmarkSample,
  type RouteBenchmarkResult,
} from '../helpers/benchmark';
import { attachConsoleErrorCollector, NETWORK_ALLOWED_CONSOLE_PATTERNS } from '../helpers/console';

type NavigationMetric = RouteBenchmarkSample['navigation'];
type NavigationAction = 'goto' | 'reload';
type CdpRequestWillBeSentEvent = { requestId: string; request: { url: string } };
type CdpRequestServedFromCacheEvent = { requestId: string };
type WindowBenchmarkGlobals = Window & {
  __hhBenchmarkLongTasks?: Array<{ duration: number; startTime: number }>;
  __hhBenchmarkLongTaskSupported?: boolean;
  __hhBenchmarkRenderProbeEnabled?: boolean;
  __hhBenchmarkRenderProbes?: Record<string, RenderProbeSummary>;
};

test.describe('Web performance benchmark harness', () => {
  test('captures route benchmark metrics and writes durable artifacts', async ({ browser }) => {
    const warmupRuns = getBenchmarkWarmupRuns();
    const measuredRuns = getBenchmarkMeasuredRuns();
    const routeEntries = Object.entries(BENCHMARK_ROUTES);
    const cacheModes = getBenchmarkCacheModes();

    test.setTimeout(
      Math.max(600_000, routeEntries.length * cacheModes.length * (warmupRuns + measuredRuns) * 60_000),
    );

    const benchmarkRun: BenchmarkRun = {
      metadata: captureGitMetadata(),
      routes: {} as BenchmarkRun['routes'],
    };

    for (const [routeKey, routeConfig] of routeEntries) {
      for (const cacheMode of cacheModes) {
        benchmarkRun.routes[`${routeKey}:${cacheMode}`] = await benchmarkRouteSeries(
          browser,
          routeKey,
          routeConfig,
          cacheMode,
          warmupRuns,
          measuredRuns,
        );
      }
    }

    const artifacts = await writeBenchmarkArtifacts('web-performance-benchmark', benchmarkRun);
    const postRunFailures = collectPostRunFailures(benchmarkRun);

    expectPathInsideBenchmarkResultDir(artifacts.jsonPath);
    expectPathInsideBenchmarkResultDir(artifacts.markdownPath);
    expect(postRunFailures).toEqual([]);
  });
});

function expectPathInsideBenchmarkResultDir(artifactPath: string): void {
  const resultDir = path.resolve(getBenchmarkResultDir());
  const resolvedArtifactPath = path.resolve(artifactPath);
  const relativeArtifactPath = path.relative(resultDir, resolvedArtifactPath);

  expect(relativeArtifactPath).not.toBe('');
  expect(relativeArtifactPath.startsWith('..')).toBe(false);
  expect(path.isAbsolute(relativeArtifactPath)).toBe(false);
}

async function benchmarkRouteSeries(
  browser: Browser,
  routeKey: string,
  routeConfig: BenchmarkRouteConfig,
  cacheMode: BenchmarkCacheMode,
  warmupRuns: number,
  measuredRuns: number,
): Promise<RouteBenchmarkResult> {
  for (let index = 0; index < warmupRuns; index += 1) {
    await benchmarkRouteSample(browser, routeKey, routeConfig, cacheMode);
  }

  const samples: RouteBenchmarkSample[] = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    if (cacheMode === 'backend-cold') {
      await restartBenchmarkBackend();
    }
    const sample = await benchmarkRouteSample(browser, routeKey, routeConfig, cacheMode);
    samples.push(sample);
  }

  return aggregateRouteBenchmark(routeKey, routeConfig.route, cacheMode, samples, warmupRuns, measuredRuns);
}

async function restartBenchmarkBackend(): Promise<void> {
  const restartUrl = process.env.BENCHMARK_API_RESTART_URL;
  if (!restartUrl) {
    throw new Error(
      'BENCHMARK_BACKEND_COLD=1 requires BENCHMARK_API_RESTART_URL from the Playwright runtime wrapper',
    );
  }

  const response = await fetch(restartUrl, { method: 'POST' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Benchmark API restart failed with ${response.status}${body ? `: ${body}` : ''}`,
    );
  }
}

async function runInIsolatedPage<T>(
  browser: Browser,
  callback: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    return await callback(page, context);
  } finally {
    await context.close();
  }
}

async function benchmarkMapSample(
  browser: Browser,
  routeKey: string,
  routeConfig: BenchmarkRouteConfig,
  cacheMode: BenchmarkCacheMode,
): Promise<RouteBenchmarkSample> {
  return await runInIsolatedPage(browser, async (page) => {
    await installBrowserBenchmarkCollectors(page);

    if (cacheMode === 'warm-cache') {
      await primeWarmMapRoute(page, routeConfig.route);
      return await benchmarkMapRoute(page, routeKey, routeConfig.route, cacheMode, 'reload');
    }

    return await benchmarkMapRoute(page, routeKey, routeConfig.route, cacheMode, 'goto');
  });
}

async function benchmarkRouteSample(
  browser: Browser,
  routeKey: string,
  routeConfig: BenchmarkRouteConfig,
  cacheMode: BenchmarkCacheMode,
): Promise<RouteBenchmarkSample> {
  if (routeConfig.surface === 'feed') {
    return await benchmarkFeedSample(browser, routeKey, routeConfig, cacheMode);
  }

  return await benchmarkMapSample(browser, routeKey, routeConfig, cacheMode);
}

async function benchmarkFeedSample(
  browser: Browser,
  routeKey: string,
  routeConfig: BenchmarkRouteConfig,
  cacheMode: BenchmarkCacheMode,
): Promise<RouteBenchmarkSample> {
  return await runInIsolatedPage(browser, async (page) => {
    await installBrowserBenchmarkCollectors(page);

    if (cacheMode === 'warm-cache') {
      await primeWarmFeedRoute(page, routeConfig.route);
      return await benchmarkFeedRoute(page, routeKey, routeConfig.route, cacheMode, 'reload');
    }

    return await benchmarkFeedRoute(page, routeKey, routeConfig.route, cacheMode, 'goto');
  });
}

async function primeWarmMapRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  const startedAt = performance.now();
  await waitForMapUsable(page, startedAt);
  await waitForInitialMapIdle(page, startedAt);
  await waitForWarmupNetworkSettled(page);
  await page.waitForTimeout(500);
}

async function primeWarmFeedRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  const startedAt = performance.now();
  await waitForFeedReady(page, startedAt);
  await waitForWarmupNetworkSettled(page);
  await page.waitForTimeout(500);
}

async function waitForWarmupNetworkSettled(page: Page): Promise<void> {
  await page.waitForTimeout(1200);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch((error: unknown) => {
    if (!isPlaywrightTimeoutError(error)) {
      throw error;
    }
  });
}

async function benchmarkMapRoute(
  page: Page,
  routeKey: string,
  route: string,
  cacheMode: BenchmarkCacheMode,
  navigationAction: NavigationAction,
): Promise<RouteBenchmarkSample> {
  const session = await createRequestSession(page, routeKey, cacheMode);
  const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
  const startedAt = performance.now();

  if (navigationAction === 'reload') {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
  }

  const navigation = await readNavigationMetric(page, startedAt);
  const usableMs = await waitForMapUsable(page, startedAt);
  const initialIdle = await waitForInitialMapIdle(page, startedAt);
  const settle = await measureMapSettle(page);
  await page.waitForTimeout(1500);

  const requests = await session.complete();
  const longTasks = await readLongTaskSummary(page);
  const renderProbes = await readRenderProbeSummary(page);

  return {
    routeKey,
    route,
    cacheMode,
    navigation,
    requests: summarizeRequests(requests),
    tiles: summarizeTileRequests(requests),
    criticalRequests: summarizeCriticalRequests(requests),
    consoleErrors,
    mainThread: {
      longTasks,
    },
    renderProbes,
    map: {
      usableMs,
      initialIdleMs: initialIdle.elapsedMs,
      initialIdleTimedOut: initialIdle.timedOut,
      settle,
    },
  };
}

async function benchmarkFeedRoute(
  page: Page,
  routeKey: string,
  route: string,
  cacheMode: BenchmarkCacheMode,
  navigationAction: NavigationAction,
): Promise<RouteBenchmarkSample> {
  const session = await createRequestSession(page, routeKey, cacheMode);
  const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
  const startedAt = performance.now();

  if (navigationAction === 'reload') {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
  }

  const navigation = await readNavigationMetric(page, startedAt);
  const feed = await waitForFeedReady(page, startedAt);
  const scrollSettle = feed.state === 'cards' ? await waitForFeedScrollSettle(page) : undefined;
  const scroll = feed.state === 'cards' ? await measureFeedScroll(page) : undefined;
  await page.waitForTimeout(1000);

  const requests = await session.complete();
  const longTasks = await readLongTaskSummary(page);
  const renderProbes = await readRenderProbeSummary(page);

  return {
    routeKey,
    route,
    cacheMode,
    navigation,
    requests: summarizeRequests(requests),
    tiles: summarizeTileRequests(requests),
    criticalRequests: summarizeCriticalRequests(requests),
    consoleErrors,
    mainThread: {
      longTasks,
    },
    renderProbes,
    feed: {
      ...feed,
      scrollSettle,
      scroll,
    },
  };
}

async function installBrowserBenchmarkCollectors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const benchmarkWindow = window as WindowBenchmarkGlobals;
    benchmarkWindow.__hhBenchmarkRenderProbeEnabled = true;
    benchmarkWindow.__hhBenchmarkRenderProbes = {};
    benchmarkWindow.__hhBenchmarkLongTasks = [];
    benchmarkWindow.__hhBenchmarkLongTaskSupported = false;

    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    try {
      const supportedTypes = PerformanceObserver.supportedEntryTypes || [];
      if (!supportedTypes.includes('longtask')) {
        return;
      }

      benchmarkWindow.__hhBenchmarkLongTaskSupported = true;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        benchmarkWindow.__hhBenchmarkLongTasks?.push(
          ...entries.map((entry) => ({
            duration: entry.duration,
            startTime: entry.startTime,
          })),
        );
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      benchmarkWindow.__hhBenchmarkLongTaskSupported = false;
    }
  });
}

async function createRequestSession(
  page: Page,
  routeKey: string,
  cacheMode: BenchmarkCacheMode,
): Promise<{ complete(): Promise<RequestMetric[]> }> {
  const requests = new Map<string, RequestMetric>();
  let sequence = 0;
  const requestIdMap = new WeakMap<Request, string>();
  const requestStartedAt = new Map<string, number>();
  const cdpRequestUrls = new Map<string, string>();
  const cdpCachedRequestIds = new Set<string>();
  let cdpSession: CDPSession | null = null;

  try {
    cdpSession = await page.context().newCDPSession(page);
    cdpSession.on('Network.requestWillBeSent', (event: CdpRequestWillBeSentEvent) => {
      cdpRequestUrls.set(event.requestId, event.request.url);
    });
    cdpSession.on('Network.requestServedFromCache', (event: CdpRequestServedFromCacheEvent) => {
      cdpCachedRequestIds.add(event.requestId);
    });
    await cdpSession.send('Network.enable');
  } catch {
    cdpSession = null;
  }

  const onRequest = (request: Request) => {
    const key = `${Date.now()}-${sequence++}`;
    requestIdMap.set(request, key);
    requests.set(key, {
      routeKey,
      cacheMode,
      url: request.url(),
      normalizedUrl: normalizeTileUrl(request.url()),
      normalizedEndpoint: normalizeEndpointUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      ok: false,
      failed: false,
      failureText: null,
      durationMs: 0,
      responseBytes: null,
      startedAt: new Date().toISOString(),
      cache: {
        browserCacheHit: false,
        serviceWorker: false,
      },
      headers: {
        age: null,
        cacheControl: null,
        cfCacheStatus: null,
        contentLength: null,
        contentType: null,
        etag: null,
        lastModified: null,
        server: null,
        vary: null,
        via: null,
        xCache: null,
        xTileCache: null,
        xTileGenerationTime: null,
      },
    });
    requestStartedAt.set(key, Date.now());
  };

  const onResponse = async (response: Response) => {
    const key = requestIdMap.get(response.request());
    if (!key) {
      return;
    }

    const metric = requests.get(key);
    if (!metric) {
      return;
    }

    metric.status = response.status();
    metric.ok = response.ok();
    metric.durationMs = Date.now() - (requestStartedAt.get(key) || Date.now());
    metric.cache.serviceWorker = response.fromServiceWorker();
    metric.headers.age = await response.headerValue('age');
    metric.headers.cacheControl = await response.headerValue('cache-control');
    metric.headers.cfCacheStatus = await response.headerValue('cf-cache-status');
    metric.headers.contentLength = await response.headerValue('content-length');
    metric.headers.contentType = await response.headerValue('content-type');
    metric.headers.etag = await response.headerValue('etag');
    metric.headers.lastModified = await response.headerValue('last-modified');
    metric.headers.server = await response.headerValue('server');
    metric.headers.vary = await response.headerValue('vary');
    metric.headers.via = await response.headerValue('via');
    metric.headers.xCache = await response.headerValue('x-cache');
    metric.headers.xTileCache = await response.headerValue('x-tile-cache');
    metric.headers.xTileGenerationTime = await response.headerValue('x-tile-generation-time');
    metric.responseBytes = parseContentLength(metric.headers.contentLength);
  };

  const onRequestFailed = (request: Request) => {
    const key = requestIdMap.get(request);
    if (!key) {
      return;
    }

    const metric = requests.get(key);
    if (!metric) {
      return;
    }

    metric.failed = true;
    metric.failureText = request.failure()?.errorText ?? null;
    metric.durationMs = Date.now() - (requestStartedAt.get(key) || Date.now());
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    async complete() {
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
      const browserCacheHitCounts = collectBrowserCacheHitCounts(cdpCachedRequestIds, cdpRequestUrls);
      for (const metric of requests.values()) {
        const count = browserCacheHitCounts.get(metric.normalizedUrl) || 0;
        if (count > 0) {
          metric.cache.browserCacheHit = true;
          browserCacheHitCounts.set(metric.normalizedUrl, count - 1);
        }
      }
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      await cdpSession?.detach().catch(() => {});
      return [...requests.values()];
    },
  };
}

function collectBrowserCacheHitCounts(
  cachedRequestIds: Set<string>,
  requestUrls: Map<string, string>,
): Map<string, number> {
  const browserCacheHitCounts = new Map<string, number>();

  for (const requestId of cachedRequestIds) {
    const url = requestUrls.get(requestId);
    if (!url) {
      continue;
    }

    const normalizedUrl = normalizeTileUrl(url);
    browserCacheHitCounts.set(normalizedUrl, (browserCacheHitCounts.get(normalizedUrl) || 0) + 1);
  }

  return browserCacheHitCounts;
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readNavigationMetric(page: Page, startedAt: number): Promise<NavigationMetric> {
  const nowElapsed = performance.now() - startedAt;
  const timing = await page.evaluate(() => {
    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paintEntries = performance.getEntriesByType('paint');
    const firstContentfulPaint = paintEntries.find((entry) => entry.name === 'first-contentful-paint');

    return {
      domContentLoadedMs: navigationEntry?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigationEntry?.loadEventEnd ?? null,
      firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
    };
  });

  return {
    gotoMs: nowElapsed,
    domContentLoadedMs: timing.domContentLoadedMs,
    loadEventMs: timing.loadEventMs,
    firstContentfulPaintMs: timing.firstContentfulPaintMs,
  };
}

async function waitForMapUsable(page: Page, startedAt: number): Promise<number> {
  await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-testid="map-view"] canvas').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForFunction(
    () => {
      const map = (window as Window & {
        __mapInstance?: {
          getCenter?: () => { lng: number; lat: number };
          getZoom?: () => number;
        };
      }).__mapInstance;
      return typeof map?.getCenter === 'function' && typeof map.getZoom === 'function';
    },
    null,
    { timeout: 45_000, polling: 250 },
  );

  return performance.now() - startedAt;
}

async function waitForInitialMapIdle(
  page: Page,
  startedAt: number,
): Promise<{ elapsedMs: number | null; timedOut: boolean }> {
  try {
    await page.waitForFunction(
      () => {
        const map = (window as Window & {
          __mapInstance?: {
            areTilesLoaded?: () => boolean;
            loaded?: () => boolean;
            isStyleLoaded?: () => boolean;
          };
        }).__mapInstance;

        if (!map) {
          return false;
        }

        const styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
        const tilesReady = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
        const loaded = typeof map.loaded === 'function' ? map.loaded() : true;
        return styleReady && tilesReady && loaded;
      },
      null,
      { timeout: 45_000, polling: 250 },
    );

    return { elapsedMs: performance.now() - startedAt, timedOut: false };
  } catch (error) {
    if (isPlaywrightTimeoutError(error)) {
      return { elapsedMs: null, timedOut: true };
    }

    throw error;
  }
}

async function waitForFeedReady(
  page: Page,
  startedAt: number,
): Promise<NonNullable<RouteBenchmarkSample['feed']>> {
  await page.waitForSelector(
    [
      '[data-testid="feed-screen"]',
      '[data-testid="feed-empty"]',
      '[data-testid="feed-error"]',
      '[data-testid="property-feed-card"]',
    ].join(', '),
    { timeout: 45_000 },
  );

  const renderMs = performance.now() - startedAt;
  const state = await page.evaluate((): Pick<NonNullable<RouteBenchmarkSample['feed']>, 'itemCount' | 'state'> => {
    const count = document.querySelectorAll('[data-testid="property-feed-card"]').length;
    const hasCards = count > 0 || Boolean(document.querySelector('[data-testid="feed-screen"]'));
    const state = hasCards
      ? 'cards'
      : document.querySelector('[data-testid="feed-empty"]')
        ? 'empty'
        : document.querySelector('[data-testid="feed-error"]')
          ? 'error'
          : 'unknown';

    return {
      itemCount: count,
      state,
    };
  });

  return {
    renderMs,
    ...state,
  };
}

async function measureFeedScroll(page: Page): Promise<FeedScrollSummary> {
  return await page.evaluate(async () => {
    const candidates = [
      document.querySelector('[data-testid="feed-list"]'),
      document.querySelector('[data-testid="feed-screen"]'),
      document.scrollingElement,
      document.documentElement,
    ].filter((candidate): candidate is Element => Boolean(candidate));
    const scrollElement =
      candidates.find((candidate) => candidate.scrollHeight - candidate.clientHeight > 16) ||
      document.scrollingElement ||
      document.documentElement;
    const element = scrollElement as HTMLElement;
    const startTop = element.scrollTop;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const targetTop = Math.min(maxScrollTop, startTop + 1400);
    const durationMs = 1200;
    const frameDeltas: number[] = [];
    let lastFrameAt = performance.now();
    const startedAt = lastFrameAt;

    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        frameDeltas.push(now - lastFrameAt);
        lastFrameAt = now;
        const progress = Math.min(1, (now - startedAt) / durationMs);
        element.scrollTop = startTop + (targetTop - startTop) * progress;

        if (progress < 1) {
          requestAnimationFrame(step);
          return;
        }

        resolve();
      };

      requestAnimationFrame(step);
    });

    const usableFrameDeltas = frameDeltas.slice(1);
    const totalFrameMs = usableFrameDeltas.reduce((sum, delta) => sum + delta, 0);
    return {
      durationMs: performance.now() - startedAt,
      totalFrames: usableFrameDeltas.length,
      longFrameCount: usableFrameDeltas.filter((delta) => delta > 50).length,
      worstFrameMs: usableFrameDeltas.length > 0 ? Math.max(...usableFrameDeltas) : null,
      averageFrameMs: usableFrameDeltas.length > 0 ? totalFrameMs / usableFrameDeltas.length : null,
    };
  });
}

async function waitForFeedScrollSettle(page: Page): Promise<FeedScrollSettleSummary> {
  const startedAt = performance.now();
  let networkIdleTimedOut = false;

  try {
    await page.waitForLoadState('networkidle', { timeout: 2500 });
  } catch (error) {
    if (isPlaywrightTimeoutError(error)) {
      networkIdleTimedOut = true;
    } else {
      throw error;
    }
  }

  const quiet = await page.evaluate(
    async ({ pollMs, quietWindowMs, stablePolls, timeoutMs }) => {
      const benchmarkWindow = window as WindowBenchmarkGlobals & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions,
        ) => number;
      };

      await new Promise<void>((resolve) => {
        if (typeof benchmarkWindow.requestIdleCallback === 'function') {
          benchmarkWindow.requestIdleCallback(() => resolve(), { timeout: 750 });
          return;
        }

        window.setTimeout(resolve, 0);
      });

      const readSignature = () => {
        const cards = document.querySelectorAll('[data-testid="property-feed-card"]').length;
        const element = (
          document.querySelector('[data-testid="feed-list"]') ||
          document.querySelector('[data-testid="feed-screen"]') ||
          document.scrollingElement ||
          document.documentElement
        ) as HTMLElement | null;
        return `${cards}:${element?.scrollHeight ?? 0}:${element?.clientHeight ?? 0}`;
      };

      const getLastLongTaskEnd = () => {
        const tasks = benchmarkWindow.__hhBenchmarkLongTasks || [];
        return tasks.reduce((latestEnd, task) => {
          const end = task.startTime + task.duration;
          return Number.isFinite(end) ? Math.max(latestEnd, end) : latestEnd;
        }, 0);
      };

      const deadline = performance.now() + timeoutMs;
      let stableCount = 0;
      let previousSignature = readSignature();

      while (performance.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
        const signature = readSignature();
        stableCount = signature === previousSignature ? stableCount + 1 : 0;
        previousSignature = signature;

        const longTaskQuietForMs = performance.now() - getLastLongTaskEnd();
        if (stableCount >= stablePolls && longTaskQuietForMs >= quietWindowMs) {
          return { timedOut: false };
        }
      }

      return { timedOut: true };
    },
    {
      pollMs: 50,
      quietWindowMs: 300,
      stablePolls: 3,
      timeoutMs: 2000,
    },
  );

  return {
    elapsedMs: performance.now() - startedAt,
    timedOut: quiet.timedOut,
    networkIdleTimedOut,
  };
}

async function readLongTaskSummary(page: Page): Promise<MainThreadLongTaskSummary> {
  return await page.evaluate(() => {
    const benchmarkWindow = window as WindowBenchmarkGlobals;
    const tasks = benchmarkWindow.__hhBenchmarkLongTasks || [];
    const durations = tasks
      .map((task) => task.duration)
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
    const totalBlockingTimeMs = durations.reduce(
      (sum, duration) => sum + Math.max(0, duration - 50),
      0,
    );

    return {
      supported: benchmarkWindow.__hhBenchmarkLongTaskSupported === true,
      count: durations.length,
      totalDurationMs,
      totalBlockingTimeMs,
      worstTaskMs: durations.length > 0 ? Math.max(...durations) : null,
    };
  });
}

async function readRenderProbeSummary(page: Page): Promise<Record<string, RenderProbeSummary>> {
  return await page.evaluate(() => {
    const benchmarkWindow = window as WindowBenchmarkGlobals;
    return benchmarkWindow.__hhBenchmarkRenderProbes || {};
  });
}

function isPlaywrightTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function collectPostRunFailures(benchmarkRun: BenchmarkRun): string[] {
  const failures: string[] = [];

  for (const [routeKey, route] of Object.entries(benchmarkRun.routes)) {
    route.samples.forEach((sample, index) => {
      if (sample.consoleErrors.length > 0) {
        failures.push(`${routeKey} sample ${index + 1}: ${sample.consoleErrors.length} console error(s)`);
      }

      if (sample.requests.failed > 0) {
        failures.push(`${routeKey} sample ${index + 1}: ${sample.requests.failed} failed request(s)`);
      }
    });
  }

  return failures;
}

async function measureMapSettle(page: Page): Promise<NonNullable<RouteBenchmarkSample['map']>['settle']> {
  return await page.evaluate(async () => {
    const map = ((window as unknown) as Window & {
      __mapInstance?: {
        areTilesLoaded?: () => boolean;
        loaded?: () => boolean;
        getCenter: () => { lng: number; lat: number };
        getZoom: () => number;
        isMoving?: () => boolean;
        isStyleLoaded?: () => boolean;
        easeTo: (options: { center?: [number, number]; zoom?: number; duration?: number }) => void;
        on: (event: string, listener: () => void) => void;
        off: (event: string, listener: () => void) => void;
      };
    }).__mapInstance;

    if (!map) {
      return {
        panMs: null,
        panTimedOut: true,
        zoomMs: null,
        zoomTimedOut: true,
      };
    }

    const waitForSettle = (run: () => void) =>
      new Promise<{ ms: number | null; timedOut: boolean }>((resolve) => {
        const startedAt = performance.now();
        let finished = false;
        let pollTimer: number | null = null;

        function finish(result: { ms: number | null; timedOut: boolean }) {
          if (finished) {
            return;
          }

          finished = true;
          window.clearTimeout(fallbackTimer);
          if (pollTimer != null) {
            window.clearInterval(pollTimer);
          }
          map.off('idle', handleIdle);
          resolve(result);
        }

        function checkSettled() {
          const styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
          const tilesReady = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
          const loaded = typeof map.loaded === 'function' ? map.loaded() : true;
          const moving = typeof map.isMoving === 'function' ? map.isMoving() : false;
          if (styleReady && tilesReady && loaded && !moving) {
            finish({ ms: performance.now() - startedAt, timedOut: false });
          }
        }

        function handleIdle() {
          checkSettled();
        }

        const fallbackTimer = window.setTimeout(() => {
          finish({ ms: null, timedOut: true });
        }, 10_000);
        pollTimer = window.setInterval(checkSettled, 100);
        map.on('idle', handleIdle);
        run();
      });

    const center = map.getCenter();
    const currentZoom = map.getZoom();
    const pan = await waitForSettle(() => {
      map.easeTo({
        center: [center.lng + 0.0025, center.lat],
        duration: 400,
      });
    });
    const zoom = await waitForSettle(() => {
      map.easeTo({
        center: [center.lng, center.lat],
        zoom: currentZoom + 0.75,
        duration: 400,
      });
    });

    return {
      panMs: pan.ms,
      panTimedOut: pan.timedOut,
      zoomMs: zoom.ms,
      zoomTimedOut: zoom.timedOut,
    };
  });
}

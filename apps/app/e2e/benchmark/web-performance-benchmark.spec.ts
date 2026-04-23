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
import {
  BENCHMARK_ROUTES,
  aggregateRouteBenchmark,
  type BenchmarkCacheMode,
  captureGitMetadata,
  getBenchmarkMeasuredRuns,
  getBenchmarkWarmupRuns,
  normalizeEndpointUrl,
  normalizeTileUrl,
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

test.describe('Web performance benchmark harness', () => {
  test('captures route benchmark metrics and writes durable artifacts', async ({ browser }) => {
    const warmupRuns = getBenchmarkWarmupRuns();
    const measuredRuns = getBenchmarkMeasuredRuns();
    const routeEntries = Object.entries(BENCHMARK_ROUTES);

    test.setTimeout(Math.max(600_000, routeEntries.length * 2 * (warmupRuns + measuredRuns) * 60_000));

    const benchmarkRun: BenchmarkRun = {
      metadata: captureGitMetadata(),
      routes: {} as BenchmarkRun['routes'],
    };

    for (const [routeKey, route] of routeEntries) {
      benchmarkRun.routes[`${routeKey}:cold-cache`] = await benchmarkRouteSeries(
        browser,
        routeKey,
        route,
        'cold-cache',
        warmupRuns,
        measuredRuns,
      );
      benchmarkRun.routes[`${routeKey}:warm-cache`] = await benchmarkRouteSeries(
        browser,
        routeKey,
        route,
        'warm-cache',
        warmupRuns,
        measuredRuns,
      );
    }

    const artifacts = await writeBenchmarkArtifacts('web-performance-benchmark', benchmarkRun);
    const postRunFailures = collectPostRunFailures(benchmarkRun);

    expect(artifacts.jsonPath).toContain('test-results/benchmark/');
    expect(artifacts.markdownPath).toContain('test-results/benchmark/');
    expect(postRunFailures).toEqual([]);
  });
});

async function benchmarkRouteSeries(
  browser: Browser,
  routeKey: string,
  route: string,
  cacheMode: BenchmarkCacheMode,
  warmupRuns: number,
  measuredRuns: number,
): Promise<RouteBenchmarkResult> {
  for (let index = 0; index < warmupRuns; index += 1) {
    await benchmarkMapSample(browser, routeKey, route, cacheMode);
  }

  const samples: RouteBenchmarkSample[] = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const sample = await benchmarkMapSample(browser, routeKey, route, cacheMode);
    samples.push(sample);
  }

  return aggregateRouteBenchmark(routeKey, route, cacheMode, samples, warmupRuns, measuredRuns);
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
  route: string,
  cacheMode: BenchmarkCacheMode,
): Promise<RouteBenchmarkSample> {
  return await runInIsolatedPage(browser, async (page) => {
    if (cacheMode === 'warm-cache') {
      await primeWarmMapRoute(page, route);
      return await benchmarkMapRoute(page, routeKey, route, cacheMode, 'reload');
    }

    return await benchmarkMapRoute(page, routeKey, route, cacheMode, 'goto');
  });
}

async function primeWarmMapRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  const startedAt = performance.now();
  await waitForMapUsable(page, startedAt);
  await waitForInitialMapIdle(page, startedAt);
  await page.waitForTimeout(500);
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

  return {
    routeKey,
    route,
    cacheMode,
    navigation,
    requests: summarizeRequests(requests),
    tiles: summarizeTileRequests(requests),
    criticalRequests: summarizeCriticalRequests(requests),
    consoleErrors,
    map: {
      usableMs,
      initialIdleMs: initialIdle.elapsedMs,
      initialIdleTimedOut: initialIdle.timedOut,
      settle,
    },
  };
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

        function finish(result: { ms: number | null; timedOut: boolean }) {
          if (finished) {
            return;
          }

          finished = true;
          window.clearTimeout(fallbackTimer);
          map.off('idle', handleIdle);
          resolve(result);
        }

        function handleIdle() {
          const styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
          const tilesReady = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
          if (styleReady && tilesReady) {
            finish({ ms: performance.now() - startedAt, timedOut: false });
          }
        }

        const fallbackTimer = window.setTimeout(() => {
          finish({ ms: null, timedOut: true });
        }, 5000);
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

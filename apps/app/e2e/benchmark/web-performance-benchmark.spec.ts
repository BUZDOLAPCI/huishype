import { expect, test, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import {
  BENCHMARK_ROUTES,
  aggregateRouteBenchmark,
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
  type FeedScrollSummary,
  type RequestMetric,
  type RouteBenchmarkSample,
  type RouteBenchmarkResult,
} from '../helpers/benchmark';
import { attachConsoleErrorCollector, NETWORK_ALLOWED_CONSOLE_PATTERNS } from '../helpers/console';

type NavigationMetric = RouteBenchmarkSample['navigation'];
type FeedMetric = NonNullable<RouteBenchmarkSample['feed']>;
type RouteBenchmarker = (page: Page) => Promise<RouteBenchmarkSample>;

test.describe('Web performance benchmark harness', () => {
  test('captures route benchmark metrics and writes durable artifacts', async ({ browser }) => {
    test.setTimeout(240_000);

    const warmupRuns = getBenchmarkWarmupRuns();
    const measuredRuns = getBenchmarkMeasuredRuns();
    const benchmarkRun: BenchmarkRun = {
      metadata: captureGitMetadata(),
      routes: {} as BenchmarkRun['routes'],
    };

    benchmarkRun.routes.map = await benchmarkRouteSeries(
      browser,
      BENCHMARK_ROUTES.map,
      benchmarkMapRoute,
      warmupRuns,
      measuredRuns,
    );
    benchmarkRun.routes.feed = await benchmarkRouteSeries(
      browser,
      BENCHMARK_ROUTES.feed,
      benchmarkFeedRoute,
      warmupRuns,
      measuredRuns,
    );

    const artifacts = await writeBenchmarkArtifacts('web-performance-benchmark', benchmarkRun);

    expect(artifacts.jsonPath).toContain('test-results/benchmark/');
    expect(artifacts.markdownPath).toContain('test-results/benchmark/');
  });
});

async function benchmarkRouteSeries(
  browser: Browser,
  route: string,
  benchmarker: RouteBenchmarker,
  warmupRuns: number,
  measuredRuns: number,
): Promise<RouteBenchmarkResult> {
  for (let index = 0; index < warmupRuns; index += 1) {
    await runInIsolatedPage(browser, async (page) => {
      await benchmarker(page);
    });
  }

  const samples: RouteBenchmarkSample[] = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const sample = await runInIsolatedPage(browser, async (page) => await benchmarker(page));
    samples.push(sample);
  }

  return aggregateRouteBenchmark(route, samples, warmupRuns, measuredRuns);
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

async function benchmarkMapRoute(page: Page): Promise<RouteBenchmarkSample> {
  const session = createRequestSession(page);
  const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
  const startedAt = performance.now();

  await page.goto(BENCHMARK_ROUTES.map, { waitUntil: 'domcontentloaded' });

  const navigation = await readNavigationMetric(page, startedAt);
  const usableMs = await waitForMapUsable(page, startedAt);
  const settle = await measureMapSettle(page);
  await page.waitForTimeout(1500);

  const requests = await session.complete();

  return {
    route: BENCHMARK_ROUTES.map,
    navigation,
    requests: summarizeRequests(requests),
    tiles: summarizeTileRequests(requests),
    criticalRequests: summarizeCriticalRequests(requests),
    consoleErrors,
    map: {
      usableMs,
      settle,
    },
  };
}

async function benchmarkFeedRoute(page: Page): Promise<RouteBenchmarkSample> {
  const session = createRequestSession(page);
  const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
  const startedAt = performance.now();

  await page.goto(BENCHMARK_ROUTES.feed, { waitUntil: 'domcontentloaded' });

  const navigation = await readNavigationMetric(page, startedAt);
  const feed = await waitForFeedRenderable(page, startedAt);
  const scroll = await measureFeedScroll(page);
  await page.waitForTimeout(1000);

  const requests = await session.complete();

  return {
    route: BENCHMARK_ROUTES.feed,
    navigation,
    requests: summarizeRequests(requests),
    tiles: summarizeTileRequests(requests),
    criticalRequests: summarizeCriticalRequests(requests),
    consoleErrors,
    feed: {
      ...feed,
      scroll,
    },
  };
}

function createRequestSession(page: Page): { complete(): Promise<RequestMetric[]> } {
  const requests = new Map<string, RequestMetric>();
  let sequence = 0;
  const requestIdMap = new WeakMap<import('@playwright/test').Request, string>();
  const requestStartedAt = new Map<string, number>();

  const onRequest = (request: import('@playwright/test').Request) => {
    const key = `${Date.now()}-${sequence++}`;
    requestIdMap.set(request, key);
    requests.set(key, {
      url: request.url(),
      normalizedUrl: normalizeTileUrl(request.url()),
      normalizedEndpoint: normalizeEndpointUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      ok: false,
      failed: false,
      durationMs: 0,
      responseBytes: null,
      startedAt: new Date().toISOString(),
      headers: {
        age: null,
        cacheControl: null,
        contentLength: null,
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
    metric.headers.age = await response.headerValue('age');
    metric.headers.cacheControl = await response.headerValue('cache-control');
    metric.headers.contentLength = await response.headerValue('content-length');
    metric.headers.xTileCache = await response.headerValue('x-tile-cache');
    metric.headers.xTileGenerationTime = await response.headerValue('x-tile-generation-time');
    metric.responseBytes = parseContentLength(metric.headers.contentLength);
  };

  const onRequestFailed = (request: import('@playwright/test').Request) => {
    const key = requestIdMap.get(request);
    if (!key) {
      return;
    }

    const metric = requests.get(key);
    if (!metric) {
      return;
    }

    metric.failed = true;
    metric.durationMs = Date.now() - (requestStartedAt.get(key) || Date.now());
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    async complete() {
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      return [...requests.values()];
    },
  };
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
      const map = (window as Window & { __mapInstance?: { loaded?: () => boolean } }).__mapInstance;
      return Boolean(map?.loaded?.());
    },
    null,
    { timeout: 45_000, polling: 250 },
  );

  return performance.now() - startedAt;
}

async function measureMapSettle(page: Page): Promise<{ panMs: number; zoomMs: number }> {
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
      return { panMs: Number.NaN, zoomMs: Number.NaN };
    }

    const waitForSettle = (run: () => void) =>
      new Promise<number>((resolve) => {
        const startedAt = performance.now();
        let finished = false;

        function finish(value: number) {
          if (finished) {
            return;
          }

          finished = true;
          window.clearTimeout(fallbackTimer);
          map.off('idle', handleIdle);
          resolve(value);
        }

        function handleIdle() {
          const styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
          const tilesReady = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
          if (styleReady && tilesReady) {
            finish(performance.now() - startedAt);
          }
        }

        const fallbackTimer = window.setTimeout(() => finish(Number.NaN), 5000);
        map.on('idle', handleIdle);
        run();
      });

    const center = map.getCenter();
    const zoom = map.getZoom();
    const panMs = await waitForSettle(() => {
      map.easeTo({
        center: [center.lng + 0.0025, center.lat],
        duration: 400,
      });
    });
    const zoomMs = await waitForSettle(() => {
      map.easeTo({
        center: [center.lng, center.lat],
        zoom: zoom + 0.75,
        duration: 400,
      });
    });

    return { panMs, zoomMs };
  });
}

async function waitForFeedRenderable(
  page: Page,
  startedAt: number,
): Promise<FeedMetric> {
  await page.waitForFunction(
    () => {
      const selectors = [
        '[data-testid="property-feed-card"]',
        '[data-testid="feed-empty"]',
        '[data-testid="feed-error"]',
        '[data-testid="filter-chip-trending"]',
      ];
      return selectors.some((selector) => document.querySelector(selector));
    },
    null,
    { timeout: 45_000, polling: 250 },
  );

  const feedState = await page.evaluate(() => {
    const itemCount = document.querySelectorAll('[data-testid="property-feed-card"]').length;
    if (itemCount > 0) {
      return { state: 'cards' as const, itemCount };
    }

    if (document.querySelector('[data-testid="feed-empty"]')) {
      return { state: 'empty' as const, itemCount: 0 };
    }

    if (document.querySelector('[data-testid="feed-error"]')) {
      return { state: 'error' as const, itemCount: 0 };
    }

    return { state: 'unknown' as const, itemCount };
  });

  return {
    renderMs: performance.now() - startedAt,
    ...feedState,
  };
}

async function measureFeedScroll(page: Page): Promise<FeedScrollSummary> {
  return await page.evaluate(async () => {
    const frameDeltas: number[] = [];
    let rafId = 0;
    let lastFrame = 0;
    const startedAt = performance.now();
    const listElement =
      (document.querySelector('[data-testid="feed-list"]') as HTMLElement | null) ||
      (document.querySelector('[data-testid="activity-feed-list"]') as HTMLElement | null);

    const isScrollable = (element: HTMLElement | null | undefined) =>
      Boolean(element && element.scrollHeight - element.clientHeight > 24);

    const resolveScrollTarget = (): HTMLElement | null => {
      if (!listElement) {
        return null;
      }

      if (isScrollable(listElement)) {
        return listElement;
      }

      for (const candidate of Array.from(listElement.querySelectorAll<HTMLElement>('*'))) {
        if (isScrollable(candidate)) {
          return candidate;
        }
      }

      let parent = listElement.parentElement;
      while (parent) {
        if (isScrollable(parent)) {
          return parent;
        }
        parent = parent.parentElement;
      }

      return null;
    };

    const scrollTarget = resolveScrollTarget();
    const documentTarget = document.scrollingElement as HTMLElement | null;

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (lastFrame !== 0) {
          frameDeltas.push(timestamp - lastFrame);
        }
        lastFrame = timestamp;
        rafId = window.requestAnimationFrame(tick);
      };

      rafId = window.requestAnimationFrame(tick);

      let step = 0;
      const interval = window.setInterval(() => {
        if (scrollTarget) {
          scrollTarget.scrollTop += 600;
        } else if (documentTarget) {
          documentTarget.scrollTop += 600;
        } else {
          window.scrollBy({ top: 600, left: 0, behavior: 'instant' });
        }
        step += 1;
        if (step >= 5) {
          window.clearInterval(interval);
          window.setTimeout(resolve, 350);
        }
      }, 120);
    });

    window.cancelAnimationFrame(rafId);

    const longFrames = frameDeltas.filter((delta) => delta > 50);
    const sum = frameDeltas.reduce((total, delta) => total + delta, 0);

    return {
      durationMs: performance.now() - startedAt,
      totalFrames: frameDeltas.length,
      longFrameCount: longFrames.length,
      worstFrameMs: frameDeltas.length > 0 ? Math.max(...frameDeltas) : null,
      averageFrameMs: frameDeltas.length > 0 ? sum / frameDeltas.length : null,
    };
  });
}

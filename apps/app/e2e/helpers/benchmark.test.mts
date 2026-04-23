import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateRouteBenchmark,
  summarizeCriticalRequests,
  summarizeRequests,
  summarizeTileRequests,
  type RequestMetric,
  type RouteBenchmarkSample,
} from './benchmark.ts';

const baseHeaders: RequestMetric['headers'] = {
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
};

type RequestMetricOverrides = Partial<Omit<RequestMetric, 'cache' | 'headers'>> & {
  cache?: Partial<RequestMetric['cache']>;
  headers?: Partial<RequestMetric['headers']>;
};

function requestMetric(overrides: RequestMetricOverrides): RequestMetric {
  const url = overrides.url || 'http://localhost:8081/api/properties?cursor=abc&token=secret';
  const baseMetric: RequestMetric = {
    routeKey: 'lowZoom795',
    cacheMode: 'warm-cache',
    url,
    normalizedUrl: '/api/properties?cursor=abc',
    normalizedEndpoint: '/api/properties',
    method: 'GET',
    resourceType: 'fetch',
    status: 200,
    ok: true,
    failed: false,
    failureText: null,
    durationMs: 25,
    responseBytes: 123,
    startedAt: '2026-04-23T10:00:00.000Z',
    cache: {
      browserCacheHit: false,
      serviceWorker: false,
    },
    headers: baseHeaders,
  };

  return {
    ...baseMetric,
    ...overrides,
    cache: {
      browserCacheHit: false,
      serviceWorker: false,
      ...overrides.cache,
    },
    headers: {
      ...baseHeaders,
      ...overrides.headers,
    },
  };
}

test('summarizeRequests serializes requestfailed and HTTP error diagnostics', () => {
  const failedNetworkRequest = requestMetric({
    url: 'http://localhost:8081/tiles/12/2048/1365.pbf?access_token=secret',
    normalizedUrl: '/tiles/12/2048/1365.pbf',
    normalizedEndpoint: '/tiles/12/2048/1365.pbf',
    resourceType: 'fetch',
    status: null,
    ok: false,
    failed: true,
    failureText: 'net::ERR_FAILED',
    durationMs: 42,
    responseBytes: null,
    cache: {
      browserCacheHit: true,
      serviceWorker: false,
    },
  });
  const expectedTileAbort = requestMetric({
    url: 'http://localhost:8081/tiles/properties/8/131/85.pbf',
    normalizedUrl: '/tiles/properties/8/131/85.pbf',
    normalizedEndpoint: '/tiles/properties/8/131/85.pbf',
    resourceType: 'fetch',
    status: null,
    ok: false,
    failed: true,
    failureText: 'net::ERR_ABORTED',
    durationMs: 12,
    responseBytes: null,
  });
  const expectedTileAbortAfterHeaders = requestMetric({
    url: 'https://tiles.openfreemap.org/planet/20260415_001001_pt/4/8/6.pbf',
    normalizedUrl: '/planet/20260415_001001_pt/4/8/6.pbf',
    normalizedEndpoint: '/planet/20260415_001001_pt/4/8/6.pbf',
    resourceType: 'fetch',
    status: 200,
    ok: true,
    failed: true,
    failureText: 'net::ERR_ABORTED',
    durationMs: 14,
    responseBytes: null,
  });
  const httpErrorRequest = requestMetric({
    status: 500,
    ok: false,
    failed: false,
    failureText: null,
    durationMs: 95,
    responseBytes: 512,
    headers: {
      cacheControl: 'no-store',
      contentLength: '512',
      contentType: 'application/json',
      server: 'test-server',
      xCache: 'MISS',
    },
  });
  const okRequest = requestMetric({
    url: 'http://localhost:8081/api/ok',
    normalizedUrl: '/api/ok',
    normalizedEndpoint: '/api/ok',
  });

  const summary = summarizeRequests([
    failedNetworkRequest,
    expectedTileAbort,
    expectedTileAbortAfterHeaders,
    httpErrorRequest,
    okRequest,
  ]);

  assert.equal(summary.total, 5);
  assert.equal(summary.failed, 2);
  assert.equal(summary.failedDetails.length, 2);
  assert.deepEqual(
    summary.failedDetails.map((detail) => ({
      routeKey: detail.routeKey,
      cacheMode: detail.cacheMode,
      rawUrl: detail.rawUrl,
      normalizedUrl: detail.normalizedUrl,
      normalizedEndpoint: detail.normalizedEndpoint,
      method: detail.method,
      resourceType: detail.resourceType,
      status: detail.status,
      ok: detail.ok,
      failed: detail.failed,
      failureText: detail.failureText,
      durationMs: detail.durationMs,
      responseBytes: detail.responseBytes,
      browserCacheHit: detail.cache.browserCacheHit,
      cacheControl: detail.headers.cacheControl,
      contentType: detail.headers.contentType,
      server: detail.headers.server,
      xCache: detail.headers.xCache,
      startedAt: detail.startedAt,
    })),
    [
      {
        routeKey: 'lowZoom795',
        cacheMode: 'warm-cache',
        rawUrl: 'http://localhost:8081/tiles/12/2048/1365.pbf?access_token=secret',
        normalizedUrl: '/tiles/12/2048/1365.pbf',
        normalizedEndpoint: '/tiles/12/2048/1365.pbf',
        method: 'GET',
        resourceType: 'fetch',
        status: null,
        ok: false,
        failed: true,
        failureText: 'net::ERR_FAILED',
        durationMs: 42,
        responseBytes: null,
        browserCacheHit: true,
        cacheControl: null,
        contentType: null,
        server: null,
        xCache: null,
        startedAt: '2026-04-23T10:00:00.000Z',
      },
      {
        routeKey: 'lowZoom795',
        cacheMode: 'warm-cache',
        rawUrl: 'http://localhost:8081/api/properties?cursor=abc&token=secret',
        normalizedUrl: '/api/properties?cursor=abc',
        normalizedEndpoint: '/api/properties',
        method: 'GET',
        resourceType: 'fetch',
        status: 500,
        ok: false,
        failed: false,
        failureText: null,
        durationMs: 95,
        responseBytes: 512,
        browserCacheHit: false,
        cacheControl: 'no-store',
        contentType: 'application/json',
        server: 'test-server',
        xCache: 'MISS',
        startedAt: '2026-04-23T10:00:00.000Z',
      },
    ],
  );

  const tileSummary = summarizeTileRequests([
    failedNetworkRequest,
    expectedTileAbort,
    expectedTileAbortAfterHeaders,
    httpErrorRequest,
    okRequest,
  ]);
  assert.equal(tileSummary.abortedRequestCount, 2);
  assert.equal(tileSummary.abortedRequestDetails[0]?.rawUrl, expectedTileAbort.url);
  assert.equal(tileSummary.abortedRequestDetails[0]?.failureText, 'net::ERR_ABORTED');
  assert.equal(
    tileSummary.abortedRequestDetails[1]?.rawUrl,
    expectedTileAbortAfterHeaders.url,
  );
});

test('aggregateRouteBenchmark carries route key and failed details into result summary', () => {
  const failedRequest = requestMetric({
    routeKey: 'lowZoom392',
    cacheMode: 'cold-cache',
    url: 'http://localhost:8081/api/search',
    normalizedUrl: '/api/search',
    normalizedEndpoint: '/api/search',
    status: 404,
    ok: false,
    responseBytes: 32,
  });
  const sample: RouteBenchmarkSample = {
    routeKey: 'lowZoom392',
    route: '/@51.0394976,4.4103663,3.92z',
    cacheMode: 'cold-cache',
    navigation: {
      gotoMs: 100,
      domContentLoadedMs: 75,
      loadEventMs: 120,
      firstContentfulPaintMs: 80,
    },
    requests: summarizeRequests([failedRequest]),
    tiles: summarizeTileRequests([failedRequest]),
    criticalRequests: summarizeCriticalRequests([failedRequest]),
    consoleErrors: [],
    map: {
      usableMs: 200,
      initialIdleMs: null,
      initialIdleTimedOut: true,
      settle: {
        panMs: null,
        panTimedOut: true,
        zoomMs: 300,
        zoomTimedOut: false,
      },
    },
  };

  const result = aggregateRouteBenchmark(
    'lowZoom392',
    '/@51.0394976,4.4103663,3.92z',
    'cold-cache',
    [sample],
    1,
    1,
  );

  assert.equal(result.routeKey, 'lowZoom392');
  assert.equal(result.cacheMode, 'cold-cache');
  assert.equal(result.samples[0]?.routeKey, 'lowZoom392');
  assert.equal(result.summary.requests.failedDetails.length, 1);
  assert.equal(result.summary.requests.failedDetails[0]?.routeKey, 'lowZoom392');
  assert.equal(result.summary.requests.failedDetails[0]?.cacheMode, 'cold-cache');
  assert.equal(result.summary.requests.failedDetails[0]?.status, 404);
  assert.equal(result.summary.tiles.abortedRequestDetails.length, 0);
});

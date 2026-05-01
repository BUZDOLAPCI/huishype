export const PROPERTY_TILE_RETRY_PROTOCOL = 'huishype-property-tile';
export const PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT =
  'huishype:property-tile-timeout-empty-exhausted';

const TIMEOUT_EMPTY_HEADER_VALUE = 'timeout-empty';
const MAX_TIMEOUT_EMPTY_ATTEMPTS = 5;
const TIMEOUT_EMPTY_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000];

type MapLibreProtocolApi = {
  addProtocol?: (
    protocol: string,
    loadFn: (
      request: {
        url: string;
        headers?: HeadersInit;
        method?: 'GET' | 'POST' | 'PUT';
        body?: BodyInit | null;
        credentials?: RequestCredentials;
        cache?: RequestCache;
        referrerPolicy?: ReferrerPolicy;
      },
      abortController: AbortController
    ) => Promise<{
      data: ArrayBuffer;
      cacheControl?: string;
      expires?: string;
      etag?: string;
    }>
  ) => void;
};

let registered = false;

export function resetPropertyTileRetryProtocolForTests(): void {
  registered = false;
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/$/, '');
}

function propertyTilePathPrefix(apiUrl: string): string {
  return `${normalizeApiUrl(apiUrl)}/tiles/properties/`;
}

function retryProtocolPrefix(): string {
  return `${PROPERTY_TILE_RETRY_PROTOCOL}://`;
}

function waitForRetryDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

function dispatchTimeoutEmptyExhausted(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT, {
      detail: { url },
    })
  );
}

export function wrapPropertyTileRetryProtocolUrl(apiUrl: string, tileUrl: string): string {
  const prefix = propertyTilePathPrefix(apiUrl);
  if (!tileUrl.startsWith(prefix)) {
    return tileUrl;
  }

  const suffix = tileUrl.slice(prefix.length);
  if (suffix.startsWith('read/')) {
    return tileUrl;
  }

  return `${retryProtocolPrefix()}tiles/properties/${suffix}`;
}

export function unwrapPropertyTileRetryProtocolUrl(apiUrl: string, tileUrl: string): string {
  const prefix = retryProtocolPrefix();
  if (!tileUrl.startsWith(prefix)) {
    return tileUrl;
  }

  return `${normalizeApiUrl(apiUrl)}/${tileUrl.slice(prefix.length)}`;
}

export function registerPropertyTileRetryProtocol(
  maplibre: MapLibreProtocolApi,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch
): void {
  if (registered || typeof maplibre.addProtocol !== 'function') {
    return;
  }

  registered = true;
  maplibre.addProtocol(PROPERTY_TILE_RETRY_PROTOCOL, async (request, abortController) => {
    const targetUrl = unwrapPropertyTileRetryProtocolUrl(apiUrl, request.url);
    const signal = abortController.signal;

    for (let attempt = 0; attempt < MAX_TIMEOUT_EMPTY_ATTEMPTS; attempt += 1) {
      if (signal.aborted) {
        throw signal.reason;
      }

      const response = await fetchImpl(targetUrl, {
        method: request.method ?? 'GET',
        body: request.body,
        credentials: request.credentials,
        headers: request.headers,
        cache: request.cache,
        referrerPolicy: request.referrerPolicy,
        signal,
      });
      const tileCacheState = response.headers.get('X-Tile-Cache');
      const isTimeoutEmpty =
        response.status === 204 && tileCacheState === TIMEOUT_EMPTY_HEADER_VALUE;

      if (isTimeoutEmpty) {
        const delayMs = TIMEOUT_EMPTY_RETRY_DELAYS_MS[attempt];
        if (delayMs == null) {
          dispatchTimeoutEmptyExhausted(targetUrl);
          throw new Error(`Property tile temporarily unavailable: ${targetUrl}`);
        }

        await waitForRetryDelay(delayMs, signal);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Property tile request failed with ${response.status}: ${targetUrl}`);
      }

      return {
        data: await response.arrayBuffer(),
        cacheControl: response.headers.get('Cache-Control') ?? undefined,
        expires: response.headers.get('Expires') ?? undefined,
        etag: response.headers.get('ETag') ?? undefined,
      };
    }

    dispatchTimeoutEmptyExhausted(targetUrl);
    throw new Error(`Property tile temporarily unavailable: ${targetUrl}`);
  });
}

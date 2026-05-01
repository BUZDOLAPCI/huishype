import {
  PROPERTY_TILE_RETRY_PROTOCOL,
  PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT,
  registerPropertyTileRetryProtocol,
  resetPropertyTileRetryProtocolForTests,
  unwrapPropertyTileRetryProtocolUrl,
  wrapPropertyTileRetryProtocolUrl,
} from '../propertyTileRetryProtocol';

function response(
  status: number,
  body: Uint8Array | null,
  headers: Record<string, string> = {}
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    arrayBuffer: async () =>
      body
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : new ArrayBuffer(0),
  } as Response;
}

type ProtocolLoadFn = (
  request: { url: string },
  abortController: AbortController
) => Promise<{
  data: ArrayBuffer;
  cacheControl?: string | null;
  etag?: string | null;
}>;

describe('property tile retry protocol', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPropertyTileRetryProtocolForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetPropertyTileRetryProtocolForTests();
  });

  it('wraps and unwraps public property tile template URLs', () => {
    const url = 'http://api.test/tiles/properties/{z}/{x}/{y}.pbf?marketState=for-sale';
    const wrapped = wrapPropertyTileRetryProtocolUrl('http://api.test/', url);

    expect(wrapped).toBe(
      `${PROPERTY_TILE_RETRY_PROTOCOL}://tiles/properties/{z}/{x}/{y}.pbf?marketState=for-sale`
    );
    expect(unwrapPropertyTileRetryProtocolUrl('http://api.test/', wrapped)).toBe(url);
  });

  it('leaves non-public property tile URLs unchanged', () => {
    const readTileUrl = 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf';

    expect(wrapPropertyTileRetryProtocolUrl('http://api.test', readTileUrl)).toBe(readTileUrl);
  });

  it('retries timeout-empty tile responses before returning data', async () => {
    let loadFn: ProtocolLoadFn | null = null;
    const maplibre = {
      addProtocol: jest.fn((_protocol: string, fn) => {
        loadFn = fn as ProtocolLoadFn;
      }),
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        response(204, null, {
          'X-Tile-Cache': 'timeout-empty',
        })
      )
      .mockResolvedValueOnce(
        response(200, new Uint8Array([1, 2, 3]), {
          'Cache-Control': 'public, max-age=300',
          ETag: '"etag"',
        })
      );

    registerPropertyTileRetryProtocol(maplibre, 'http://api.test', fetchImpl as unknown as typeof fetch);

    const promise = loadFn!(
      {
        url: `${PROPERTY_TILE_RETRY_PROTOCOL}://tiles/properties/12/1/2.pbf`,
      },
      new AbortController()
    );
    await jest.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://api.test/tiles/properties/12/1/2.pbf',
      expect.objectContaining({ method: 'GET' })
    );
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.cacheControl).toBe('public, max-age=300');
    expect(result.etag).toBe('"etag"');
  });

  it('dispatches a recovery event after retry exhaustion', async () => {
    let loadFn: ProtocolLoadFn | null = null;
    const maplibre = {
      addProtocol: jest.fn((_protocol: string, fn) => {
        loadFn = fn as ProtocolLoadFn;
      }),
    };
    const fetchImpl = jest.fn().mockResolvedValue(
      response(204, null, {
        'X-Tile-Cache': 'timeout-empty',
      })
    );
    const eventHandler = jest.fn();
    window.addEventListener(PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT, eventHandler);

    try {
      registerPropertyTileRetryProtocol(maplibre, 'http://api.test', fetchImpl as unknown as typeof fetch);

      const promise = loadFn!(
        {
          url: `${PROPERTY_TILE_RETRY_PROTOCOL}://tiles/properties/12/1/2.pbf`,
        },
        new AbortController()
      );
      const rejection = expect(promise).rejects.toThrow(
        'Property tile temporarily unavailable'
      );
      await jest.advanceTimersByTimeAsync(7_500);

      await rejection;
      expect(fetchImpl).toHaveBeenCalledTimes(5);
      expect(eventHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT, eventHandler);
    }
  });
});

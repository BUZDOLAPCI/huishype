import {
  applyReadPropertyFeatureStateStyles,
  buildReadTileRequestMatchPattern,
  buildFollowingTileRequestMatchPattern,
  fetchReadTileSource,
  getReadPropertyOverlayLayers,
  injectReadPropertyOverlay,
  PROPERTY_VECTOR_SOURCE_ID,
  PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
  READ_PROPERTY_FEATURE_STATE_KEY,
  READ_PROPERTY_VECTOR_SOURCE_ID,
  TILE_SESSION_PATH,
  replacePropertySourceTiles,
} from '../mapPropertySource';
import type { MapFilters } from '../sharedMapFilters';

describe('replacePropertySourceTiles', () => {
  it('updates the property vector source tiles immutably', () => {
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          tiles: ['http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}'],
        },
        other: {
          type: 'vector',
          tiles: ['http://example.com/other/{z}/{x}/{y}'],
        },
      },
    };

    const nextStyle = replacePropertySourceTiles(
      style,
      'http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}?salePriceFrom=500000'
    );

    expect(nextStyle).not.toBe(style);
    expect(nextStyle?.sources?.[PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}?salePriceFrom=500000',
    ]);
    const sources = nextStyle?.sources as Record<string, { promoteId?: string; tiles?: string[] }>;
    expect(sources[PROPERTY_VECTOR_SOURCE_ID]?.promoteId).toBe(PROPERTY_VECTOR_SOURCE_PROMOTE_ID);
    expect(nextStyle?.sources?.other?.tiles).toEqual(['http://example.com/other/{z}/{x}/{y}']);
  });

  it('adds the promoted feature id even when property vector tiles are unchanged', () => {
    const tileUrl = 'http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}';
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          tiles: [tileUrl],
        },
      },
    };

    const nextStyle = replacePropertySourceTiles(style, tileUrl);
    const sources = nextStyle?.sources as Record<string, { promoteId?: string; tiles?: string[] }>;

    expect(nextStyle).not.toBe(style);
    expect(sources[PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([tileUrl]);
    expect(sources[PROPERTY_VECTOR_SOURCE_ID]?.promoteId).toBe(PROPERTY_VECTOR_SOURCE_PROMOTE_ID);
  });

  it('replaces TileJSON url sources with explicit tiles for runtime filtering', () => {
    const tileUrl =
      'http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}?marketState=for-sale';
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          url: 'http://localhost:3100/tiles/public_property_nodes',
          tiles: ['http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}'],
        },
      },
    };

    const nextStyle = replacePropertySourceTiles(style, tileUrl);
    const source = nextStyle?.sources?.[PROPERTY_VECTOR_SOURCE_ID] as
      | { promoteId?: string; tiles?: string[]; url?: string }
      | undefined;

    expect(nextStyle).not.toBe(style);
    expect(source?.tiles).toEqual([tileUrl]);
    expect(source?.url).toBeUndefined();
    expect(source?.promoteId).toBe(PROPERTY_VECTOR_SOURCE_PROMOTE_ID);
  });
});

describe('Following tile source helpers', () => {
  it('matches Following tile requests using the tile template prefix', () => {
    const pattern = buildFollowingTileRequestMatchPattern(
      'https://tiles.test/tiles/private_following_property_nodes/{z}/{x}/{y}?marketState=for-sale'
    );

    expect(
      pattern.test('https://tiles.test/tiles/private_following_property_nodes/12/2048/1363')
    ).toBe(true);
    expect(pattern.test('https://tiles.test/tiles/public_property_nodes/12/2048/1363')).toBe(false);
  });
});

describe('Read tile source helpers', () => {
  const filters: MapFilters = {
    salePriceFrom: 500000,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: ['for-sale'],
    activity: 'today' as const,
  };

  it('matches read tile requests using only the private read tile template prefix', () => {
    const pattern = buildReadTileRequestMatchPattern(
      'https://tiles.test/tiles/private_read_property_nodes/{z}/{x}/{y}?marketState=for-sale&tile_session=abc'
    );

    expect(pattern.test('https://tiles.test/tiles/private_read_property_nodes/12/2048/1363')).toBe(
      true
    );
    expect(pattern.test('https://tiles.test/tiles/public_property_nodes/12/2048/1363')).toBe(false);
  });

  it('injects read overlay source and 60 percent opacity layers without changing the public source', () => {
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          tiles: ['http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}'],
        },
      },
      layers: [
        {
          id: 'active-nodes',
          type: 'circle',
          source: PROPERTY_VECTOR_SOURCE_ID,
        },
      ],
    };

    const nextStyle = injectReadPropertyOverlay(
      style,
      'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=abc'
    );

    expect(nextStyle).not.toBe(style);
    expect(nextStyle?.sources?.[PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}',
    ]);
    const sources = nextStyle?.sources as Record<string, { promoteId?: string; tiles?: string[] }>;
    expect(sources[READ_PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=abc',
    ]);
    expect(sources[READ_PROPERTY_VECTOR_SOURCE_ID]?.promoteId).toBe(
      PROPERTY_VECTOR_SOURCE_PROMOTE_ID
    );
    expect(nextStyle?.layers?.map((layer) => layer.id)).toEqual(
      expect.arrayContaining([
        'active-nodes',
        'read-active-nodes',
        'read-active-node-fill',
        'read-property-clusters',
        'read-property-cluster-fill',
      ])
    );
  });

  it('styles read layers with node colors instead of the retired grey overlay', () => {
    const readLayers = getReadPropertyOverlayLayers();
    const circlePaintValues = readLayers
      .filter((layer) => layer.type === 'circle')
      .map((layer) => layer.paint);

    expect(JSON.stringify(circlePaintValues)).not.toContain('#8A8F98');
    expect(JSON.stringify(circlePaintValues)).toContain('0.6');
  });

  it('can make read overlay layers invisible for web feature-state probing', () => {
    const readLayers = getReadPropertyOverlayLayers({ mode: 'probe' });
    const paintValues = readLayers.map((layer) => layer.paint);

    expect(readLayers.every((layer) => layer.type === 'circle')).toBe(true);
    expect(readLayers.map((layer) => layer.id)).not.toEqual(
      expect.arrayContaining(['read-cluster-count', 'read-ghost-cluster-count'])
    );
    expect(JSON.stringify(paintValues)).not.toContain('#8A8F98');
    expect(JSON.stringify(paintValues)).toContain('"circle-opacity":0');
    expect(JSON.stringify(paintValues)).not.toContain('"text-opacity"');
  });

  it('wraps public property layer opacity with read feature-state multiplier', () => {
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          tiles: ['http://localhost:3100/tiles/public_property_nodes/{z}/{x}/{y}'],
        },
      },
      layers: [
        {
          id: 'active-nodes',
          type: 'circle',
          source: PROPERTY_VECTOR_SOURCE_ID,
          'source-layer': 'properties',
          paint: {
            'circle-opacity': [
              'interpolate',
              ['linear'],
              ['get', 'activeListingCount'],
              0,
              0,
              1,
              0.96,
            ],
            'circle-stroke-opacity': [
              'interpolate',
              ['linear'],
              ['get', 'activeListingCount'],
              0,
              0,
              1,
              0.96,
            ],
          },
        },
        {
          id: 'active-node-fill',
          type: 'circle',
          source: PROPERTY_VECTOR_SOURCE_ID,
          'source-layer': 'properties',
          paint: {
            'circle-opacity': ['case', ['>', ['get', 'socialCount'], 0], 0.96, 0.8],
            'circle-stroke-opacity': 0.9,
          },
        },
        {
          id: 'cluster-count',
          type: 'symbol',
          source: PROPERTY_VECTOR_SOURCE_ID,
          'source-layer': 'properties',
          paint: {
            'text-color': '#FFFFFF',
          },
        },
      ],
    };

    const nextStyle = applyReadPropertyFeatureStateStyles(style);
    const activeRingPaint = nextStyle?.layers?.find((layer) => layer.id === 'active-nodes')
      ?.paint as Record<string, unknown> | undefined;
    const activeFillPaint = nextStyle?.layers?.find((layer) => layer.id === 'active-node-fill')
      ?.paint as Record<string, unknown> | undefined;
    const clusterPaint = nextStyle?.layers?.find((layer) => layer.id === 'cluster-count')?.paint;

    expect(JSON.stringify(activeRingPaint?.['circle-opacity'])).toContain(
      READ_PROPERTY_FEATURE_STATE_KEY
    );
    expect(activeRingPaint?.['circle-opacity']).toEqual(expect.arrayContaining([0]));
    expect(JSON.stringify(activeFillPaint)).toContain(READ_PROPERTY_FEATURE_STATE_KEY);
    expect(JSON.stringify(activeFillPaint)).toContain('0.6');
    expect(JSON.stringify(activeFillPaint?.['circle-stroke-width'])).toContain(
      'activeListingCount'
    );
    expect(JSON.stringify(activeFillPaint?.['circle-stroke-color'])).toContain('#2563EB');
    expect(JSON.stringify(clusterPaint)).toContain(READ_PROPERTY_FEATURE_STATE_KEY);
    expect(JSON.stringify(clusterPaint)).toContain('"text-opacity"');
  });

  it('fetches a signed read tile session with the supplied private credential', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        expiresAt: '2026-04-29T12:00:00.000Z',
        tileTemplate:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?marketState=for-sale&tile_session=stable',
        cacheBustedTileTemplate:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?marketState=for-sale&tile_session=cache',
      }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const source = await fetchReadTileSource(
      'http://localhost:3100',
      filters,
      {
        headerName: 'x-session-id',
        headerValue: 'session-123',
      },
      4
    );

    expect(mockFetch).toHaveBeenCalledWith(`http://localhost:3100${TILE_SESSION_PATH}`, {
      method: 'POST',
      headers: {
        'x-session-id': 'session-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: 'read',
        salePriceFrom: 500000,
        marketState: ['for-sale'],
        activity: 'today',
      }),
    });
    expect(source.tileUrl).toBe(
      'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?marketState=for-sale&tile_session=stable'
    );
    expect(source.cacheBustedTileUrl).toBe(
      'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?marketState=for-sale&tile_session=cache'
    );
    expect(source.expiresAt).toBe('2026-04-29T12:00:00.000Z');
  });

  it('treats read tile sessions without templates as no active overlay', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tileTemplate: null, cacheBustedTileTemplate: null }),
    }) as unknown as typeof fetch;

    const source = await fetchReadTileSource(
      'http://localhost:3100',
      filters,
      {
        headerName: 'x-session-id',
        headerValue: 'session-empty',
      },
      0
    );

    expect(source.tileUrl).toBeNull();
    expect(source.cacheBustedTileUrl).toBeNull();
    expect(source.tileJson).toEqual({ tileTemplate: null, cacheBustedTileTemplate: null });
  });

  it('returns a stable tile template plus a cache-busted read template from the tile session response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tileTemplate:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=stable',
        cacheBustedTileTemplate:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=cache',
      }),
    }) as jest.Mock;

    await expect(
      fetchReadTileSource(
        'http://localhost:3100/',
        filters,
        {
          headerName: 'x-session-id',
          headerValue: 'session-123',
        },
        2
      )
    ).resolves.toEqual(
      expect.objectContaining({
        tileJsonUrl: 'http://localhost:3100/tiles/sessions',
        tileUrl:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=stable',
        cacheBustedTileUrl:
          'http://localhost:3100/tiles/private_read_property_nodes/{z}/{x}/{y}?tile_session=cache',
        version: 2,
      })
    );
  });
});

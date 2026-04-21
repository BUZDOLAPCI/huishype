import {
  buildReadTileJsonUrl,
  buildReadTileRequestMatchPattern,
  buildFollowingTileJsonCandidateUrls,
  buildFollowingTileRequestMatchPattern,
  fetchReadTileSource,
  FOLLOWING_TILEJSON_PATH,
  injectReadPropertyOverlay,
  PROPERTY_VECTOR_SOURCE_ID,
  READ_PROPERTY_VECTOR_SOURCE_ID,
  READ_TILEJSON_PATH,
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
          tiles: ['http://localhost:3100/tiles/properties/{z}/{x}/{y}.pbf'],
        },
        other: {
          type: 'vector',
          tiles: ['http://example.com/other/{z}/{x}/{y}.pbf'],
        },
      },
    };

    const nextStyle = replacePropertySourceTiles(
      style,
      'http://localhost:3100/tiles/properties/{z}/{x}/{y}.pbf?salePriceFrom=500000',
    );

    expect(nextStyle).not.toBe(style);
    expect(nextStyle?.sources?.[PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/properties/{z}/{x}/{y}.pbf?salePriceFrom=500000',
    ]);
    expect(nextStyle?.sources?.other?.tiles).toEqual([
      'http://example.com/other/{z}/{x}/{y}.pbf',
    ]);
  });
});

describe('Following tile source helpers', () => {
  it('builds the authenticated Following TileJSON URL from the canonical backend route', () => {
    expect(
      buildFollowingTileJsonCandidateUrls('http://localhost:3100/', {
        salePriceFrom: 500000,
        salePriceTo: 800000,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale'],
        activity: '30d',
      }),
    ).toEqual([
      `http://localhost:3100${FOLLOWING_TILEJSON_PATH}?salePriceFrom=500000&salePriceTo=800000&marketState=for-sale&activity=all-time`,
    ]);
  });

  it('uses independent Following activity instead of the public activity filter', () => {
    expect(
      buildFollowingTileJsonCandidateUrls(
        'http://localhost:3100/',
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: '30d',
        },
        'today',
      ),
    ).toEqual([`http://localhost:3100${FOLLOWING_TILEJSON_PATH}?activity=today`]);
  });

  it('matches Following tile requests using the tile template prefix', () => {
    const pattern = buildFollowingTileRequestMatchPattern(
      'https://tiles.test/following/{z}/{x}/{y}.pbf?marketState=for-sale',
    );

    expect(pattern.test('https://tiles.test/following/12/2048/1363.pbf')).toBe(true);
    expect(pattern.test('https://tiles.test/public/12/2048/1363.pbf')).toBe(false);
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

  it('builds the private read TileJSON URL with map filters and read version', () => {
    expect(buildReadTileJsonUrl('http://localhost:3100/', filters, 3)).toBe(
      `http://localhost:3100${READ_TILEJSON_PATH}?salePriceFrom=500000&marketState=for-sale&activity=today&readVersion=3`,
    );
  });

  it('matches read tile requests using only the private read tile template prefix', () => {
    const pattern = buildReadTileRequestMatchPattern(
      'https://tiles.test/tiles/properties/read/{z}/{x}/{y}.pbf?marketState=for-sale&readVersion=2',
    );

    expect(pattern.test('https://tiles.test/tiles/properties/read/12/2048/1363.pbf')).toBe(true);
    expect(pattern.test('https://tiles.test/tiles/properties/12/2048/1363.pbf')).toBe(false);
  });

  it('injects read overlay source and low-emphasis layers without changing the public source', () => {
    const style = {
      version: 8,
      sources: {
        [PROPERTY_VECTOR_SOURCE_ID]: {
          type: 'vector',
          tiles: ['http://localhost:3100/tiles/properties/{z}/{x}/{y}.pbf'],
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
      'http://localhost:3100/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=1',
    );

    expect(nextStyle).not.toBe(style);
    expect(nextStyle?.sources?.[PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/properties/{z}/{x}/{y}.pbf',
    ]);
    const sources = nextStyle?.sources as Record<string, { tiles?: string[] }>;
    expect(sources[READ_PROPERTY_VECTOR_SOURCE_ID]?.tiles).toEqual([
      'http://localhost:3100/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=1',
    ]);
    expect(nextStyle?.layers?.map((layer) => layer.id)).toEqual(
      expect.arrayContaining(['active-nodes', 'read-active-nodes', 'read-property-clusters']),
    );
  });

  it('fetches read TileJSON with the supplied private credential and versions tile templates', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tiles: ['http://localhost:3100/tiles/properties/read/{z}/{x}/{y}.pbf?marketState=for-sale'],
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
      4,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100${READ_TILEJSON_PATH}?salePriceFrom=500000&marketState=for-sale&activity=today&readVersion=4`,
      {
        headers: {
          'x-session-id': 'session-123',
        },
      },
    );
    expect(source.tileUrl).toBe(
      'http://localhost:3100/tiles/properties/read/{z}/{x}/{y}.pbf?marketState=for-sale&readVersion=4',
    );
    expect(source.headerName).toBe('x-session-id');
    expect(source.headerValue).toBe('session-123');
  });

  it('treats read TileJSON without tiles as no active overlay', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tiles: [] }),
    }) as unknown as typeof fetch;

    const source = await fetchReadTileSource(
      'http://localhost:3100',
      filters,
      {
        headerName: 'x-session-id',
        headerValue: 'session-empty',
      },
      0,
    );

    expect(source.tileUrl).toBeNull();
    expect(source.tileJson).toEqual({ tiles: [] });
  });
});

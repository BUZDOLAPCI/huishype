import {
  buildFollowingTileJsonCandidateUrls,
  buildFollowingTileRequestMatchPattern,
  FOLLOWING_TILEJSON_PATH,
  PROPERTY_VECTOR_SOURCE_ID,
  replacePropertySourceTiles,
} from '../mapPropertySource';

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
        activity: 'all',
      }),
    ).toEqual([
      `http://localhost:3100${FOLLOWING_TILEJSON_PATH}?salePriceFrom=500000&salePriceTo=800000&marketState=for-sale`,
    ]);
  });

  it('matches Following tile requests using the tile template prefix', () => {
    const pattern = buildFollowingTileRequestMatchPattern(
      'https://tiles.test/following/{z}/{x}/{y}.pbf?marketState=for-sale',
    );

    expect(pattern.test('https://tiles.test/following/12/2048/1363.pbf')).toBe(true);
    expect(pattern.test('https://tiles.test/public/12/2048/1363.pbf')).toBe(false);
  });
});

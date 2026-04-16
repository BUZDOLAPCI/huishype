import {
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

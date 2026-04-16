export const PROPERTY_VECTOR_SOURCE_ID = 'properties-source';

type SourceLike = {
  tiles?: string[];
  [key: string]: unknown;
};

type StyleLike = {
  sources?: Record<string, SourceLike>;
  [key: string]: unknown;
};

export function replacePropertySourceTiles<T extends StyleLike | null>(
  style: T,
  tileUrl: string,
): T {
  if (!style?.sources) {
    return style;
  }

  const currentSource = style.sources[PROPERTY_VECTOR_SOURCE_ID];
  if (!currentSource) {
    return style;
  }

  if (
    Array.isArray(currentSource.tiles) &&
    currentSource.tiles.length === 1 &&
    currentSource.tiles[0] === tileUrl
  ) {
    return style;
  }

  return {
    ...style,
    sources: {
      ...style.sources,
      [PROPERTY_VECTOR_SOURCE_ID]: {
        ...currentSource,
        tiles: [tileUrl],
      },
    },
  };
}

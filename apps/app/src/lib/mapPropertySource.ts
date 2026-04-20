import type { MapFilters } from './sharedMapFilters';

export const PROPERTY_VECTOR_SOURCE_ID = 'properties-source';
export const FOLLOWING_TILEJSON_PATH = '/tiles/following/properties.json';

export interface TileJsonLike {
  tiles?: unknown;
  [key: string]: unknown;
}

export interface ResolvedFollowingTileSource {
  tileJsonUrl: string;
  tileUrl: string;
  tileJson: TileJsonLike;
}

type SourceLike = {
  tiles?: string[];
  [key: string]: unknown;
};

type StyleLike = {
  sources?: Record<string, SourceLike>;
  [key: string]: unknown;
};

function buildFollowingTileSearchParams(filters: MapFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.salePriceFrom != null) {
    params.set('salePriceFrom', String(filters.salePriceFrom));
  }
  if (filters.salePriceTo != null) {
    params.set('salePriceTo', String(filters.salePriceTo));
  }
  if (filters.rentPriceFrom != null) {
    params.set('rentPriceFrom', String(filters.rentPriceFrom));
  }
  if (filters.rentPriceTo != null) {
    params.set('rentPriceTo', String(filters.rentPriceTo));
  }
  if (filters.marketState.length > 0 && filters.marketState.length < 5) {
    params.set('marketState', filters.marketState.join(','));
  }

  return params;
}

export function buildFollowingTileJsonCandidateUrls(
  apiUrl: string,
  filters: MapFilters,
): string[] {
  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const search = buildFollowingTileSearchParams(filters).toString();
  const suffix = search.length > 0 ? `?${search}` : '';

  return [`${normalizedApiUrl}${FOLLOWING_TILEJSON_PATH}${suffix}`];
}

async function createApiError(response: Response) {
  const fallback = `HTTP error! status: ${response.status}`;
  const payload = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  const { ApiError: ApiErrorClass } = await import('@/src/utils/api');

  return new ApiErrorClass(
    response.status,
    payload?.message || fallback,
    payload?.error,
  );
}

export async function fetchFollowingTileSource(
  apiUrl: string,
  filters: MapFilters,
  accessToken: string,
): Promise<ResolvedFollowingTileSource> {
  const candidateUrls = buildFollowingTileJsonCandidateUrls(apiUrl, filters);

  for (const candidateUrl of candidateUrls) {
    const response = await fetch(candidateUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      throw await createApiError(response);
    }

    const tileJson = (await response.json()) as TileJsonLike;
    const tileUrl = Array.isArray(tileJson.tiles)
      ? tileJson.tiles.find(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ) ?? null
      : null;

    if (!tileUrl) {
      throw new Error(
        `Following TileJSON at ${candidateUrl} did not include a usable tile template.`,
      );
    }

    return {
      tileJsonUrl: candidateUrl,
      tileUrl,
      tileJson,
    };
  }

  throw new Error(
    `Following TileJSON route unavailable. Tried ${candidateUrls.join(', ')}`,
  );
}

export function buildFollowingTileRequestMatchPattern(tileUrl: string): RegExp {
  const templatePrefix = tileUrl.split('{z}')[0] ?? tileUrl;
  const escapedPrefix = templatePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPrefix}`);
}

export function replacePropertySourceTiles<T extends StyleLike | null>(
  style: T,
  tileUrl: string | string[],
): T {
  if (!style?.sources) {
    return style;
  }

  const currentSource = style.sources[PROPERTY_VECTOR_SOURCE_ID];
  if (!currentSource) {
    return style;
  }

  const nextTiles = Array.isArray(tileUrl) ? tileUrl : [tileUrl];

  if (
    Array.isArray(currentSource.tiles) &&
    currentSource.tiles.length === nextTiles.length &&
    currentSource.tiles.every((value, index) => value === nextTiles[index])
  ) {
    return style;
  }

  return {
    ...style,
    sources: {
      ...style.sources,
      [PROPERTY_VECTOR_SOURCE_ID]: {
        ...currentSource,
        tiles: nextTiles,
      },
    },
  };
}

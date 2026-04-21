import {
  getMapFilterSearchString,
  type MapActivityFilter,
  type MapFilters,
} from './sharedMapFilters';

export const PROPERTY_VECTOR_SOURCE_ID = 'properties-source';
export const READ_PROPERTY_VECTOR_SOURCE_ID = 'read-properties-source';
export const FOLLOWING_TILEJSON_PATH = '/tiles/following/properties.json';
export const READ_TILEJSON_PATH = '/tiles/properties/read.json';

const READ_OVERLAY_LAYER_IDS = [
  'read-property-clusters',
  'read-cluster-count',
  'read-active-nodes',
  'read-ghost-clusters',
  'read-ghost-cluster-count',
  'read-ghost-nodes',
] as const;

const READ_NODE_COLOR = '#8A8F98';
const READ_NODE_STROKE_COLOR = '#FFFFFF';
const READ_LABEL_COLOR = '#F8FAFC';
const READ_LABEL_HALO_COLOR = 'rgba(71, 85, 105, 0.45)';

export interface TileJsonLike {
  tiles?: unknown;
  [key: string]: unknown;
}

export interface ResolvedFollowingTileSource {
  tileJsonUrl: string;
  tileUrl: string;
  tileJson: TileJsonLike;
}

export interface ReadTileCredential {
  headerName: 'Authorization' | 'x-session-id';
  headerValue: string;
}

export interface ResolvedReadTileSource extends ReadTileCredential {
  tileJsonUrl: string;
  tileUrl: string | null;
  tileJson: TileJsonLike;
  version: number;
}

type SourceLike = {
  tiles?: string[];
  [key: string]: unknown;
};

type StyleLike = {
  sources?: Record<string, SourceLike>;
  layers?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type CircleLayerLike = Record<string, unknown> & {
  id: string;
  type: 'circle';
  source: string;
};

type SymbolLayerLike = Record<string, unknown> & {
  id: string;
  type: 'symbol';
  source: string;
};

function buildFollowingTileSearchParams(
  filters: MapFilters,
  followingActivity: MapActivityFilter
): URLSearchParams {
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
  if (followingActivity !== 'all') {
    params.set('activity', followingActivity);
  }

  return params;
}

export function buildFollowingTileJsonCandidateUrls(
  apiUrl: string,
  filters: MapFilters,
  followingActivity: MapActivityFilter = 'all-time'
): string[] {
  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const search = buildFollowingTileSearchParams(filters, followingActivity).toString();
  const suffix = search.length > 0 ? `?${search}` : '';

  return [`${normalizedApiUrl}${FOLLOWING_TILEJSON_PATH}${suffix}`];
}

function appendSearchParam(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function withReadVersion(url: string, version: number): string {
  return version > 0 ? appendSearchParam(url, 'readVersion', String(version)) : url;
}

export function buildReadTileJsonUrl(
  apiUrl: string,
  filters: MapFilters,
  version = 0
): string {
  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const baseUrl = `${normalizedApiUrl}${READ_TILEJSON_PATH}${getMapFilterSearchString(filters)}`;

  return withReadVersion(baseUrl, version);
}

async function createApiError(response: Response) {
  const fallback = `HTTP error! status: ${response.status}`;
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  const { ApiError: ApiErrorClass } = await import('@/src/utils/api');

  return new ApiErrorClass(response.status, payload?.message || fallback, payload?.error);
}

export async function fetchFollowingTileSource(
  apiUrl: string,
  filters: MapFilters,
  followingActivity: MapActivityFilter,
  accessToken: string
): Promise<ResolvedFollowingTileSource> {
  const candidateUrls = buildFollowingTileJsonCandidateUrls(apiUrl, filters, followingActivity);

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
      ? (tileJson.tiles.find(
          (value): value is string => typeof value === 'string' && value.length > 0
        ) ?? null)
      : null;

    if (!tileUrl) {
      throw new Error(
        `Following TileJSON at ${candidateUrl} did not include a usable tile template.`
      );
    }

    return {
      tileJsonUrl: candidateUrl,
      tileUrl,
      tileJson,
    };
  }

  throw new Error(`Following TileJSON route unavailable. Tried ${candidateUrls.join(', ')}`);
}

export async function fetchReadTileSource(
  apiUrl: string,
  filters: MapFilters,
  credential: ReadTileCredential,
  version = 0
): Promise<ResolvedReadTileSource> {
  const tileJsonUrl = buildReadTileJsonUrl(apiUrl, filters, version);
  const response = await fetch(tileJsonUrl, {
    headers: {
      [credential.headerName]: credential.headerValue,
    },
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  const tileJson = (await response.json()) as TileJsonLike;
  const rawTileUrl = Array.isArray(tileJson.tiles)
    ? (tileJson.tiles.find(
        (value): value is string => typeof value === 'string' && value.length > 0
      ) ?? null)
    : null;

  return {
    ...credential,
    tileJsonUrl,
    tileUrl: rawTileUrl ? withReadVersion(rawTileUrl, version) : null,
    tileJson,
    version,
  };
}

export function buildFollowingTileRequestMatchPattern(tileUrl: string): RegExp {
  const templatePrefix = tileUrl.split('{z}')[0] ?? tileUrl;
  const escapedPrefix = templatePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPrefix}`);
}

export function buildReadTileRequestMatchPattern(tileUrl: string): RegExp {
  return buildFollowingTileRequestMatchPattern(tileUrl);
}

export function getReadPropertyOverlayLayers(): Array<CircleLayerLike | SymbolLayerLike> {
  return [
    {
      id: READ_OVERLAY_LAYER_IDS[0],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': ['step', ['coalesce', ['get', 'point_count'], 2], 16, 10, 18, 50, 21],
        'circle-color': READ_NODE_COLOR,
        'circle-opacity': 0.78,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': READ_NODE_STROKE_COLOR,
        'circle-stroke-opacity': 0.86,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[1],
      type: 'symbol',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      layout: {
        'text-field': ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      },
      paint: {
        'text-color': READ_LABEL_COLOR,
        'text-halo-color': READ_LABEL_HALO_COLOR,
        'text-halo-width': 1,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[2],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 7, 18, 9],
        'circle-color': READ_NODE_COLOR,
        'circle-opacity': 0.78,
        'circle-stroke-width': 1.25,
        'circle-stroke-color': READ_NODE_STROKE_COLOR,
        'circle-stroke-opacity': 0.82,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[3],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      minzoom: 17,
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'ghost'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': ['step', ['coalesce', ['get', 'point_count'], 2], 10, 10, 12, 50, 14],
        'circle-color': READ_NODE_COLOR,
        'circle-opacity': 0.56,
        'circle-stroke-width': 1,
        'circle-stroke-color': READ_NODE_STROKE_COLOR,
        'circle-stroke-opacity': 0.72,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[4],
      type: 'symbol',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      minzoom: 17,
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'ghost'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      layout: {
        'text-field': ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
      },
      paint: {
        'text-color': READ_LABEL_COLOR,
        'text-halo-color': READ_LABEL_HALO_COLOR,
        'text-halo-width': 1,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[5],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      minzoom: 17,
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'ghost'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': 4,
        'circle-color': READ_NODE_COLOR,
        'circle-opacity': 0.55,
        'circle-stroke-width': 1,
        'circle-stroke-color': READ_NODE_STROKE_COLOR,
        'circle-stroke-opacity': 0.7,
      },
    },
  ];
}

export function injectReadPropertyOverlay<T extends StyleLike | null>(
  style: T,
  tileUrl: string | string[] | null | undefined
): T {
  if (!style?.sources) {
    return style;
  }

  const nextTiles = tileUrl == null ? [] : Array.isArray(tileUrl) ? tileUrl : [tileUrl];
  const readLayerIds = new Set<string>(READ_OVERLAY_LAYER_IDS);
  const currentLayers = Array.isArray(style.layers) ? style.layers : [];
  const nonReadLayers = currentLayers.filter((layer) => !readLayerIds.has(String(layer.id)));
  const nonReadSources = { ...style.sources };
  delete nonReadSources[READ_PROPERTY_VECTOR_SOURCE_ID];

  if (nextTiles.length === 0) {
    return {
      ...style,
      sources: nonReadSources,
      layers: nonReadLayers,
    };
  }

  return {
    ...style,
    sources: {
      ...nonReadSources,
      [READ_PROPERTY_VECTOR_SOURCE_ID]: {
        type: 'vector',
        tiles: nextTiles,
        minzoom: 0,
        maxzoom: 22,
      },
    },
    layers: [...nonReadLayers, ...getReadPropertyOverlayLayers()],
  };
}

export function replacePropertySourceTiles<T extends StyleLike | null>(
  style: T,
  tileUrl: string | string[]
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

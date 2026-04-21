import {
  getMapFilterSearchString,
  type MapActivityFilter,
  type MapFilters,
} from './sharedMapFilters';
import {
  MAP_NODE_GHOST_CLUSTER_VISUAL,
  MAP_NODE_GHOST_SINGLE_VISUAL,
  MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS,
  MAP_NODE_NON_LISTING_OUTLINE_COLOR,
  MAP_NODE_NON_LISTING_OUTLINE_WIDTH,
  MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
  MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
  PROPERTY_MAP_FOOTPRINTS,
  type NumericStop,
} from '@huishype/shared/config';

export const PROPERTY_VECTOR_SOURCE_ID = 'properties-source';
export const READ_PROPERTY_VECTOR_SOURCE_ID = 'read-properties-source';
export const PROPERTY_VECTOR_SOURCE_PROMOTE_ID = 'primary_property_id';
export const READ_PROPERTY_FEATURE_STATE_KEY = 'read';
export const FOLLOWING_TILEJSON_PATH = '/tiles/following/properties.json';
export const READ_TILEJSON_PATH = '/tiles/properties/read.json';

export const READ_OVERLAY_LAYER_IDS = [
  'read-property-clusters',
  'read-property-cluster-fill',
  'read-cluster-count',
  'read-active-nodes',
  'read-active-node-fill',
  'read-ghost-clusters',
  'read-ghost-cluster-count',
  'read-ghost-nodes',
] as const;

const READ_NODE_OPACITY = 0.6;
const READ_PROBE_OPACITY = 0;
const READ_NODE_STROKE_COLOR = '#FFFFFF';
const READ_LABEL_OPACITY = 0.6;
const READ_ACTIVE_CLUSTER_LABEL_COLOR = '#FFFFFF';
const READ_ACTIVE_CLUSTER_LABEL_HALO_COLOR = 'rgba(0, 0, 0, 0.25)';
const PROPERTY_VECTOR_SOURCE_LAYER = 'properties';
const ACTIVE_CLUSTER_RING_LAYER_ID = 'property-clusters';
const ACTIVE_CLUSTER_FILL_LAYER_ID = 'property-cluster-fill';
const ACTIVE_NODE_RING_LAYER_ID = 'active-nodes';
const ACTIVE_NODE_FILL_LAYER_ID = 'active-node-fill';

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

interface ReadPropertyOverlayLayerOptions {
  mode?: 'visible' | 'probe';
}

function buildStepExpression(
  input: unknown,
  stops: readonly NumericStop[]
): [string, unknown, number, ...(number | string)[]] {
  const [firstStop, ...restStops] = stops;
  return ['step', input, firstStop[1], ...restStops.flatMap(([threshold, value]) => [threshold, value])];
}

function buildInterpolateExpression<TValue extends number | string>(
  input: unknown,
  stops: ReadonlyArray<readonly [threshold: number, value: TValue]>
): [string, string[], unknown, ...(number | string)[]] {
  return ['interpolate', ['linear'], input, ...stops.flatMap(([threshold, value]) => [threshold, value])];
}

function buildPropertyFieldExpression(field: string, fallback = 0): unknown[] {
  return ['coalesce', ['get', field], fallback];
}

function buildListingShareExpression(): unknown[] {
  const pointCount = buildPropertyFieldExpression('point_count', 1);
  return [
    'case',
    ['>', pointCount, 0],
    ['/', buildPropertyFieldExpression('activeListingCount'), pointCount],
    0,
  ];
}

function buildReadStateExpression(): unknown[] {
  return ['boolean', ['feature-state', READ_PROPERTY_FEATURE_STATE_KEY], false];
}

function buildReadFeatureStateOpacityExpression(baseOpacity: unknown): unknown[] {
  return [
    'case',
    buildReadStateExpression(),
    ['*', baseOpacity, READ_NODE_OPACITY],
    baseOpacity,
  ];
}

function buildReadListingCondition(listingMetric: unknown): unknown[] {
  return ['all', buildReadStateExpression(), ['>', listingMetric, 0]];
}

function buildReadListingRingUnderlayOpacityExpression(
  baseOpacity: unknown,
  listingMetric: unknown
): unknown[] {
  return [
    'case',
    buildReadListingCondition(listingMetric),
    0,
    buildReadFeatureStateOpacityExpression(baseOpacity),
  ];
}

function applyReadListingStrokeStyle(
  paint: Record<string, unknown>,
  listingMetric: unknown,
  ringWidth: unknown,
  ringColor: unknown,
  ringOpacity: unknown
): Record<string, unknown> {
  return {
    ...paint,
    'circle-stroke-width': [
      'case',
      buildReadListingCondition(listingMetric),
      ringWidth,
      paint['circle-stroke-width'] ?? 0,
    ],
    'circle-stroke-color': [
      'case',
      buildReadListingCondition(listingMetric),
      ringColor,
      paint['circle-stroke-color'] ?? READ_NODE_STROKE_COLOR,
    ],
    'circle-stroke-opacity': [
      'case',
      buildReadListingCondition(listingMetric),
      ['*', ringOpacity, READ_NODE_OPACITY],
      buildReadFeatureStateOpacityExpression(paint['circle-stroke-opacity'] ?? 1),
    ],
  };
}

function applyProbeOpacity(layer: CircleLayerLike | SymbolLayerLike): CircleLayerLike | SymbolLayerLike {
  if (layer.type === 'circle') {
    return {
      ...layer,
      paint: {
        ...(layer.paint as Record<string, unknown> | undefined),
        'circle-opacity': READ_PROBE_OPACITY,
        'circle-stroke-opacity': READ_PROBE_OPACITY,
      },
    };
  }

  return {
    ...layer,
    paint: {
      ...(layer.paint as Record<string, unknown> | undefined),
      'text-opacity': READ_PROBE_OPACITY,
    },
  };
}

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

export function getReadPropertyOverlayLayers(
  options: ReadPropertyOverlayLayerOptions = {}
): Array<CircleLayerLike | SymbolLayerLike> {
  const activeClusterRadius = buildStepExpression(
    ['coalesce', ['get', 'point_count'], 2],
    PROPERTY_MAP_FOOTPRINTS.active.clusterRadiusStopsPx
  );
  const activeNodeRadius = buildInterpolateExpression(
    ['coalesce', ['get', 'socialScoreMax'], 0],
    PROPERTY_MAP_FOOTPRINTS.active.singleRadiusStopsPx
  );
  const activeListingCount = buildPropertyFieldExpression('activeListingCount');
  const listingShare = buildListingShareExpression();
  const activeClusterRingWidth = buildInterpolateExpression(
    listingShare,
    MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS
  );
  const activeNodeRingWidth = buildInterpolateExpression(
    activeListingCount,
    MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS
  );

  const layers: Array<CircleLayerLike | SymbolLayerLike> = [
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
        'circle-radius': ['+', activeClusterRadius, activeClusterRingWidth],
        'circle-color': buildInterpolateExpression(
          listingShare,
          MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS
        ),
        'circle-opacity': ['case', ['>', listingShare, 0], READ_NODE_OPACITY, 0],
        'circle-stroke-width': 0,
        'circle-stroke-color': READ_NODE_STROKE_COLOR,
        'circle-stroke-opacity': ['case', ['>', listingShare, 0], READ_NODE_OPACITY, 0],
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[1],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': activeClusterRadius,
        'circle-color': [
          'case',
          ['>', buildPropertyFieldExpression('socialCount'), 0],
          MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
          MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
        ],
        'circle-opacity': READ_NODE_OPACITY,
        'circle-stroke-width': ['case', ['>', listingShare, 0], 0, MAP_NODE_NON_LISTING_OUTLINE_WIDTH],
        'circle-stroke-color': MAP_NODE_NON_LISTING_OUTLINE_COLOR,
        'circle-stroke-opacity': ['case', ['>', listingShare, 0], 0, READ_NODE_OPACITY],
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[2],
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
        'text-color': READ_ACTIVE_CLUSTER_LABEL_COLOR,
        'text-halo-color': READ_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
        'text-halo-width': 1,
        'text-opacity': READ_LABEL_OPACITY,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[3],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': ['+', activeNodeRadius, activeNodeRingWidth],
        'circle-color': buildInterpolateExpression(
          activeListingCount,
          MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS
        ),
        'circle-opacity': ['case', ['>', activeListingCount, 0], READ_NODE_OPACITY, 0],
        'circle-stroke-width': 0,
        'circle-stroke-color': MAP_NODE_NON_LISTING_OUTLINE_COLOR,
        'circle-stroke-opacity': ['case', ['>', activeListingCount, 0], READ_NODE_OPACITY, 0],
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[4],
      type: 'circle',
      source: READ_PROPERTY_VECTOR_SOURCE_ID,
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': activeNodeRadius,
        'circle-color': [
          'case',
          ['>', buildPropertyFieldExpression('socialCount'), 0],
          MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
          MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
        ],
        'circle-opacity': READ_NODE_OPACITY,
        'circle-stroke-width': ['case', ['>', activeListingCount, 0], 0, MAP_NODE_NON_LISTING_OUTLINE_WIDTH],
        'circle-stroke-color': MAP_NODE_NON_LISTING_OUTLINE_COLOR,
        'circle-stroke-opacity': ['case', ['>', activeListingCount, 0], 0, READ_NODE_OPACITY],
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
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': buildStepExpression(
          ['coalesce', ['get', 'point_count'], 2],
          PROPERTY_MAP_FOOTPRINTS.ghost.clusterRadiusStopsPx
        ),
        'circle-color': MAP_NODE_GHOST_CLUSTER_VISUAL.fill,
        'circle-opacity': READ_NODE_OPACITY,
        'circle-stroke-width': MAP_NODE_GHOST_CLUSTER_VISUAL.strokeWidth,
        'circle-stroke-color': MAP_NODE_GHOST_CLUSTER_VISUAL.strokeColor,
        'circle-stroke-opacity': READ_NODE_OPACITY,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[6],
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
        'text-color': MAP_NODE_GHOST_CLUSTER_VISUAL.labelColor,
        'text-halo-color': MAP_NODE_GHOST_CLUSTER_VISUAL.labelHaloColor,
        'text-halo-width': 1,
        'text-opacity': READ_LABEL_OPACITY,
      },
    },
    {
      id: READ_OVERLAY_LAYER_IDS[7],
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
        'circle-radius': PROPERTY_MAP_FOOTPRINTS.ghost.singleRadiusPx,
        'circle-color': MAP_NODE_GHOST_SINGLE_VISUAL.fill,
        'circle-opacity': READ_NODE_OPACITY,
        'circle-stroke-width': MAP_NODE_GHOST_SINGLE_VISUAL.strokeWidth,
        'circle-stroke-color': MAP_NODE_GHOST_SINGLE_VISUAL.strokeColor,
        'circle-stroke-opacity': READ_NODE_OPACITY,
      },
    },
  ];

  return options.mode === 'probe' ? layers.map(applyProbeOpacity) : layers;
}

export function applyReadPropertyFeatureStateStyles<T extends StyleLike | null>(style: T): T {
  if (!style?.layers) {
    return style;
  }

  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (
        layer.source !== PROPERTY_VECTOR_SOURCE_ID ||
        layer['source-layer'] !== PROPERTY_VECTOR_SOURCE_LAYER ||
        READ_OVERLAY_LAYER_IDS.includes(String(layer.id) as (typeof READ_OVERLAY_LAYER_IDS)[number])
      ) {
        return layer;
      }

      if (layer.type === 'circle') {
        const paint = { ...((layer.paint as Record<string, unknown> | undefined) ?? {}) };
        const activeListingCount = buildPropertyFieldExpression('activeListingCount');
        const listingShare = buildListingShareExpression();

        if (layer.id === ACTIVE_CLUSTER_RING_LAYER_ID) {
          paint['circle-opacity'] = buildReadListingRingUnderlayOpacityExpression(
            paint['circle-opacity'] ?? 1,
            listingShare
          );
          paint['circle-stroke-opacity'] = buildReadListingRingUnderlayOpacityExpression(
            paint['circle-stroke-opacity'] ?? 1,
            listingShare
          );
          return { ...layer, paint };
        }

        if (layer.id === ACTIVE_NODE_RING_LAYER_ID) {
          paint['circle-opacity'] = buildReadListingRingUnderlayOpacityExpression(
            paint['circle-opacity'] ?? 1,
            activeListingCount
          );
          paint['circle-stroke-opacity'] = buildReadListingRingUnderlayOpacityExpression(
            paint['circle-stroke-opacity'] ?? 1,
            activeListingCount
          );
          return { ...layer, paint };
        }

        paint['circle-opacity'] = buildReadFeatureStateOpacityExpression(
          paint['circle-opacity'] ?? 1
        );

        if (layer.id === ACTIVE_CLUSTER_FILL_LAYER_ID) {
          return {
            ...layer,
            paint: applyReadListingStrokeStyle(
              paint,
              listingShare,
              buildInterpolateExpression(
                listingShare,
                MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS
              ),
              buildInterpolateExpression(
                listingShare,
                MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS
              ),
              buildInterpolateExpression(
                listingShare,
                MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS
              )
            ),
          };
        }

        if (layer.id === ACTIVE_NODE_FILL_LAYER_ID) {
          return {
            ...layer,
            paint: applyReadListingStrokeStyle(
              paint,
              activeListingCount,
              buildInterpolateExpression(
                activeListingCount,
                MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS
              ),
              buildInterpolateExpression(
                activeListingCount,
                MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS
              ),
              buildInterpolateExpression(
                activeListingCount,
                MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS
              )
            ),
          };
        }

        paint['circle-stroke-opacity'] = buildReadFeatureStateOpacityExpression(
          paint['circle-stroke-opacity'] ?? 1
        );
        return { ...layer, paint };
      }

      if (layer.type === 'symbol') {
        const paint = { ...((layer.paint as Record<string, unknown> | undefined) ?? {}) };
        paint['text-opacity'] = buildReadFeatureStateOpacityExpression(
          paint['text-opacity'] ?? 1
        );
        return { ...layer, paint };
      }

      return layer;
    }),
  };
}

export function injectReadPropertyOverlay<T extends StyleLike | null>(
  style: T,
  tileUrl: string | string[] | null | undefined,
  options: ReadPropertyOverlayLayerOptions = {}
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
        promoteId: PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
      },
    },
    layers: [...nonReadLayers, ...getReadPropertyOverlayLayers(options)],
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
    currentSource.tiles.every((value, index) => value === nextTiles[index]) &&
    currentSource.promoteId === PROPERTY_VECTOR_SOURCE_PROMOTE_ID
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
        promoteId: PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
      },
    },
  };
}

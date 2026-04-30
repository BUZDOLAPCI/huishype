import type { MapActivityFilter, MapFilters } from './sharedMapFilters';
import {
  MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_FONT_STACK,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_WIDTH,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE,
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
export const TILE_SESSION_PATH = '/tiles/sessions';

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
  cacheBustedTileUrl: string;
  tileJson: TileJsonLike;
  expiresAt: string | null;
}

export interface ReadTileCredential {
  headerName: 'Authorization' | 'x-session-id';
  headerValue: string;
}

export interface ResolvedReadTileSource {
  tileJsonUrl: string;
  tileUrl: string | null;
  cacheBustedTileUrl: string | null;
  tileJson: TileJsonLike;
  version: number;
  expiresAt: string | null;
}

type SourceLike = {
  tiles?: string[];
  url?: string | null;
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
  return [
    'step',
    input,
    firstStop[1],
    ...restStops.flatMap(([threshold, value]) => [threshold, value]),
  ];
}

function buildInterpolateExpression<TValue extends number | string>(
  input: unknown,
  stops: ReadonlyArray<readonly [threshold: number, value: TValue]>
): [string, string[], unknown, ...(number | string)[]] {
  return [
    'interpolate',
    ['linear'],
    input,
    ...stops.flatMap(([threshold, value]) => [threshold, value]),
  ];
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
  return ['case', buildReadStateExpression(), ['*', baseOpacity, READ_NODE_OPACITY], baseOpacity];
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

function applyProbeOpacity(
  layer: CircleLayerLike | SymbolLayerLike
): CircleLayerLike | SymbolLayerLike {
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

function buildTileSessionUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, '')}${TILE_SESSION_PATH}`;
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return value ?? undefined;
}

function buildFollowingTileSessionBody(
  filters: MapFilters,
  followingActivity: MapActivityFilter
): Record<string, unknown> {
  const params = buildFollowingTileSearchParams(filters, followingActivity);
  const marketState = params.get('marketState');

  return {
    scope: 'following',
    salePriceFrom: optionalNumber(filters.salePriceFrom),
    salePriceTo: optionalNumber(filters.salePriceTo),
    rentPriceFrom: optionalNumber(filters.rentPriceFrom),
    rentPriceTo: optionalNumber(filters.rentPriceTo),
    marketState: marketState ? marketState.split(',') : undefined,
    activity: params.get('activity') ?? 'all-time',
  };
}

function buildReadTileSessionBody(filters: MapFilters): Record<string, unknown> {
  return {
    scope: 'read',
    salePriceFrom: optionalNumber(filters.salePriceFrom),
    salePriceTo: optionalNumber(filters.salePriceTo),
    rentPriceFrom: optionalNumber(filters.rentPriceFrom),
    rentPriceTo: optionalNumber(filters.rentPriceTo),
    marketState:
      filters.marketState.length > 0 && filters.marketState.length < 5
        ? filters.marketState
        : undefined,
    activity: filters.activity,
  };
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function normalizeTileSessionResponse(tileSession: TileJsonLike): {
  tileUrl: string | null;
  cacheBustedTileUrl: string | null;
  expiresAt: string | null;
} {
  const tiles =
    tileSession.tiles && typeof tileSession.tiles === 'object'
      ? (tileSession.tiles as Record<string, unknown>)
      : {};
  const tileUrl = getFirstString(tileSession.tileTemplate, tiles.template);
  const cacheBustedTileUrl =
    getFirstString(tileSession.cacheBustedTileTemplate, tiles.replacementTemplate) ?? tileUrl;

  return {
    tileUrl,
    cacheBustedTileUrl,
    expiresAt: typeof tileSession.expiresAt === 'string' ? tileSession.expiresAt : null,
  };
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
  const tileSessionUrl = buildTileSessionUrl(apiUrl);
  const response = await fetch(tileSessionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildFollowingTileSessionBody(filters, followingActivity)),
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  const tileSession = (await response.json()) as TileJsonLike;
  const { tileUrl, cacheBustedTileUrl, expiresAt } = normalizeTileSessionResponse(tileSession);

  if (!tileUrl) {
    throw new Error(
      `Following tile session at ${tileSessionUrl} did not include a usable tile template.`
    );
  }

  return {
    tileJsonUrl: tileSessionUrl,
    tileUrl,
    cacheBustedTileUrl: cacheBustedTileUrl ?? tileUrl,
    tileJson: tileSession,
    expiresAt,
  };
}

export async function fetchReadTileSource(
  apiUrl: string,
  filters: MapFilters,
  credential: ReadTileCredential,
  version = 0
): Promise<ResolvedReadTileSource> {
  const tileSessionUrl = buildTileSessionUrl(apiUrl);
  const response = await fetch(tileSessionUrl, {
    method: 'POST',
    headers: {
      [credential.headerName]: credential.headerValue,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildReadTileSessionBody(filters)),
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  const tileSession = (await response.json()) as TileJsonLike;
  const { tileUrl, cacheBustedTileUrl, expiresAt } = normalizeTileSessionResponse(tileSession);

  return {
    tileJsonUrl: tileSessionUrl,
    tileUrl,
    cacheBustedTileUrl: cacheBustedTileUrl ?? tileUrl,
    tileJson: tileSession,
    version,
    expiresAt,
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
  const activeClusterRadius = PROPERTY_MAP_FOOTPRINTS.active.clusterRadiusPx;
  const activeNodeRadius = PROPERTY_MAP_FOOTPRINTS.active.singleRadiusPx;
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
        'circle-stroke-width': [
          'case',
          ['>', listingShare, 0],
          0,
          MAP_NODE_NON_LISTING_OUTLINE_WIDTH,
        ],
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
        'text-font': [...MAP_NODE_ACTIVE_CLUSTER_LABEL_FONT_STACK],
        'text-size': MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE,
      },
      paint: {
        'text-color': MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR,
        'text-halo-color': MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
        'text-halo-width': MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_WIDTH,
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
        'circle-stroke-width': [
          'case',
          ['>', activeListingCount, 0],
          0,
          MAP_NODE_NON_LISTING_OUTLINE_WIDTH,
        ],
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

  if (options.mode === 'probe') {
    return layers.filter((layer) => layer.type === 'circle').map(applyProbeOpacity);
  }

  return layers;
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
              buildInterpolateExpression(listingShare, MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS),
              buildInterpolateExpression(listingShare, MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS),
              buildInterpolateExpression(listingShare, MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS)
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
        paint['text-opacity'] = buildReadFeatureStateOpacityExpression(paint['text-opacity'] ?? 1);
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
    currentSource.promoteId === PROPERTY_VECTOR_SOURCE_PROMOTE_ID &&
    currentSource.url == null
  ) {
    return style;
  }

  const { url: _url, ...sourceWithoutUrl } = currentSource;
  const nextSource = {
    ...sourceWithoutUrl,
    tiles: nextTiles,
    promoteId: PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
  };

  return {
    ...style,
    sources: {
      ...style.sources,
      [PROPERTY_VECTOR_SOURCE_ID]: nextSource,
    },
  };
}

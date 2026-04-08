const ACTIVE_SINGLE_RADIUS_STOPS_PX = [
  [0, 6],
  [50, 10],
  [100, 14],
] as const;

const ACTIVE_CLUSTER_RADIUS_STOPS_PX = [
  [2, 16],
  [10, 22],
  [50, 28],
  [100, 36],
] as const;

const GHOST_CLUSTER_RADIUS_STOPS_PX = [
  [2, 10],
  [10, 12],
  [30, 14],
] as const;

export const PROPERTY_MAP_FOOTPRINTS = {
  active: {
    singleRadiusStopsPx: ACTIVE_SINGLE_RADIUS_STOPS_PX,
    clusterRadiusStopsPx: ACTIVE_CLUSTER_RADIUS_STOPS_PX,
    groupingGapPx: 2,
  },
  ghost: {
    revealZoom: 17,
    singleRadiusPx: 3,
    clusterRadiusStopsPx: GHOST_CLUSTER_RADIUS_STOPS_PX,
    groupingGapPx: 1,
    suppressionPaddingPx: 4,
  },
  nearbyTapTolerancePx: 8,
} as const;

export const PROPERTY_GHOST_REVEAL_ZOOM = PROPERTY_MAP_FOOTPRINTS.ghost.revealZoom;

export const PROPERTY_PREVIEW_MEMBER_LIMIT = 30;

export const PROPERTY_MAP_LAYERS = {
  ACTIVE_CLUSTERS: 'property-clusters',
  ACTIVE_CLUSTER_COUNT: 'cluster-count',
  ACTIVE_NODES: 'active-nodes',
  GHOST_CLUSTERS: 'ghost-clusters',
  GHOST_CLUSTER_COUNT: 'ghost-cluster-count',
  GHOST_NODES: 'ghost-nodes',
} as const;

export const QUERYABLE_PROPERTY_LAYER_IDS = [
  PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
  PROPERTY_MAP_LAYERS.ACTIVE_NODES,
  PROPERTY_MAP_LAYERS.GHOST_CLUSTERS,
  PROPERTY_MAP_LAYERS.GHOST_NODES,
] as const;

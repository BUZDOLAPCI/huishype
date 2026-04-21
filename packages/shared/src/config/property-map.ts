const ACTIVE_SINGLE_RADIUS_STOPS_PX = [
  [0, 10],
  [50, 10],
  [100, 10],
] as const;

const ACTIVE_CLUSTER_RADIUS_STOPS_PX = [
  [2, 12],
  [10, 12],
  [50, 12],
  [100, 12],
] as const;
const ACTIVE_CLUSTERING_RADIUS_PX = 34;
const ACTIVE_GROUPING_GAP_PX = 2;

const GHOST_CLUSTER_RADIUS_STOPS_PX = [
  [2, 10],
  [10, 11],
  [30, 12],
] as const;
const GHOST_CLUSTERING_RADIUS_PX = 21;
const GHOST_GROUPING_GAP_PX = 1;
const GHOST_SUPPRESSION_PADDING_PX = 4;
const PROPERTY_NEARBY_HIT_TOLERANCE_PX = 8;

export const PROPERTY_MAP_FOOTPRINTS = {
  active: {
    rendered: {
      singleRadiusStopsPx: ACTIVE_SINGLE_RADIUS_STOPS_PX,
      clusterRadiusStopsPx: ACTIVE_CLUSTER_RADIUS_STOPS_PX,
    },
    clustering: {
      radiusPx: ACTIVE_CLUSTERING_RADIUS_PX,
      groupingGapPx: ACTIVE_GROUPING_GAP_PX,
    },
    singleRadiusStopsPx: ACTIVE_SINGLE_RADIUS_STOPS_PX,
    clusterRadiusStopsPx: ACTIVE_CLUSTER_RADIUS_STOPS_PX,
    groupingGapPx: ACTIVE_GROUPING_GAP_PX,
  },
  ghost: {
    revealZoom: 17,
    rendered: {
      singleRadiusPx: 3,
      clusterRadiusStopsPx: GHOST_CLUSTER_RADIUS_STOPS_PX,
    },
    clustering: {
      radiusPx: GHOST_CLUSTERING_RADIUS_PX,
      groupingGapPx: GHOST_GROUPING_GAP_PX,
      suppressionPaddingPx: GHOST_SUPPRESSION_PADDING_PX,
    },
    singleRadiusPx: 3,
    clusterRadiusStopsPx: GHOST_CLUSTER_RADIUS_STOPS_PX,
    groupingGapPx: GHOST_GROUPING_GAP_PX,
    suppressionPaddingPx: GHOST_SUPPRESSION_PADDING_PX,
  },
  hit: {
    nearbyTolerancePx: PROPERTY_NEARBY_HIT_TOLERANCE_PX,
  },
  nearbyTapTolerancePx: PROPERTY_NEARBY_HIT_TOLERANCE_PX,
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

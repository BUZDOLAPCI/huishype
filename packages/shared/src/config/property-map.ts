const ACTIVE_SINGLE_RADIUS_PX = 10;

const ACTIVE_CLUSTER_RADIUS_PX = 12;
const ACTIVE_CLUSTERING_RADIUS_PX = 34;
const ACTIVE_GROUPING_GAP_PX = 2;

const PROPERTY_NEARBY_HIT_TOLERANCE_PX = 8;
const ADDRESS_INTERACTION_MIN_ZOOM = 17;

export const PROPERTY_MAP_FOOTPRINTS = {
  active: {
    rendered: {
      singleRadiusPx: ACTIVE_SINGLE_RADIUS_PX,
      clusterRadiusPx: ACTIVE_CLUSTER_RADIUS_PX,
    },
    clustering: {
      radiusPx: ACTIVE_CLUSTERING_RADIUS_PX,
      groupingGapPx: ACTIVE_GROUPING_GAP_PX,
    },
    singleRadiusPx: ACTIVE_SINGLE_RADIUS_PX,
    clusterRadiusPx: ACTIVE_CLUSTER_RADIUS_PX,
    groupingGapPx: ACTIVE_GROUPING_GAP_PX,
  },
  hit: {
    nearbyTolerancePx: PROPERTY_NEARBY_HIT_TOLERANCE_PX,
  },
  nearbyTapTolerancePx: PROPERTY_NEARBY_HIT_TOLERANCE_PX,
} as const;

export const PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM = ADDRESS_INTERACTION_MIN_ZOOM;

export const PROPERTY_PREVIEW_MEMBER_LIMIT = 30;

export const PROPERTY_MAP_LAYERS = {
  ACTIVE_CLUSTERS: 'property-clusters',
  ACTIVE_CLUSTER_COUNT: 'cluster-count',
  ACTIVE_NODES: 'active-nodes',
} as const;

export const QUERYABLE_PROPERTY_LAYER_IDS = [
  PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
  PROPERTY_MAP_LAYERS.ACTIVE_NODES,
] as const;

import { QUERYABLE_PROPERTY_LAYER_IDS } from '@huishype/shared/config';

/**
 * MapLibre layer name constants for density-aware active property grouping.
 *
 * Public property layers:
 * - property-clusters: active clusters at any zoom
 * - property-cluster-fill: active cluster core fill
 * - cluster-count: active cluster labels at any zoom
 * - active-nodes: active singles at any zoom
 * - active-node-fill: active single core fill
 *
 */

/**
 * All property-related layer names used in the map
 */
export const MAP_LAYER_NAMES = {
  /** Active cluster circles shown whenever density requires grouping */
  CLUSTERS: 'property-clusters',

  /** Active cluster fill */
  CLUSTER_FILL: 'property-cluster-fill',

  /** Text labels showing count inside active clusters */
  CLUSTER_COUNT: 'cluster-count',

  /** Active singles shown at any zoom */
  ACTIVE_NODES: 'active-nodes',

  /** Active single fill */
  ACTIVE_NODE_FILL: 'active-node-fill',

} as const;

/**
 * Property layer names for querying features.
 */
export const ALL_PROPERTY_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_FILL,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.ACTIVE_NODE_FILL,
] as const;

/**
 * Layers that should be safe for app-side feature queries.
 */
export const QUERYABLE_PROPERTY_LAYERS = QUERYABLE_PROPERTY_LAYER_IDS;

/**
 * Layers visible at low zoom.
 */
export const LOW_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_FILL,
  MAP_LAYER_NAMES.CLUSTER_COUNT,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.ACTIVE_NODE_FILL,
] as const;

/**
 * Layers visible at high zoom.
 */
export const HIGH_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_FILL,
  MAP_LAYER_NAMES.CLUSTER_COUNT,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.ACTIVE_NODE_FILL,
] as const;

/**
 * Helper function to get existing layers from map instance
 * Filters to only return layers that actually exist
 */
export function getExistingLayers(
  mapInstance: unknown,
  layerNames: readonly string[] = ALL_PROPERTY_LAYERS
): string[] {
  const map = mapInstance as { getLayer?: (id: string) => unknown };
  if (!map?.getLayer) return [];

  const getLayer = map.getLayer!;
  return layerNames.filter((layerId) => getLayer(layerId) !== undefined);
}

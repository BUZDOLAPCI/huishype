import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';

/**
 * MapLibre layer name constants for density-aware property grouping.
 *
 * Layer visibility by zoom level:
 * - property-clusters: active clusters at any zoom
 * - cluster-count: active cluster labels at any zoom
 * - active-nodes: active singles at any zoom
 * - ghost-clusters: ghost-only clusters at z17+
 * - ghost-cluster-count: ghost cluster labels at z17+
 * - ghost-nodes: ghost singles at z17+
 */

/**
 * All property-related layer names used in the map
 */
export const MAP_LAYER_NAMES = {
  /** Active cluster circles shown whenever density requires grouping */
  CLUSTERS: 'property-clusters',

  /** Text labels showing count inside active clusters */
  CLUSTER_COUNT: 'cluster-count',

  /** Active singles shown at any zoom */
  ACTIVE_NODES: 'active-nodes',

  /** Ghost-only clusters shown once ghost reveal kicks in */
  GHOST_CLUSTERS: 'ghost-clusters',

  /** Ghost cluster count labels */
  GHOST_CLUSTER_COUNT: 'ghost-cluster-count',

  /** Ghost singles shown once ghost reveal kicks in */
  GHOST_NODES: 'ghost-nodes',
} as const;

/**
 * Array of all property layer names for querying features
 */
export const ALL_PROPERTY_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.GHOST_CLUSTERS,
  MAP_LAYER_NAMES.GHOST_NODES,
] as const;

/**
 * Layers visible before ghost reveal.
 */
export const LOW_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_COUNT,
  MAP_LAYER_NAMES.ACTIVE_NODES,
] as const;

/**
 * Layers visible once ghost reveal is active.
 */
export const HIGH_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_COUNT,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.GHOST_CLUSTERS,
  MAP_LAYER_NAMES.GHOST_CLUSTER_COUNT,
  MAP_LAYER_NAMES.GHOST_NODES,
] as const;

/**
 * Zoom threshold where ghost nodes become visible
 * Matching PROPERTY_GHOST_REVEAL_ZOOM in the shared map config.
 */
export const GHOST_NODE_ZOOM_THRESHOLD = PROPERTY_GHOST_REVEAL_ZOOM;

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

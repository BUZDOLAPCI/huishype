/**
 * MapLibre Layer Name Constants
 *
 * These constants match the layer IDs defined in apps/app/app/(tabs)/index.web.tsx
 * in the addPropertyLayers() function.
 *
 * IMPORTANT: If layer names change in the main app, update these constants.
 *
 * Layer visibility by zoom level:
 * - property-clusters: Z0-Z14 (clusters with point_count > 1)
 * - cluster-count: Z0-Z14 (text labels for cluster counts)
 * - single-active-points: Z0-Z14 (individual active points at low zoom)
 * - active-nodes: Z15+ (active nodes at high zoom, is_ghost = false)
 * - ghost-nodes: Z15+ (ghost nodes at high zoom, is_ghost = true)
 */

/**
 * All property-related layer names used in the map
 */
export const MAP_LAYER_NAMES = {
  /** Cluster circles shown at Z0-Z14 for grouped properties */
  CLUSTERS: 'property-clusters',

  /** Text labels showing count inside clusters */
  CLUSTER_COUNT: 'cluster-count',

  /** Individual active points shown at low zoom (Z0-Z14) */
  SINGLE_ACTIVE_POINTS: 'single-active-points',

  /** Active nodes shown at high zoom (Z15+) - properties with is_ghost=false */
  ACTIVE_NODES: 'active-nodes',

  /** Ghost nodes shown at high zoom (Z15+) - properties with is_ghost=true */
  GHOST_NODES: 'ghost-nodes',
} as const;

/**
 * Array of all property layer names for querying features
 */
export const ALL_PROPERTY_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS,
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.GHOST_NODES,
] as const;

/**
 * Layers visible at low zoom (Z0-Z14)
 */
export const LOW_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.CLUSTERS,
  MAP_LAYER_NAMES.CLUSTER_COUNT,
  MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS,
] as const;

/**
 * Layers visible at high zoom (Z15+)
 */
export const HIGH_ZOOM_LAYERS = [
  MAP_LAYER_NAMES.ACTIVE_NODES,
  MAP_LAYER_NAMES.GHOST_NODES,
] as const;

/**
 * Zoom threshold where ghost nodes become visible
 * Matching GHOST_NODE_THRESHOLD_ZOOM in index.web.tsx
 */
export const GHOST_NODE_ZOOM_THRESHOLD = 15;

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

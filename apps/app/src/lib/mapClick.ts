import type { Feature } from 'geojson';

import { normalizeRenderedPropertyGroup } from '@/src/utils/api';

export interface MapClickPoint {
  x: number;
  y: number;
}

interface RankedFeature {
  feature: Feature;
  index: number;
  isCluster: boolean;
  pointCount: number;
}

interface RenderedFeatureMapLike {
  getLayer(layerId: string): unknown;
  queryRenderedFeatures(
    geometry: [number, number] | [[number, number], [number, number]],
    options: { layers: string[] },
  ): Feature[];
}

export function buildMapClickHitBox(
  point: MapClickPoint,
  slopPx = 8,
): [[number, number], [number, number]] {
  return [
    [point.x - slopPx, point.y - slopPx],
    [point.x + slopPx, point.y + slopPx],
  ];
}

function rankRenderedPropertyFeature(feature: Feature, index: number): RankedFeature | null {
  const group = normalizeRenderedPropertyGroup(feature);
  if (!group) {
    return null;
  }

  return {
    feature,
    index,
    isCluster: group.groupKind === 'cluster',
    pointCount: group.pointCount,
  };
}

/**
 * Prioritize rendered property features for click handling.
 *
 * Cluster features should win when they overlap single nodes at the same
 * click point so the preview pager opens instead of a single-property route.
 */
export function prioritizeRenderedPropertyFeatures(features: Feature[]): Feature[] {
  const ranked = features
    .map(rankRenderedPropertyFeature)
    .filter((feature): feature is RankedFeature => feature !== null);

  if (ranked.length === 0) {
    return [];
  }

  ranked.sort((a, b) => {
    if (a.isCluster !== b.isCluster) {
      return a.isCluster ? -1 : 1;
    }

    if (a.isCluster && b.isCluster && a.pointCount !== b.pointCount) {
      return b.pointCount - a.pointCount;
    }

    return a.index - b.index;
  });

  return ranked.map(({ feature }) => feature);
}

export function queryPrioritizedRenderedPropertyFeatures(
  map: RenderedFeatureMapLike,
  point: MapClickPoint,
  layers: string[],
  slopPx = 8,
): Feature[] {
  const queryLayers = layers.filter((layerId) => !!map.getLayer(layerId));
  if (queryLayers.length === 0) {
    return [];
  }

  const features = map.queryRenderedFeatures(
    buildMapClickHitBox(point, slopPx),
    { layers: queryLayers },
  );

  return prioritizeRenderedPropertyFeatures(features);
}

import * as propertyMapConfig from '@huishype/shared/config';

const GHOST_QUERY_LAYER_ID_PATTERN = /(^|-)ghost(-|$)/;

function isQueryablePhysicalLayerId(layerId: string): boolean {
  return !GHOST_QUERY_LAYER_ID_PATTERN.test(layerId);
}

const sharedQueryLayerIds =
  (
    propertyMapConfig as typeof propertyMapConfig & {
      PROPERTY_MAP_QUERY_LAYERS?: readonly string[];
    }
  ).PROPERTY_MAP_QUERY_LAYERS ?? propertyMapConfig.QUERYABLE_PROPERTY_LAYER_IDS;

export const PROPERTY_QUERY_LAYER_IDS = sharedQueryLayerIds.filter(
  isQueryablePhysicalLayerId,
);

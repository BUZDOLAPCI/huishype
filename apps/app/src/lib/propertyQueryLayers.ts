import * as propertyMapConfig from '@huishype/shared/config';

const sharedQueryLayerIds =
  (
    propertyMapConfig as typeof propertyMapConfig & {
      PROPERTY_MAP_QUERY_LAYERS?: readonly string[];
    }
  ).PROPERTY_MAP_QUERY_LAYERS ?? propertyMapConfig.QUERYABLE_PROPERTY_LAYER_IDS;

export const PROPERTY_QUERY_LAYER_IDS = [...sharedQueryLayerIds];

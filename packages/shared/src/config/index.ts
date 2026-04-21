/**
 * Config exports for @huishype/shared
 */
export {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getAllCountryCodes,
  getAllListingDomains,
  getCountryForDomain,
  getSourceNameForDomain,
  getAllListingSourceNames,
  isValidCountryCode,
} from './country-config.js';

export type {
  CountryCode,
  CountryConfig,
  AddressParts,
} from './country-config.js';

export {
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
  PROPERTY_MAP_LAYERS,
  QUERYABLE_PROPERTY_LAYER_IDS,
} from './property-map.js';

export {
  MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS,
  MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
  MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
  MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY,
  MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
  MAP_NODE_NON_LISTING_OUTLINE_WIDTH,
  MAP_NODE_NON_LISTING_OUTLINE_COLOR,
  MAP_NODE_NON_LISTING_OUTLINE_OPACITY,
  MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD,
  MAP_NODE_RECENT_PULSE_SINGLE_COLOR_STOPS,
  MAP_NODE_RECENT_PULSE_CLUSTER_COLOR_STOPS,
  MAP_NODE_RECENT_PULSE_OPACITY_STOPS,
  MAP_NODE_RECENT_PULSE_SINGLE_RADIUS_DELTA_STOPS,
  MAP_NODE_RECENT_PULSE_CLUSTER_RADIUS_DELTA_STOPS,
  MAP_NODE_GHOST_CLUSTER_VISUAL,
  MAP_NODE_GHOST_SINGLE_VISUAL,
  clamp,
  interpolateNumericStops,
  interpolateColorStops,
  withAlpha,
  resolveActiveSingleNodeVisual,
  resolveActiveClusterNodeVisual,
  resolveGhostSingleNodeVisual,
  resolveGhostClusterNodeVisual,
} from './map-node-visuals.js';

export type {
  NumericStop,
  ColorStop,
  MapNodeVisual,
  ActiveSingleNodeVisualInput,
  ActiveClusterNodeVisualInput,
  GhostClusterNodeVisualInput,
} from './map-node-visuals.js';

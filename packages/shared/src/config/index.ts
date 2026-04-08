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

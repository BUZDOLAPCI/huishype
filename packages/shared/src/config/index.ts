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

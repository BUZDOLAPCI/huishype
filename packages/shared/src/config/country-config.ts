/**
 * Multi-country configuration registry for HuisHype.
 *
 * ALL country configs are loaded at module import time as a plain
 * Record<CountryCode, CountryConfig>.  No env-var selector — every
 * deployment has the full set available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CountryCode =
  | 'NL' | 'DE' | 'BE' | 'FR' | 'GB'
  | 'AT' | 'CH' | 'LU' | 'DK' | 'SE'
  | 'NO' | 'FI' | 'PL' | 'CZ' | 'SK'
  | 'IT' | 'ES' | 'PT' | 'IE';

export interface AddressParts {
  street: string;
  houseNumber: string;
  houseNumberAddition?: string;
  postalCode: string;
  city: string;
  region?: string;
  countryCode: CountryCode;
}

export interface CountryConfig {
  code: CountryCode;
  name: string;
  /** Intl locale tag (e.g. nl-NL, de-DE) */
  locale: string;
  /** ISO 4217 currency code */
  currency: string;
  /** Strict postal-code validation regex */
  postalCodeRegex: RegExp;
  /** Normalize a raw postal-code string (trim, uppercase, add spaces, etc.) */
  postalCodeNormalize: (raw: string) => string;
  /** Allowed listing-URL root domains for this country */
  listingDomains: string[];
  /** [lng, lat] for the default map camera */
  defaultCenter: [number, number];
  /** Default zoom level */
  defaultZoom: number;
  /** Meter-based projection SRID used by import scripts */
  projectionSrid: number;
  /** Geofabrik OSM PBF download URL */
  pbfUrl: string;
  /** Format an address according to country convention */
  addressFormatter: (parts: AddressParts) => string;
  /** Label for the official government property valuation (e.g. "WOZ Value" for NL) */
  valuationLabel: string;
}

// ---------------------------------------------------------------------------
// Helpers shared across address formatters
// ---------------------------------------------------------------------------

/** "Street HouseNumber[Addition], PostalCode City" (NL, BE, LU, DE, AT, CH, DK, SE, NO, FI, PL, CZ, SK) */
function formatStreetNumber(parts: AddressParts): string {
  let line = `${parts.street} ${parts.houseNumber}`;
  if (parts.houseNumberAddition) line += parts.houseNumberAddition;
  if (parts.postalCode || parts.city) {
    line += ', ';
    if (parts.postalCode) {
      line += parts.postalCode;
      if (parts.city) line += ' ';
    }
    if (parts.city) line += parts.city;
  }
  return line;
}

/** "HouseNumber[Addition] Street, City, PostalCode" (GB, IE) */
function formatBritishStyle(parts: AddressParts): string {
  let line = `${parts.houseNumber}`;
  if (parts.houseNumberAddition) line += parts.houseNumberAddition;
  line += ` ${parts.street}`;
  if (parts.city) line += `, ${parts.city}`;
  if (parts.postalCode) line += `, ${parts.postalCode}`;
  return line;
}

/** "HouseNumber[Addition] Street, PostalCode City" (FR) */
function formatFrenchStyle(parts: AddressParts): string {
  let line = `${parts.houseNumber}`;
  if (parts.houseNumberAddition) line += parts.houseNumberAddition;
  line += ` ${parts.street}`;
  if (parts.postalCode || parts.city) {
    line += ', ';
    if (parts.postalCode) {
      line += parts.postalCode;
      if (parts.city) line += ' ';
    }
    if (parts.city) line += parts.city;
  }
  return line;
}

/** "Street, HouseNumber[Addition], PostalCode City" (IT, ES, PT) */
function formatSouthernEuropeanStyle(parts: AddressParts): string {
  let line = `${parts.street}, ${parts.houseNumber}`;
  if (parts.houseNumberAddition) line += parts.houseNumberAddition;
  if (parts.postalCode || parts.city) {
    line += ', ';
    if (parts.postalCode) {
      line += parts.postalCode;
      if (parts.city) line += ' ';
    }
    if (parts.city) line += parts.city;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Postal-code normalizers
// ---------------------------------------------------------------------------

/** Dutch: "1234AB" → "1234 AB" */
function normalizeNL(raw: string): string {
  const cleaned = raw.replace(/\s/g, '').toUpperCase();
  if (cleaned.length === 6) return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
  return cleaned;
}

/** Generic: trim + uppercase */
function normalizeDefault(raw: string): string {
  return raw.trim().toUpperCase();
}

/** UK: ensure single space in the middle — "SW1A1AA" → "SW1A 1AA" */
function normalizeGB(raw: string): string {
  const cleaned = raw.replace(/\s/g, '').toUpperCase();
  // UK postcodes always have the last 3 chars as the inward code
  if (cleaned.length >= 5) {
    return `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
  }
  return cleaned;
}

/** Ireland Eircode: "D02AF30" → "D02 AF30" */
function normalizeIE(raw: string): string {
  const cleaned = raw.replace(/\s/g, '').toUpperCase();
  if (cleaned.length === 7) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Country configs
// ---------------------------------------------------------------------------

export const COUNTRY_CONFIGS: Record<CountryCode, CountryConfig> = {
  // -------------------------------------------------------------------------
  // Netherlands (primary — all values sourced from current codebase)
  // -------------------------------------------------------------------------
  NL: {
    code: 'NL',
    name: 'Netherlands',
    locale: 'nl-NL',
    currency: 'EUR',
    postalCodeRegex: /^\d{4}\s?[A-Z]{2}$/,
    postalCodeNormalize: normalizeNL,
    listingDomains: ['funda.nl', 'pararius.nl', 'pararius.com'],
    defaultCenter: [5.4697, 51.4416],
    defaultZoom: 13,
    projectionSrid: 28992,
    pbfUrl: 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'WOZ Value',
  },

  // -------------------------------------------------------------------------
  // Germany
  // -------------------------------------------------------------------------
  DE: {
    code: 'DE',
    name: 'Germany',
    locale: 'de-DE',
    currency: 'EUR',
    postalCodeRegex: /^\d{5}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['immobilienscout24.de', 'immowelt.de', 'immonet.de'],
    defaultCenter: [13.405, 52.52],
    defaultZoom: 12,
    projectionSrid: 25832,
    pbfUrl: 'https://download.geofabrik.de/europe/germany-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Belgium
  // -------------------------------------------------------------------------
  BE: {
    code: 'BE',
    name: 'Belgium',
    locale: 'nl-BE',
    currency: 'EUR',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['immoweb.be', 'zimmo.be', 'immovlan.be'],
    defaultCenter: [4.3517, 50.8503],
    defaultZoom: 12,
    projectionSrid: 31370,
    pbfUrl: 'https://download.geofabrik.de/europe/belgium-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // France
  // -------------------------------------------------------------------------
  FR: {
    code: 'FR',
    name: 'France',
    locale: 'fr-FR',
    currency: 'EUR',
    postalCodeRegex: /^\d{5}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['seloger.com', 'leboncoin.fr', 'logic-immo.com'],
    defaultCenter: [2.3522, 48.8566],
    defaultZoom: 12,
    projectionSrid: 2154,
    pbfUrl: 'https://download.geofabrik.de/europe/france-latest.osm.pbf',
    addressFormatter: formatFrenchStyle,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // United Kingdom
  // -------------------------------------------------------------------------
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    locale: 'en-GB',
    currency: 'GBP',
    postalCodeRegex: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
    postalCodeNormalize: normalizeGB,
    listingDomains: ['rightmove.co.uk', 'zoopla.co.uk', 'onthemarket.com'],
    defaultCenter: [-0.1276, 51.5074],
    defaultZoom: 12,
    projectionSrid: 27700,
    pbfUrl: 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf',
    addressFormatter: formatBritishStyle,
    valuationLabel: 'Council Tax Band',
  },

  // -------------------------------------------------------------------------
  // Austria
  // -------------------------------------------------------------------------
  AT: {
    code: 'AT',
    name: 'Austria',
    locale: 'de-AT',
    currency: 'EUR',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['willhaben.at', 'immobilienscout24.at', 'immmo.at'],
    defaultCenter: [16.3738, 48.2082],
    defaultZoom: 12,
    projectionSrid: 31287,
    pbfUrl: 'https://download.geofabrik.de/europe/austria-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Switzerland
  // -------------------------------------------------------------------------
  CH: {
    code: 'CH',
    name: 'Switzerland',
    locale: 'de-CH',
    currency: 'CHF',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['homegate.ch', 'immoscout24.ch', 'comparis.ch'],
    defaultCenter: [7.4474, 46.948],
    defaultZoom: 12,
    projectionSrid: 2056,
    pbfUrl: 'https://download.geofabrik.de/europe/switzerland-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Luxembourg
  // -------------------------------------------------------------------------
  LU: {
    code: 'LU',
    name: 'Luxembourg',
    locale: 'fr-LU',
    currency: 'EUR',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['athome.lu', 'immotop.lu'],
    defaultCenter: [6.1319, 49.6117],
    defaultZoom: 12,
    projectionSrid: 2169,
    pbfUrl: 'https://download.geofabrik.de/europe/luxembourg-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Denmark
  // -------------------------------------------------------------------------
  DK: {
    code: 'DK',
    name: 'Denmark',
    locale: 'da-DK',
    currency: 'DKK',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['boligsiden.dk', 'home.dk', 'nybolig.dk'],
    defaultCenter: [12.5683, 55.6761],
    defaultZoom: 12,
    projectionSrid: 25832,
    pbfUrl: 'https://download.geofabrik.de/europe/denmark-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Sweden
  // -------------------------------------------------------------------------
  SE: {
    code: 'SE',
    name: 'Sweden',
    locale: 'sv-SE',
    currency: 'SEK',
    postalCodeRegex: /^\d{3}\s?\d{2}$/,
    postalCodeNormalize(raw: string): string {
      const cleaned = raw.replace(/\s/g, '');
      if (cleaned.length === 5) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
      return cleaned;
    },
    listingDomains: ['hemnet.se', 'booli.se', 'blocket.se'],
    defaultCenter: [18.0686, 59.3293],
    defaultZoom: 12,
    projectionSrid: 3006,
    pbfUrl: 'https://download.geofabrik.de/europe/sweden-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Norway
  // -------------------------------------------------------------------------
  NO: {
    code: 'NO',
    name: 'Norway',
    locale: 'nb-NO',
    currency: 'NOK',
    postalCodeRegex: /^\d{4}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['finn.no', 'hybel.no'],
    defaultCenter: [10.7522, 59.9139],
    defaultZoom: 12,
    projectionSrid: 25833,
    pbfUrl: 'https://download.geofabrik.de/europe/norway-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Finland
  // -------------------------------------------------------------------------
  FI: {
    code: 'FI',
    name: 'Finland',
    locale: 'fi-FI',
    currency: 'EUR',
    postalCodeRegex: /^\d{5}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['etuovi.com', 'oikotie.fi'],
    defaultCenter: [24.9384, 60.1699],
    defaultZoom: 12,
    projectionSrid: 3067,
    pbfUrl: 'https://download.geofabrik.de/europe/finland-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Poland
  // -------------------------------------------------------------------------
  PL: {
    code: 'PL',
    name: 'Poland',
    locale: 'pl-PL',
    currency: 'PLN',
    postalCodeRegex: /^\d{2}-?\d{3}$/,
    postalCodeNormalize(raw: string): string {
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
      return raw.trim();
    },
    listingDomains: ['otodom.pl', 'olx.pl', 'morizon.pl'],
    defaultCenter: [21.0122, 52.2297],
    defaultZoom: 12,
    projectionSrid: 2180,
    pbfUrl: 'https://download.geofabrik.de/europe/poland-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Czech Republic
  // -------------------------------------------------------------------------
  CZ: {
    code: 'CZ',
    name: 'Czech Republic',
    locale: 'cs-CZ',
    currency: 'CZK',
    postalCodeRegex: /^\d{3}\s?\d{2}$/,
    postalCodeNormalize(raw: string): string {
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 5) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
      return raw.trim();
    },
    listingDomains: ['sreality.cz', 'bezrealitky.cz', 'realitymix.cz'],
    defaultCenter: [14.4378, 50.0755],
    defaultZoom: 12,
    projectionSrid: 5514,
    pbfUrl: 'https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Slovakia
  // -------------------------------------------------------------------------
  SK: {
    code: 'SK',
    name: 'Slovakia',
    locale: 'sk-SK',
    currency: 'EUR',
    postalCodeRegex: /^\d{3}\s?\d{2}$/,
    postalCodeNormalize(raw: string): string {
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 5) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
      return raw.trim();
    },
    listingDomains: ['nehnutelnosti.sk', 'reality.sk', 'topreality.sk'],
    defaultCenter: [17.1077, 48.1486],
    defaultZoom: 12,
    projectionSrid: 5514,
    pbfUrl: 'https://download.geofabrik.de/europe/slovakia-latest.osm.pbf',
    addressFormatter: formatStreetNumber,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Italy
  // -------------------------------------------------------------------------
  IT: {
    code: 'IT',
    name: 'Italy',
    locale: 'it-IT',
    currency: 'EUR',
    postalCodeRegex: /^\d{5}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['immobiliare.it', 'idealista.it', 'casa.it'],
    defaultCenter: [12.4964, 41.9028],
    defaultZoom: 12,
    projectionSrid: 6875,
    pbfUrl: 'https://download.geofabrik.de/europe/italy-latest.osm.pbf',
    addressFormatter: formatSouthernEuropeanStyle,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Spain
  // -------------------------------------------------------------------------
  ES: {
    code: 'ES',
    name: 'Spain',
    locale: 'es-ES',
    currency: 'EUR',
    postalCodeRegex: /^\d{5}$/,
    postalCodeNormalize: normalizeDefault,
    listingDomains: ['idealista.com', 'fotocasa.es', 'pisos.com'],
    defaultCenter: [-3.7038, 40.4168],
    defaultZoom: 12,
    projectionSrid: 25830,
    pbfUrl: 'https://download.geofabrik.de/europe/spain-latest.osm.pbf',
    addressFormatter: formatSouthernEuropeanStyle,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Portugal
  // -------------------------------------------------------------------------
  PT: {
    code: 'PT',
    name: 'Portugal',
    locale: 'pt-PT',
    currency: 'EUR',
    postalCodeRegex: /^\d{4}(-\d{3})?$/,
    postalCodeNormalize(raw: string): string {
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
      if (digits.length === 4) return digits;
      return raw.trim();
    },
    listingDomains: ['idealista.pt', 'imovirtual.com', 'casa.sapo.pt'],
    defaultCenter: [-9.1393, 38.7223],
    defaultZoom: 12,
    projectionSrid: 3763,
    pbfUrl: 'https://download.geofabrik.de/europe/portugal-latest.osm.pbf',
    addressFormatter: formatSouthernEuropeanStyle,
    valuationLabel: 'Official Valuation',
  },

  // -------------------------------------------------------------------------
  // Ireland
  // -------------------------------------------------------------------------
  IE: {
    code: 'IE',
    name: 'Ireland',
    locale: 'en-IE',
    currency: 'EUR',
    postalCodeRegex: /^[A-Z\d]{3}\s?[A-Z\d]{4}$/i,
    postalCodeNormalize: normalizeIE,
    listingDomains: ['daft.ie', 'myhome.ie'],
    defaultCenter: [-6.2603, 53.3498],
    defaultZoom: 12,
    projectionSrid: 2157,
    pbfUrl: 'https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf',
    addressFormatter: formatBritishStyle,
    valuationLabel: 'Official Valuation',
  },
};

// ---------------------------------------------------------------------------
// Accessor helpers
// ---------------------------------------------------------------------------

const ALL_CODES = Object.keys(COUNTRY_CONFIGS) as CountryCode[];

/** Look up a single country config.  Throws if the code is unknown. */
export function getCountryConfig(code: CountryCode): CountryConfig {
  const cfg = COUNTRY_CONFIGS[code];
  if (!cfg) throw new Error(`Unknown country code: ${code}`);
  return cfg;
}

/** All supported country codes. */
export function getAllCountryCodes(): CountryCode[] {
  return ALL_CODES;
}

/**
 * Flat union of every country's listing domains.
 * Useful for building a global URL-whitelist.
 */
export function getAllListingDomains(): string[] {
  const set = new Set<string>();
  for (const cfg of Object.values(COUNTRY_CONFIGS)) {
    for (const d of cfg.listingDomains) set.add(d);
  }
  return [...set];
}

/**
 * Given a root domain (e.g. "funda.nl"), return the country that owns it,
 * or `undefined` if no match.
 */
export function getCountryForDomain(domain: string): CountryCode | undefined {
  const lower = domain.toLowerCase();
  for (const cfg of Object.values(COUNTRY_CONFIGS)) {
    if (cfg.listingDomains.some((d) => d === lower || lower.endsWith(`.${d}`))) {
      return cfg.code;
    }
  }
  return undefined;
}

/**
 * Derive a source name from a listing domain by stripping the TLD.
 * e.g. "funda.nl" → "funda", "immobilienscout24.de" → "immobilienscout24",
 *      "casa.sapo.pt" → "casa.sapo", "rightmove.co.uk" → "rightmove"
 */
function domainToSourceName(domain: string): string {
  // Known compound TLDs (two-part suffixes)
  const compoundTlds = ['.co.uk', '.com.au', '.co.nz'];
  const lower = domain.toLowerCase();
  for (const tld of compoundTlds) {
    if (lower.endsWith(tld)) {
      return lower.slice(0, -tld.length);
    }
  }
  // Simple TLD: strip the last dot-segment
  const lastDot = lower.lastIndexOf('.');
  if (lastDot > 0) return lower.slice(0, lastDot);
  return lower;
}

/**
 * Given a hostname (e.g. "www.funda.nl"), find the matching listing domain
 * from the country-config registry and return its derived source name.
 * Returns `undefined` if the hostname doesn't match any configured domain.
 */
export function getSourceNameForDomain(hostname: string): string | undefined {
  const lower = hostname.toLowerCase();
  for (const cfg of Object.values(COUNTRY_CONFIGS)) {
    for (const d of cfg.listingDomains) {
      if (lower === d || lower.endsWith(`.${d}`)) {
        return domainToSourceName(d);
      }
    }
  }
  return undefined;
}

/**
 * Return all unique listing source names derived from every country config's
 * listing domains.  e.g. ['funda', 'pararius', 'immobilienscout24', ...]
 */
export function getAllListingSourceNames(): string[] {
  const set = new Set<string>();
  for (const cfg of Object.values(COUNTRY_CONFIGS)) {
    for (const d of cfg.listingDomains) {
      set.add(domainToSourceName(d));
    }
  }
  return [...set];
}

/** Type-guard: is `code` a supported CountryCode? */
export function isValidCountryCode(code: string): code is CountryCode {
  return code in COUNTRY_CONFIGS;
}

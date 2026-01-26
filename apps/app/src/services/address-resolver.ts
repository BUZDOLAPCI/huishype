/**
 * Address Resolver Service
 *
 * Resolves human-readable URL paths to BAG verblijfsobject IDs using PDOK Locatieserver.
 *
 * URL Structure: /{city}/{zipcode}/{street}/{house_number}
 * Example: /eindhoven/5651hp/deflectiespoelstraat/16
 *
 * CRITICAL: Uses centroide_ll (WGS84) NOT centroide_rd (RD coordinates)
 */

// PDOK Locatieserver API endpoint
const PDOK_SEARCH_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';

/**
 * PDOK Locatieserver response types
 */
export interface PDOKResponse {
  response: {
    numFound: number;
    start: number;
    maxScore: number;
    docs: PDOKDocument[];
  };
}

export interface PDOKDocument {
  id: string;
  type: string;
  weergavenaam: string;
  score: number;
  centroide_ll?: string; // WGS84 format: "POINT(lon lat)"
  centroide_rd?: string; // RD format - DO NOT USE with Mapbox
  huisnummer?: string;
  postcode?: string;
  straatnaam?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  provincienaam?: string;
}

/**
 * Resolved address with all necessary data for the app
 */
export interface ResolvedAddress {
  bagId: string; // Verblijfsobject ID
  formattedAddress: string; // Display name (weergavenaam)
  lat: number;
  lon: number;
  details: {
    city: string;
    zip: string;
    street: string;
    number: string;
  };
}

/**
 * URL parameters from Expo Router
 */
export interface AddressUrlParams {
  city?: string;
  zipcode?: string;
  street?: string;
  housenumber?: string;
}

/**
 * Parse centroide_ll (WGS84) string to coordinates
 * Format: "POINT(longitude latitude)"
 */
function parseWGS84Point(centroide_ll: string): { lat: number; lon: number } | null {
  const match = centroide_ll.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!match) return null;

  return {
    lon: parseFloat(match[1]),
    lat: parseFloat(match[2]),
  };
}

/**
 * Normalize strings for URL comparison
 * - Lowercase
 * - Remove diacritics
 * - Replace spaces with dashes
 */
export function normalizeForUrl(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Create URL-friendly path from address components
 */
export function createAddressUrl(address: ResolvedAddress): string {
  const { city, zip, street, number } = address.details;
  return `/${normalizeForUrl(city)}/${normalizeForUrl(zip)}/${normalizeForUrl(street)}/${number}`;
}

/**
 * Build PDOK search query from URL parameters
 */
function buildSearchQuery(params: AddressUrlParams): string {
  const parts: string[] = [];

  if (params.zipcode && params.housenumber) {
    // Most accurate: postcode + huisnummer
    parts.push(`postcode:${params.zipcode.toUpperCase()}`);
    parts.push(`huisnummer:${params.housenumber}`);
  } else if (params.city && params.street && params.housenumber) {
    // Alternative: city + street + number as free text
    parts.push(params.city);
    parts.push(params.street.replace(/-/g, ' '));
    parts.push(params.housenumber);
  } else if (params.city && params.zipcode) {
    // Partial: city + zipcode
    parts.push(params.city);
    parts.push(`postcode:${params.zipcode.toUpperCase()}`);
  } else if (params.city) {
    // Just city
    parts.push(params.city);
  }

  return parts.join(' ');
}

/**
 * Resolve URL parameters to a full address using PDOK Locatieserver
 *
 * @param params URL parameters from Expo Router
 * @returns ResolvedAddress or null if not found
 */
export async function resolveUrlParams(params: AddressUrlParams): Promise<ResolvedAddress | null> {
  const query = buildSearchQuery(params);

  if (!query) {
    return null;
  }

  try {
    const searchParams = new URLSearchParams({
      q: query,
      fq: 'type:adres', // Filter strictly for addresses
      fl: 'id,weergavenaam,centroide_ll,huisnummer,postcode,straatnaam,woonplaatsnaam',
      rows: '1', // We only need the best match
    });

    const response = await fetch(`${PDOK_SEARCH_URL}?${searchParams.toString()}`);

    if (!response.ok) {
      console.error('PDOK API error:', response.status, response.statusText);
      return null;
    }

    const data: PDOKResponse = await response.json();

    if (data.response.numFound === 0 || !data.response.docs.length) {
      return null;
    }

    const doc = data.response.docs[0];

    // CRITICAL: Use centroide_ll (WGS84) NOT centroide_rd
    if (!doc.centroide_ll) {
      console.error('PDOK response missing centroide_ll');
      return null;
    }

    const coords = parseWGS84Point(doc.centroide_ll);
    if (!coords) {
      console.error('Failed to parse centroide_ll:', doc.centroide_ll);
      return null;
    }

    return {
      bagId: doc.id,
      formattedAddress: doc.weergavenaam,
      lat: coords.lat,
      lon: coords.lon,
      details: {
        city: doc.woonplaatsnaam || params.city || '',
        zip: doc.postcode || params.zipcode || '',
        street: doc.straatnaam || params.street?.replace(/-/g, ' ') || '',
        number: doc.huisnummer || params.housenumber || '',
      },
    };
  } catch (error) {
    console.error('PDOK API request failed:', error);
    return null;
  }
}

/**
 * Search for addresses by free text query
 * Used for search/autocomplete functionality
 *
 * @param query Free text search query
 * @param limit Maximum number of results
 * @returns Array of resolved addresses
 */
export async function searchAddresses(query: string, limit: number = 5): Promise<ResolvedAddress[]> {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const searchParams = new URLSearchParams({
      q: query,
      fq: 'type:adres',
      fl: 'id,weergavenaam,centroide_ll,huisnummer,postcode,straatnaam,woonplaatsnaam',
      rows: String(limit),
    });

    const response = await fetch(`${PDOK_SEARCH_URL}?${searchParams.toString()}`);

    if (!response.ok) {
      return [];
    }

    const data: PDOKResponse = await response.json();

    return data.response.docs
      .filter(doc => doc.centroide_ll)
      .map(doc => {
        const coords = parseWGS84Point(doc.centroide_ll!);
        if (!coords) return null;

        return {
          bagId: doc.id,
          formattedAddress: doc.weergavenaam,
          lat: coords.lat,
          lon: coords.lon,
          details: {
            city: doc.woonplaatsnaam || '',
            zip: doc.postcode || '',
            street: doc.straatnaam || '',
            number: doc.huisnummer || '',
          },
        };
      })
      .filter((addr): addr is ResolvedAddress => addr !== null);
  } catch (error) {
    console.error('Address search failed:', error);
    return [];
  }
}

/**
 * Determine the view type based on URL parameters
 */
export type AddressViewType = 'city' | 'postcode' | 'street' | 'property' | 'invalid';

export function determineViewType(params: AddressUrlParams): AddressViewType {
  if (!params.city) return 'invalid';
  if (!params.zipcode) return 'city';
  if (!params.street || !params.housenumber) return 'postcode';
  return 'property';
}

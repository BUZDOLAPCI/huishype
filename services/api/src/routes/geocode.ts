import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../config.js';
import {
  getCountryConfig,
  isValidCountryCode,
  type CountryCode,
  type GeocodeSuggestion,
} from '@huishype/shared';
import { hydrateLocationTokens, searchLocations } from '../services/location-search.js';

/** Photon GeoJSON feature shape (subset we use) */
interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    locality?: string;
    district?: string;
    county?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

const PHOTON_COUNTRY_FILTER_MULTIPLIER = 5;
const PHOTON_COUNTRY_FILTER_MAX_LIMIT = 20;
const REVERSE_GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 2_048;
const REVERSE_GEOCODE_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  lang: z.string().optional(),
  countrycode: z.string().optional(),
  countrymode: z.enum(['soft']).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
});

const locationSearchQuerySchema = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  countrycode: z.string().optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
});

const locationTokenHydrationQuerySchema = z.object({
  area: z.union([z.string(), z.array(z.string())]).optional(),
  countrycode: z.union([z.string(), z.array(z.string())]).optional(),
});

const reverseQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  lang: z.string().optional(),
});

const geocodeSuggestionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  countryCode: z.string().optional(),
  coordinates: z.tuple([z.number(), z.number()]),
});

const locationFilterTokenSchema = z.object({
  id: z.string().nullable().optional(),
  type: z.enum(['street', 'postcode', 'city', 'region', 'country', 'current-location']),
  countryCode: z.string().nullable().optional(),
  value: z.string(),
  label: z.string(),
  parentLabel: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  divisionId: z.string().nullable().optional(),
  parentDivisionId: z.string().nullable().optional(),
  parentDivisionKind: z.enum(['city', 'region', 'country']).nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  coordinates: z.tuple([z.number(), z.number()]).nullable().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  radiusMeters: z.number().nullable().optional(),
});

const locationSearchSuggestionSchema = z.object({
  id: z.string(),
  type: z.enum(['property', 'address', 'street', 'postcode', 'city', 'region', 'country']),
  label: z.string(),
  subtitle: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  coordinates: z.tuple([z.number(), z.number()]).nullable().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  propertyId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  houseNumber: z.string().nullable().optional(),
  houseNumberAddition: z.string().nullable().optional(),
  filterToken: locationFilterTokenSchema.nullable().optional(),
});

const reverseGeocodeResponseSchema = z.nullable(
  z.object({
    locality: z.string().nullable(),
    district: z.string().nullable(),
    county: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable(),
  })
);

type ReverseGeocodeResponse = z.infer<typeof reverseGeocodeResponseSchema>;

type ReverseGeocodeCacheEntry = {
  expiresAt: number;
  value: ReverseGeocodeResponse;
};

const reverseGeocodeCache = new Map<string, ReverseGeocodeCacheEntry>();

export function resetReverseGeocodeCacheForTests(): void {
  reverseGeocodeCache.clear();
}

function buildReverseGeocodeCacheKey(lon: number, lat: number, lang: string | undefined): string {
  return `${lon.toFixed(5)}:${lat.toFixed(5)}:${lang ?? ''}`;
}

function getCachedReverseGeocode(cacheKey: string): ReverseGeocodeResponse | undefined {
  const entry = reverseGeocodeCache.get(cacheKey);
  const now = Date.now();

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= now) {
    reverseGeocodeCache.delete(cacheKey);
    return undefined;
  }

  reverseGeocodeCache.delete(cacheKey);
  reverseGeocodeCache.set(cacheKey, entry);
  return entry.value;
}

function setCachedReverseGeocode(cacheKey: string, value: ReverseGeocodeResponse): void {
  const now = Date.now();

  for (const [key, entry] of reverseGeocodeCache) {
    if (entry.expiresAt <= now) {
      reverseGeocodeCache.delete(key);
    }
  }

  while (reverseGeocodeCache.size >= REVERSE_GEOCODE_CACHE_MAX_ENTRIES) {
    const oldestKey = reverseGeocodeCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    reverseGeocodeCache.delete(oldestKey);
  }

  reverseGeocodeCache.set(cacheKey, {
    expiresAt: now + REVERSE_GEOCODE_CACHE_TTL_MS,
    value,
  });
}

/**
 * Format a Photon feature into a human-readable display name.
 * Constructs "Street HouseNumber, PostalCode City" style strings.
 */
function formatDisplayName(props: PhotonFeature['properties']): string {
  const parts: string[] = [];

  // Street + house number
  if (props.street) {
    let streetPart = props.street;
    if (props.housenumber) {
      streetPart += ` ${props.housenumber}`;
    }
    parts.push(streetPart);
  } else if (props.name) {
    parts.push(props.name);
  }

  // PostalCode + City
  const locationParts: string[] = [];
  if (props.postcode) locationParts.push(props.postcode);
  if (props.city) locationParts.push(props.city);
  if (locationParts.length > 0) {
    parts.push(locationParts.join(' '));
  }

  return parts.join(', ') || 'Unknown location';
}

/**
 * Transform a Photon feature into our internal GeocodeSuggestion format.
 */
function transformFeature(feature: PhotonFeature): GeocodeSuggestion {
  const { properties: props, geometry } = feature;

  return {
    id: `${props.osm_type || 'N'}_${props.osm_id || 0}`,
    displayName: formatDisplayName(props),
    street: props.street,
    houseNumber: props.housenumber,
    postalCode: props.postcode,
    city: props.city,
    region: props.state,
    countryCode: props.countrycode,
    coordinates: geometry.coordinates,
  };
}

function normalizeCountryCode(countrycode: string | undefined): CountryCode | undefined {
  const normalized = countrycode?.trim().toUpperCase();
  return normalized && isValidCountryCode(normalized) ? normalized : undefined;
}

function matchesCountryCode(
  feature: PhotonFeature,
  requestedCountryCode: CountryCode | undefined
): boolean {
  if (!requestedCountryCode) {
    return true;
  }

  return feature.properties.countrycode?.trim().toUpperCase() === requestedCountryCode;
}

type PhotonSearchOptions = {
  q: string;
  limit: number;
  lang?: string;
  countryCode?: CountryCode;
  proximity?: SearchProximity;
};

type SearchProximity = { lon: number; lat: number };

function getSearchProximity(
  lon: number | undefined,
  lat: number | undefined
): { lon: number; lat: number } | undefined {
  return lon !== undefined && lat !== undefined ? { lon, lat } : undefined;
}

function buildPhotonSearchParams({
  q,
  limit,
  lang,
  countryCode,
  proximity,
}: PhotonSearchOptions): URLSearchParams {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (lang) params.set('lang', lang);
  if (countryCode) params.set('countrycode', countryCode.toLowerCase());

  if (proximity) {
    params.set('lon', String(proximity.lon));
    params.set('lat', String(proximity.lat));
  } else if (countryCode) {
    const [lon, lat] = getCountryConfig(countryCode).defaultCenter;
    params.set('lon', String(lon));
    params.set('lat', String(lat));
  }

  return params;
}

async function fetchPhotonFeatures(
  app: FastifyInstance,
  options: PhotonSearchOptions
): Promise<PhotonFeature[]> {
  const photonParams = buildPhotonSearchParams(options);
  const photonUrl = `${config.photon.url}/api?${photonParams.toString()}`;
  const response = await fetch(photonUrl, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    let responseBody = '';
    try {
      responseBody = await (
        response as Response & { text?: () => Promise<string> }
      ).text?.();
    } catch {
      responseBody = '';
    }

    app.log.warn(
      {
        status: response.status,
        statusText: response.statusText,
        body: responseBody.slice(0, 500),
      },
      'Photon search request failed'
    );
    return [];
  }

  const data = (await response.json()) as PhotonResponse;
  return Array.isArray(data.features) ? data.features : [];
}

function mergeDedupedSuggestions(
  preferredFeatures: PhotonFeature[],
  fallbackFeatures: PhotonFeature[],
  limit: number
): GeocodeSuggestion[] {
  const deduped = new Map<string, GeocodeSuggestion>();

  for (const feature of [...preferredFeatures, ...fallbackFeatures]) {
    const suggestion = transformFeature(feature);
    if (!deduped.has(suggestion.id)) {
      deduped.set(suggestion.id, suggestion);
    }
    if (deduped.size >= limit) {
      break;
    }
  }

  return Array.from(deduped.values());
}


export async function geocodeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/search/location-tokens',
    {
      schema: {
        tags: ['Search'],
        summary: 'Hydrate selected location URL tokens',
        description:
          'Hydrates repeated readable area query params into structured selected location tokens for chips and map camera fitting.',
        querystring: locationTokenHydrationQuerySchema,
        response: {
          200: z.array(locationFilterTokenSchema),
        },
      },
    },
    async (request, reply) => {
      const { area, countrycode } = request.query;
      return reply.send(await hydrateLocationTokens({ area, countrycode, app }));
    }
  );

  app.get(
    '/search/locations',
    {
      schema: {
        tags: ['Search'],
        summary: 'Typed location search',
        description:
          'Returns typed property/address suggestions for direct navigation and area suggestions for map filtering.',
        querystring: locationSearchQuerySchema,
        response: {
          200: z.array(locationSearchSuggestionSchema),
        },
      },
    },
    async (request, reply) => {
      const { q, limit, countrycode, lon, lat } = request.query;
      return reply.send(
        await searchLocations({
          app,
          q,
          limit,
          countrycode,
          lon,
          lat,
        })
      );
    }
  );

  /**
   * GET /geocode/search
   * Proxies to Photon and reformats the response.
   */
  app.get(
    '/geocode/search',
    {
      schema: {
        tags: ['Geocode'],
        summary: 'Forward geocode search',
        description: 'Proxies to Photon geocoder and returns formatted address suggestions.',
        querystring: searchQuerySchema,
        response: {
          200: z.array(geocodeSuggestionSchema),
        },
      },
    },
    async (request, reply) => {
      const { q, limit, lang, countrycode, countrymode, lon, lat } = request.query;
      const requestedCountryCode = normalizeCountryCode(countrycode);
      const proximity = getSearchProximity(lon, lat);
      const photonLimit = requestedCountryCode
        ? Math.min(
            Math.max(limit * PHOTON_COUNTRY_FILTER_MULTIPLIER, limit),
            PHOTON_COUNTRY_FILTER_MAX_LIMIT
          )
        : limit;

      try {
        if (countrymode === 'soft' && requestedCountryCode) {
          const preferredFeatures = (
            await fetchPhotonFeatures(app, {
              q,
              limit: photonLimit,
              lang,
              countryCode: requestedCountryCode,
              proximity,
            })
          )
            .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
            .slice(0, limit);

          if (preferredFeatures.length >= limit) {
            return reply.send(preferredFeatures.map(transformFeature));
          }

          const fallbackFeatures = await fetchPhotonFeatures(app, {
            q,
            limit,
            lang,
            proximity,
          });

          return reply.send(mergeDedupedSuggestions(preferredFeatures, fallbackFeatures, limit));
        }

        const features = await fetchPhotonFeatures(app, {
          q,
          limit: photonLimit,
          lang,
          countryCode: requestedCountryCode,
          proximity,
        });
        const suggestions = features
          .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
          .slice(0, limit)
          .map(transformFeature);

        return reply.send(suggestions);
      } catch (error) {
        // Photon unreachable — return empty results gracefully
        app.log.warn({ err: error }, 'Photon geocoder unreachable');
        return reply.send([]);
      }
    }
  );

  /**
   * GET /geocode/reverse
   * Reverse geocodes a coordinate to a location hierarchy via Photon.
   * Returns locality/district/city/state/country fields or null if nothing found.
   */
  app.get(
    '/geocode/reverse',
    {
      schema: {
        tags: ['Geocode'],
        summary: 'Reverse geocode coordinates',
        description:
          'Reverse geocodes a coordinate to a location hierarchy via Photon. ' +
          'Returns { locality, district, county, city, state, country, countryCode } or null if nothing found.',
        querystring: reverseQuerySchema,
        response: {
          200: reverseGeocodeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, lang } = request.query;
      const cacheKey = buildReverseGeocodeCacheKey(lon, lat, lang);
      const cached = getCachedReverseGeocode(cacheKey);

      if (cached !== undefined) {
        return reply
          .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
          .header('X-Geocode-Cache', 'hit')
          .send(cached);
      }

      const photonParams = new URLSearchParams({
        lon: String(lon),
        lat: String(lat),
      });
      if (lang) photonParams.set('lang', lang);

      try {
        const photonUrl = `${config.photon.url}/reverse?${photonParams.toString()}`;
        const response = await fetch(photonUrl, {
          signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
          app.log.warn(`Photon reverse returned ${response.status}: ${response.statusText}`);
          return reply.send(null);
        }

        const data = (await response.json()) as PhotonResponse;
        if (!data.features || data.features.length === 0) {
          setCachedReverseGeocode(cacheKey, null);
          return reply
            .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
            .header('X-Geocode-Cache', 'miss')
            .send(null);
        }

        const props = data.features[0].properties;
        const result: ReverseGeocodeResponse = {
          locality: props.locality || null,
          district: props.district || null,
          county: props.county || null,
          city: props.city || null,
          state: props.state || null,
          country: props.country || null,
          countryCode: props.countrycode || null,
        };
        setCachedReverseGeocode(cacheKey, result);
        return reply
          .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
          .header('X-Geocode-Cache', 'miss')
          .send(result);
      } catch (error) {
        app.log.warn({ err: error }, 'Photon reverse geocoder unreachable');
        return reply.send(null);
      }
    }
  );
}

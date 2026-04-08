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

const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  lang: z.string().optional(),
  countrycode: z.string().optional(),
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
  requestedCountryCode: CountryCode | undefined,
): boolean {
  if (!requestedCountryCode) {
    return true;
  }

  return feature.properties.countrycode?.trim().toUpperCase() === requestedCountryCode;
}

export async function geocodeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

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
      const { q, limit, lang, countrycode } = request.query;
      const requestedCountryCode = normalizeCountryCode(countrycode);
      const photonLimit = requestedCountryCode
        ? Math.min(
            Math.max(limit * PHOTON_COUNTRY_FILTER_MULTIPLIER, limit),
            PHOTON_COUNTRY_FILTER_MAX_LIMIT,
          )
        : limit;

      // Build Photon query parameters
      const photonParams = new URLSearchParams({ q, limit: String(photonLimit) });
      if (lang) photonParams.set('lang', lang);
      if (requestedCountryCode) {
        const [lon, lat] = getCountryConfig(requestedCountryCode).defaultCenter;
        photonParams.set('lon', String(lon));
        photonParams.set('lat', String(lat));
      }

      try {
        const photonUrl = `${config.photon.url}/api?${photonParams.toString()}`;
        const response = await fetch(photonUrl, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          app.log.warn(`Photon returned ${response.status}: ${response.statusText}`);
          return reply.send([]);
        }

        const data = await response.json() as PhotonResponse;
        const suggestions = data.features
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

        const data = await response.json() as PhotonResponse;
        if (!data.features || data.features.length === 0) {
          return reply.send(null);
        }

        const props = data.features[0].properties;
        return reply.send({
          locality: props.locality || null,
          district: props.district || null,
          county: props.county || null,
          city: props.city || null,
          state: props.state || null,
          country: props.country || null,
          countryCode: props.countrycode || null,
        });
      } catch (error) {
        app.log.warn({ err: error }, 'Photon reverse geocoder unreachable');
        return reply.send(null);
      }
    }
  );
}

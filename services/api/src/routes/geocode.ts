import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { GeocodeSuggestion } from '@huishype/shared';

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

const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  lang: z.string().optional(),
  countrycode: z.string().optional(),
});

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

export async function geocodeRoutes(app: FastifyInstance) {
  /**
   * GET /geocode/search
   * Proxies to Photon and reformats the response.
   */
  app.get('/geocode/search', async (request, reply) => {
    const parseResult = searchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { q, limit, lang, countrycode } = parseResult.data;

    // Build Photon query parameters
    const photonParams = new URLSearchParams({ q, limit: String(limit) });
    if (lang) photonParams.set('lang', lang);
    if (countrycode) photonParams.set('countrycode', countrycode);

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
      const suggestions = data.features.map(transformFeature);

      return reply.send(suggestions);
    } catch (error) {
      // Photon unreachable — return empty results gracefully
      app.log.warn({ err: error }, 'Photon geocoder unreachable');
      return reply.send([]);
    }
  });
}

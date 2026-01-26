/**
 * Property API mock handlers
 */

import { http, HttpResponse } from 'msw';
import {
  mockPropertySummaries,
  mockMapProperties,
  mockPropertyClusters,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures';
import { getMockAuthUser } from './auth';
import type {
  GetPropertyResponse,
  SearchPropertiesResponse,
  GetMapPropertiesResponse,
} from '@huishype/shared';

const API_BASE = '/api/v1';

export const propertyHandlers = [
  /**
   * GET /properties/:propertyId - Get property details
   */
  http.get(`${API_BASE}/properties/:propertyId`, ({ params, request }) => {
    const { propertyId } = params;
    const property = getMockProperty(propertyId as string);

    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    // Get user's reactions and guess if authenticated
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    const userGuess = authUser
      ? getMockGuesses(property.id).find((g) => g.userId === authUser.id)
      : undefined;

    const response: GetPropertyResponse = {
      property,
      userReactions: authUser
        ? {
            hasLiked: false, // Would come from DB
            hasSaved: false,
          }
        : undefined,
      userGuess,
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/search - Search properties
   */
  http.get(`${API_BASE}/properties/search`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query')?.toLowerCase() || '';
    const city = url.searchParams.get('city')?.toLowerCase();
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    let results = mockPropertySummaries;

    // Filter by query (address)
    if (query) {
      results = results.filter(
        (p) =>
          p.address.toLowerCase().includes(query) ||
          p.city.toLowerCase().includes(query) ||
          p.postalCode.toLowerCase().replace(/\s/g, '').includes(query.replace(/\s/g, ''))
      );
    }

    // Filter by city
    if (city) {
      results = results.filter((p) => p.city.toLowerCase() === city);
    }

    // Limit results
    results = results.slice(0, limit);

    const response: SearchPropertiesResponse = {
      results,
    };

    return HttpResponse.json(response);
  }),

  /**
   * POST /properties/map - Get properties for map display
   */
  http.post(`${API_BASE}/properties/map`, async ({ request }) => {
    const body = await request.json() as {
      bounds: { north: number; south: number; east: number; west: number };
      zoom: number;
      filters?: {
        minPrice?: number;
        maxPrice?: number;
        activityLevel?: string[];
        hasListing?: boolean;
      };
    };

    const { bounds, zoom, filters } = body;

    // Filter properties by bounds
    let properties = mockMapProperties.filter((p) => {
      const { lat, lng } = p.coordinates;
      return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lng >= bounds.west &&
        lng <= bounds.east
      );
    });

    // Apply filters
    if (filters) {
      if (filters.minPrice !== undefined) {
        properties = properties.filter(
          (p) => p.askingPrice === undefined || p.askingPrice >= filters.minPrice!
        );
      }
      if (filters.maxPrice !== undefined) {
        properties = properties.filter(
          (p) => p.askingPrice === undefined || p.askingPrice <= filters.maxPrice!
        );
      }
      if (filters.activityLevel?.length) {
        properties = properties.filter((p) =>
          filters.activityLevel!.includes(p.activityLevel)
        );
      }
      if (filters.hasListing !== undefined) {
        properties = properties.filter((p) =>
          filters.hasListing ? !p.isGhost : p.isGhost
        );
      }
    }

    // Return clusters at low zoom, individual properties at high zoom
    const response: GetMapPropertiesResponse =
      zoom < 12
        ? {
            properties: [],
            clusters: mockPropertyClusters.filter((c) => {
              return (
                c.coordinates.lat >= bounds.south &&
                c.coordinates.lat <= bounds.north &&
                c.coordinates.lng >= bounds.west &&
                c.coordinates.lng <= bounds.east
              );
            }),
          }
        : {
            properties,
            clusters: [],
          };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/:propertyId/my-guess - Get user's guess for a property
   */
  http.get(`${API_BASE}/properties/:propertyId/my-guess`, ({ params, request }) => {
    const { propertyId } = params;
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    const guess = getMockGuesses(propertyId as string).find(
      (g) => g.userId === authUser.id
    );

    if (!guess) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'No guess found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      guess,
      consensus: {
        alignmentPercentage: 85,
        alignsWithTopPredictors: true,
        message: 'Your guess aligns with 85% of top predictors',
      },
      updatedFmv: property.fmv,
    });
  }),
];

/**
 * Property API mock handlers
 */

import { http, HttpResponse } from 'msw';
import {
  mockMapProperties,
  mockPropertyClusters,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures';
import { getMockAuthUser } from './auth';
import type {
  GetMapPropertiesResponse,
  PropertyResolveResponse,
} from '@huishype/shared';

const API_BASE = '/api/v1';

export const propertyHandlers = [
  /**
   * GET /properties/resolve - Resolve address to property
   * Must be before :propertyId handler to avoid route collision
   */
  http.get(`${API_BASE}/properties/resolve`, ({ request }) => {
    const url = new URL(request.url);
    const postalCode = url.searchParams.get('postalCode');
    const houseNumber = url.searchParams.get('houseNumber');

    if (!postalCode || !houseNumber) {
      return HttpResponse.json(
        { code: 'BAD_REQUEST', message: 'postalCode and houseNumber are required' },
        { status: 400 }
      );
    }

    // Return a mock resolved property
    const response: PropertyResolveResponse = {
      id: 'a0000000-0000-4000-a000-000000000001',
      address: `Mockstraat ${houseNumber}, ${postalCode} Amsterdam`,
      postalCode: postalCode.replace(/\s/g, '').toUpperCase(),
      city: 'Amsterdam',
      coordinates: { lon: 4.8952, lat: 52.3702 },
      hasListing: true,
      wozValue: 450000,
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/:propertyId - Get property details
   */
  http.get(`${API_BASE}/properties/:propertyId`, ({ params }) => {
    const { propertyId } = params;
    const property = getMockProperty(propertyId as string);

    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    // GetPropertyResponse = PropertyDetail (flat object)
    // The mock property is already a PropertyDetail, return directly
    return HttpResponse.json(property);
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
      const { lat, lon } = p.coordinates;
      return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lon >= bounds.west &&
        lon <= bounds.east
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
                c.coordinates.lon >= bounds.west &&
                c.coordinates.lon <= bounds.east
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

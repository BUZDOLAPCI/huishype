import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../utils/api';

// Types for property data
export interface PropertyGeometry {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Property {
  id: string;
  bagIdentificatie: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: PropertyGeometry | null;
  bouwjaar: number | null;
  oppervlakte: number | null;
  status: 'active' | 'inactive' | 'demolished';
  wozValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyListResponse {
  data: Property[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PropertyDetails extends Property {
  askingPrice?: number;
  fmv?: number;
  fmvConfidence?: 'low' | 'medium' | 'high';
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  guessCount: number;
  viewCount: number;
}

// Query params for fetching properties
export interface PropertyQueryParams {
  page?: number;
  limit?: number;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  bbox?: string; // "minLon,minLat,maxLon,maxLat"
  lat?: number;
  lon?: number;
  radius?: number;
}

// Fetch properties from API
const fetchProperties = async (params: PropertyQueryParams = {}): Promise<PropertyListResponse> => {
  const queryParams = new URLSearchParams();

  if (params.page) queryParams.append('page', String(params.page));
  if (params.limit) queryParams.append('limit', String(params.limit));
  if (params.city) queryParams.append('city', params.city);
  if (params.minPrice) queryParams.append('minPrice', String(params.minPrice));
  if (params.maxPrice) queryParams.append('maxPrice', String(params.maxPrice));
  if (params.bbox) queryParams.append('bbox', params.bbox);
  if (params.lat !== undefined) queryParams.append('lat', String(params.lat));
  if (params.lon !== undefined) queryParams.append('lon', String(params.lon));
  if (params.radius) queryParams.append('radius', String(params.radius));

  const queryString = queryParams.toString();
  const endpoint = `/properties${queryString ? `?${queryString}` : ''}`;

  return api.get<PropertyListResponse>(endpoint);
};

const fetchPropertyById = async (id: string): Promise<Property | null> => {
  try {
    return await api.get<Property>(`/properties/${id}`);
  } catch (error) {
    console.error('Failed to fetch property:', error);
    return null;
  }
};

const submitPriceGuess = async (data: { propertyId: string; price: number }): Promise<void> => {
  // TODO: Implement when guesses endpoint is available
  console.log('Submitting price guess:', data);
};

// Query keys
export const propertyKeys = {
  all: ['properties'] as const,
  lists: () => [...propertyKeys.all, 'list'] as const,
  list: (params: PropertyQueryParams) => [...propertyKeys.lists(), params] as const,
  details: () => [...propertyKeys.all, 'detail'] as const,
  detail: (id: string) => [...propertyKeys.details(), id] as const,
  map: (bounds?: { north: number; south: number; east: number; west: number }) =>
    [...propertyKeys.all, 'map', bounds] as const,
};

// Hook to fetch properties with optional filters
export function useProperties(params: PropertyQueryParams = {}) {
  return useQuery({
    queryKey: propertyKeys.list(params),
    queryFn: () => fetchProperties(params),
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

// Hook to fetch properties within map bounds
export function useMapProperties(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
} | null) {
  const bbox = bounds
    ? `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
    : undefined;

  return useQuery({
    queryKey: propertyKeys.map(bounds ?? undefined),
    queryFn: () =>
      fetchProperties({
        bbox,
        limit: 100, // Get more properties for map view
      }),
    enabled: !!bounds,
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

// Hook to fetch all properties for initial map load (Eindhoven area)
// API limit is 100 max, so we use that
export function useAllProperties(limit = 100) {
  return useQuery({
    queryKey: ['properties', 'all', limit],
    queryFn: () => fetchProperties({ limit, city: 'Eindhoven' }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}

// Hook to fetch a single property's details
export function useProperty(id: string | null) {
  return useQuery({
    queryKey: id ? propertyKeys.detail(id) : propertyKeys.details(),
    queryFn: () => (id ? fetchPropertyById(id) : null),
    enabled: !!id,
  });
}

// Hook to submit a price guess
export function usePriceGuess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitPriceGuess,
    onSuccess: (_data, variables) => {
      // Invalidate the property detail to refetch updated FMV
      queryClient.invalidateQueries({
        queryKey: propertyKeys.detail(variables.propertyId),
      });
    },
  });
}

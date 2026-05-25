import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  api,
  type OfficialValuationSourceFetch,
} from '../utils/api';
import {
  useVisibleOfficialValuationHydration,
  type OfficialValuationPatch,
} from './useVisibleOfficialValuationHydration';
import { useAuthContext } from '../providers/AuthProvider';
import { withDerivedPropertyImageData } from '../utils/property-image';
import { type MapFilters, type MapMarketState } from '@/src/lib/sharedMapFilters';

// Types for property data
export interface PropertyGeometry {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Property {
  id: string;
  /**
   * Map-node class for properties opened from the map preview surface.
   * API property detail responses do not currently provide this.
   */
  nodeClass?: 'active' | 'ghost';
  nationalId: string | null;
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  street?: string | null;
  houseNumber?: number | null;
  houseNumberAddition?: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: PropertyGeometry | null;
  imageryGeometry?: PropertyGeometry | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: 'active' | 'inactive' | 'demolished';
  officialValuation: number | null;
  officialValuationYear?: number | null;
  officialValuationVerified?: boolean;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  officialValuationHydrationHidden?: boolean;
  commentsDisabled?: boolean;
  hasListing?: boolean;
  hasActiveListing?: boolean;
  marketState?: MapMarketState | null;
  latestListingStatus?: 'active' | 'sold' | 'rented' | 'withdrawn' | null;
  askingPrice?: number | null;
  socialScore?: number;
  recentSocialScore?: number;
  lastSocialAt?: string | null;
  topLevelCommentCount?: number;
  replyCount?: number;
  propertyLikeCount?: number;
  commentLikeCount?: number;
  guessCount?: number;
  viewCount?: number;
  uniqueViewerCount?: number;
  recentTopLevelCommentCount?: number;
  recentReplyCount?: number;
  recentPropertyLikeCount?: number;
  recentCommentLikeCount?: number;
  recentGuessCount?: number;
  recentViewCount?: number;
  recentUniqueViewerCount?: number;
  aerialImageUrl?: string | null;
  thumbnailUrl?: string | null;
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

export interface PropertyFmvData {
  fmv: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    min: number;
    max: number;
  } | null;
  officialValuation: number | null;
  askingPrice: number | null;
  divergence: number | null;
}

export interface PropertyDetails extends Property {
  askingPrice?: number | null;
  fmv?: PropertyFmvData;
  activityLevel?: 'hot' | 'warm' | 'cold';
  commentCount?: number;
  guessCount: number;
  viewCount: number;
  uniqueViewers: number;
  likeCount?: number;
  isLiked?: boolean;
  isSaved?: boolean;
}

export const ACTIVE_SOCIAL_SCORE_THRESHOLD = 0.75;
const RECENT_HOT_SCORE_THRESHOLD = 0.5;
const HOT_ACTIVITY_SCORE_THRESHOLD = 50;

export function getViewerCacheKey(
  user: { id: string } | null | undefined,
  isAuthenticated: boolean
): string {
  return isAuthenticated && user?.id ? `auth:${user.id}` : 'anon';
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

function withDerivedPropertyImages<T extends Property>(property: T): T {
  return withDerivedPropertyImageData(property);
}

export function deriveCompatibilityActivityLevel(
  property: Pick<Property, 'socialScore' | 'recentSocialScore'> & {
    hasActiveListing?: boolean | null;
  }
): 'hot' | 'warm' | 'cold' {
  if ((property.recentSocialScore ?? 0) > RECENT_HOT_SCORE_THRESHOLD) {
    return 'hot';
  }

  if ((property.socialScore ?? 0) >= HOT_ACTIVITY_SCORE_THRESHOLD) {
    return 'hot';
  }

  if ((property.socialScore ?? 0) >= ACTIVE_SOCIAL_SCORE_THRESHOLD) {
    return 'warm';
  }

  return 'cold';
}

function isActivityLevel(value: unknown): value is NonNullable<PropertyDetails['activityLevel']> {
  return value === 'hot' || value === 'warm' || value === 'cold';
}

export function resolvePropertyCommentCount(property: {
  commentCount?: number | null;
  topLevelCommentCount?: number | null;
  replyCount?: number | null;
  commentsDisabled?: boolean | null;
}): number {
  if (property.commentsDisabled) {
    return 0;
  }

  if (
    typeof property.topLevelCommentCount === 'number' ||
    typeof property.replyCount === 'number'
  ) {
    return (property.topLevelCommentCount ?? 0) + (property.replyCount ?? 0);
  }

  return property.commentCount ?? 0;
}

export function resolvePropertyActivityLevel(
  property: Pick<Property, 'socialScore' | 'recentSocialScore'> & {
    hasActiveListing?: boolean | null;
    activityLevel?: PropertyDetails['activityLevel'] | null;
  }
): 'hot' | 'warm' | 'cold' {
  const hasModernSignals =
    typeof property.socialScore === 'number' || typeof property.recentSocialScore === 'number';

  if (hasModernSignals) {
    return deriveCompatibilityActivityLevel(property);
  }

  if (isActivityLevel(property.activityLevel)) {
    return property.activityLevel;
  }

  return 'cold';
}

type PropertyResponseLike = Property &
  Partial<PropertyDetails> & {
    commentCount?: number;
    uniqueViewers?: number;
    likeCount?: number;
  };

function normalizePropertyResponse<T extends PropertyResponseLike>(property: T): T {
  const normalized = {
    ...property,
    commentCount: resolvePropertyCommentCount(property),
    guessCount: property.guessCount ?? 0,
    viewCount: property.viewCount ?? 0,
    uniqueViewers:
      'uniqueViewers' in property && typeof property.uniqueViewers === 'number'
        ? property.uniqueViewers
        : (property.uniqueViewerCount ?? 0),
    likeCount:
      'likeCount' in property && typeof property.likeCount === 'number'
        ? property.likeCount
        : (property.propertyLikeCount ?? 0),
    activityLevel: resolvePropertyActivityLevel(property),
  };

  return withDerivedPropertyImages(normalized as T);
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

  const response = await api.get<PropertyListResponse>(endpoint);
  return {
    ...response,
    data: response.data.map((property) => normalizePropertyResponse(property)),
  };
};

export const fetchPropertyById = async (
  id: string,
  accessToken?: string | null
): Promise<PropertyDetails | null> => {
  try {
    const property = await api.get<PropertyDetails>(
      `/properties/${id}`,
      accessToken
        ? {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        : undefined
    );
    return normalizePropertyResponse(property);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    console.error('Failed to fetch property:', error);
    throw error;
  }
};

function patchOfficialValuationFields(
  property: PropertyDetails,
  patch: OfficialValuationPatch
): PropertyDetails {
  if (
    property.officialValuation === patch.officialValuation &&
    property.officialValuationYear === patch.officialValuationYear &&
    property.officialValuationVerified === patch.officialValuationVerified &&
    !property.officialValuationHydrationHidden
  ) {
    return property;
  }

  return {
    ...property,
    officialValuation: patch.officialValuation,
    officialValuationYear: patch.officialValuationYear,
    officialValuationVerified: patch.officialValuationVerified,
    officialValuationHydrationHidden: false,
    officialValuationSourceFetch: property.officialValuationSourceFetch
      ? {
          ...property.officialValuationSourceFetch,
          expectedValuationYear: patch.expectedValuationYear,
        }
      : property.officialValuationSourceFetch,
  };
}

function hideOfficialValuationFields(property: PropertyDetails): PropertyDetails {
  if (property.officialValuationHydrationHidden) {
    return property;
  }

  return {
    ...property,
    officialValuationHydrationHidden: true,
  };
}

const submitPriceGuess = async (data: { propertyId: string; price: number }): Promise<void> => {
  if (__DEV__) console.log('Submitting price guess:', data);
};

// Query keys
export const propertyKeys = {
  all: ['properties'] as const,
  lists: () => [...propertyKeys.all, 'list'] as const,
  list: (params: PropertyQueryParams) => [...propertyKeys.lists(), params] as const,
  details: () => [...propertyKeys.all, 'detail'] as const,
  detailBase: (id: string) => [...propertyKeys.details(), id] as const,
  detail: (id: string, viewerKey: string) => [...propertyKeys.detailBase(id), viewerKey] as const,
  map: (bounds?: { north: number; south: number; east: number; west: number }) =>
    [...propertyKeys.all, 'map', bounds] as const,
  followingViewportRoot: (viewerKey: string) =>
    [...propertyKeys.all, 'following-viewport', viewerKey] as const,
  followingViewport: (
    viewerKey: string,
    bbox: string | null,
    filters: Pick<
      MapFilters,
      'salePriceFrom' | 'salePriceTo' | 'rentPriceFrom' | 'rentPriceTo' | 'marketState'
    >
  ) => [...propertyKeys.followingViewportRoot(viewerKey), bbox, filters] as const,
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
export function useMapProperties(
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null
) {
  const bbox = bounds ? `${bounds.west},${bounds.south},${bounds.east},${bounds.north}` : undefined;

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
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const queryClient = useQueryClient();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);
  const queryKey = id ? propertyKeys.detail(id, viewerKey) : propertyKeys.details();

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!id) {
        return null;
      }

      const accessToken = await getAccessToken();
      if (viewerKey !== 'anon' && !accessToken) {
        throw new Error('Authenticated property fetch requires an access token');
      }

      return fetchPropertyById(id, accessToken);
    },
    enabled: !!id,
  });

  const hydrationProperties = useMemo(() => (query.data ? [query.data] : []), [query.data]);
  const handleOfficialValuationValue = useCallback(
    (patch: OfficialValuationPatch) => {
      queryClient.setQueriesData<PropertyDetails | null>(
        { queryKey: propertyKeys.detailBase(patch.propertyId) },
        (current) => (current ? patchOfficialValuationFields(current, patch) : current),
      );
    },
    [queryClient],
  );
  const handleOfficialValuationHidden = useCallback(
    (propertyId: string) => {
      queryClient.setQueriesData<PropertyDetails | null>(
        { queryKey: propertyKeys.detailBase(propertyId) },
        (current) => (current ? hideOfficialValuationFields(current) : current),
      );
    },
    [queryClient],
  );

  useVisibleOfficialValuationHydration({
    properties: hydrationProperties,
    enabled: !!id,
    getAccessToken,
    onValue: handleOfficialValuationValue,
    onHidden: handleOfficialValuationHidden,
  });

  return query;
}

// Hook to submit a price guess
export function usePriceGuess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitPriceGuess,
    onSuccess: (_data, variables) => {
      // Invalidate every viewer variant for this property detail.
      queryClient.invalidateQueries({
        queryKey: propertyKeys.detailBase(variables.propertyId),
      });
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import type { ListingReadItem, PropertyListingsResponse } from '@huishype/shared';
import { api } from '../utils/api';

export type ListingData = ListingReadItem;

export function useListings(propertyId: string | null) {
  return useQuery({
    queryKey: ['listings', propertyId],
    queryFn: () => api.get<PropertyListingsResponse>(`/properties/${propertyId}/listings`),
    enabled: !!propertyId,
    staleTime: 30 * 1000,
    select: (response) => response.data,
  });
}

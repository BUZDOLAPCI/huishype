import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api';

export interface ListingData {
  id: string;
  sourceUrl: string;
  sourceName: 'funda' | 'pararius' | 'other';
  askingPrice: number | null;
  priceType: string | null;
  thumbnailUrl: string | null;
  ogTitle: string | null;
  livingAreaM2: number | null;
  numRooms: number | null;
  energyLabel: string | null;
  status: 'active' | 'sold' | 'rented' | 'withdrawn';
  createdAt: string;
}

export function useListings(propertyId: string | null) {
  return useQuery({
    queryKey: ['listings', propertyId],
    queryFn: () => api.get<{ data: ListingData[] }>(`/properties/${propertyId}/listings`),
    enabled: !!propertyId,
    staleTime: 30 * 1000,
    select: (response) => response.data,
  });
}

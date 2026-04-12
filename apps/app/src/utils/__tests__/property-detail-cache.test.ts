import { QueryClient } from '@tanstack/react-query';

import { primePropertyDetailCache } from '../property-detail-cache';
import type { PropertyDetails } from '@/src/hooks/useProperties';

describe('property-detail-cache', () => {
  it('primes the detail query cache with the fetched property', () => {
    const queryClient = new QueryClient();
    const property = {
      id: 'property-123',
      countryCode: 'NL',
      city: 'Eindhoven',
      postalCode: '5651HA',
      street: 'Beeldbuisring',
      houseNumber: 41,
      houseNumberAddition: '',
      address: 'Beeldbuisring 41, 5651HA Eindhoven',
      geometry: {
        type: 'Point' as const,
        coordinates: [5.44550735917662, 51.452441774861] as [number, number],
      },
      imageryGeometry: null,
      nationalId: 'test-national-id',
      region: 'Eindhoven',
      yearBuilt: 2020,
      floorAreaM2: 151,
      status: 'active' as const,
      officialValuation: 385000,
      hasListing: true,
      askingPrice: 395000,
      thumbnailUrl: 'https://example.com/photo.jpg',
      aerialImageUrl: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      activityLevel: 'warm' as const,
      commentCount: 6,
      guessCount: 4,
      viewCount: 111,
      uniqueViewers: 109,
      likeCount: 4,
      isLiked: false,
      isSaved: false,
      fmv: undefined,
    } satisfies PropertyDetails;

    primePropertyDetailCache(queryClient, property);

    expect(queryClient.getQueryData(['properties', 'detail', property.id])).toEqual(
      expect.objectContaining({
        id: 'property-123',
        address: 'Beeldbuisring 41, 5651HA Eindhoven',
        aerialImageUrl: expect.stringContaining('pdok'),
      }),
    );
  });
});

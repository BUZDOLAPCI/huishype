import { describe, expect, it, jest } from '@jest/globals';
import type { FeedItem } from '@huishype/shared';

jest.mock('../../utils/property-image', () => ({
  withDerivedPropertyImageData: jest.fn((value) => value),
}));

import { withDerivedPropertyImageData } from '../../utils/property-image';
import { transformFeedItem } from '../useFeed';

describe('transformFeedItem', () => {
  it('preserves the structured fields needed for canonical property routes', () => {
    const feedItem: FeedItem = {
      id: 'feed-item-1',
      address: 'Baker Street 221B, London',
      city: 'London',
      postalCode: 'NW1 6XE',
      zipCode: 'NW1 6XE',
      countryCode: 'GB',
      streetName: 'Baker Street',
      houseNumber: 221,
      houseNumberAddition: 'B',
      geometry: {
        type: 'Point',
        coordinates: [-0.1585557, 51.523767] as [number, number],
      },
      askingPrice: 950000,
      fmv: 975000,
      officialValuation: 910000,
      thumbnailUrl: 'https://cdn.example.com/feed-item.jpg',
      likeCount: 12,
      commentCount: 4,
      guessCount: 3,
      viewCount: 78,
      activityLevel: 'hot',
      lastActivityAt: '2026-04-10T12:00:00.000Z',
      hasListing: true,
    };

    const transformed = transformFeedItem(feedItem);

    expect(withDerivedPropertyImageData).toHaveBeenCalledWith(
      expect.objectContaining({
        ...feedItem,
        coordinates: { lon: -0.1585557, lat: 51.523767 },
        fmvValue: 975000,
        yearBuilt: null,
        floorAreaM2: null,
      }),
    );

    expect(transformed.streetName).toBe(feedItem.streetName);
    expect(transformed.houseNumber).toBe(feedItem.houseNumber);
    expect(transformed.houseNumberAddition).toBe(feedItem.houseNumberAddition);
    expect(transformed.postalCode).toBe(feedItem.postalCode);
    expect(transformed.zipCode).toBe(feedItem.zipCode);
    expect(transformed.countryCode).toBe(feedItem.countryCode);
    expect(transformed.coordinates).toEqual({
      lat: 51.523767,
      lon: -0.1585557,
    });
    expect(transformed.fmvValue).toBe(975000);
    expect(transformed.yearBuilt).toBeNull();
    expect(transformed.floorAreaM2).toBeNull();
  });
});

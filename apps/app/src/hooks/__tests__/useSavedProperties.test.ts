import { describe, expect, it } from '@jest/globals';
import type { CountryCode, SavedProperty } from '@huishype/shared';
import { getPropertyAerialImageFromGeometry } from '../../lib/propertyThumbnail';

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: null,
    accessToken: null,
  }),
}));

import { transformSavedProperty } from '../useSavedProperties';

function createSavedProperty(
  overrides: Partial<SavedProperty> = {},
): SavedProperty {
  return {
    id: 'a0000000-0000-4000-a000-000000000001',
    nationalId: null,
    countryCode: 'NL' as CountryCode,
    region: null,
    street: 'Teststraat',
    houseNumber: 12,
    houseNumberAddition: null,
    address: 'Teststraat 12, 5611 AA Eindhoven',
    city: 'Eindhoven',
    postalCode: '5611 AA',
    geometry: {
      type: 'Point',
      coordinates: [5.4667, 51.4416],
    },
    imageryGeometry: undefined,
    yearBuilt: 1998,
    floorAreaM2: 120,
    status: 'active',
    officialValuation: 475000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    hasListing: true,
    hasActiveListing: true,
    marketState: 'for-sale',
    latestListingStatus: 'active',
    askingPrice: 499000,
    thumbnailUrl: 'https://cdn.example.com/listing-thumb.jpg',
    socialScore: 9,
    recentSocialScore: 3,
    lastSocialAt: '2026-04-05T12:00:00.000Z',
    topLevelCommentCount: 3,
    replyCount: 5,
    propertyLikeCount: 11,
    commentLikeCount: 7,
    guessCount: 4,
    viewCount: 20,
    uniqueViewerCount: 12,
    recentTopLevelCommentCount: 1,
    recentReplyCount: 2,
    recentPropertyLikeCount: 3,
    recentCommentLikeCount: 2,
    recentGuessCount: 1,
    recentViewCount: 6,
    recentUniqueViewerCount: 4,
    savedAt: '2026-04-06T12:00:00.000Z',
    isSaved: true,
    ...overrides,
  };
}

describe('transformSavedProperty', () => {
  it('derives aerial imagery while keeping listing thumbnails separate', () => {
    const property = createSavedProperty();

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBe(property.thumbnailUrl);
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(property.geometry, property.countryCode as CountryCode)
    );
  });

  it('prefers imageryGeometry when deriving aerial imagery', () => {
    const property = createSavedProperty({
      id: 'a0000000-0000-4000-a000-000000000002',
      imageryGeometry: {
        type: 'Point',
        coordinates: [5.4675, 51.4421],
      },
      thumbnailUrl: null,
    });

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBeNull();
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(
        property.imageryGeometry,
        property.countryCode as CountryCode
      )
    );
  });

  it('counts replies inside the saved-property comment total', () => {
    const property = createSavedProperty({
      topLevelCommentCount: 2,
      replyCount: 4,
    });

    const transformed = transformSavedProperty(property);

    expect(transformed.commentCount).toBe(6);
  });
});

import { describe, expect, it } from '@jest/globals';
import type { CountryCode } from '@huishype/shared';
import { getPropertyAerialImageFromGeometry } from '../../lib/propertyThumbnail';
jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: null,
    accessToken: null,
  }),
}));
import { transformSavedProperty } from '../useSavedProperties';

describe('transformSavedProperty', () => {
  it('derives aerial imagery while keeping listing thumbnails separate', () => {
    const property = {
      id: 'property-1',
      nationalId: null,
      countryCode: 'NL' as CountryCode,
      street: 'Teststraat',
      houseNumber: 12,
      houseNumberAddition: null,
      address: 'Teststraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      postalCode: '5611 AA',
      geometry: {
        type: 'Point' as const,
        coordinates: [5.4667, 51.4416] as [number, number],
      },
      yearBuilt: 1998,
      floorAreaM2: 120,
      status: 'active' as const,
      officialValuation: 475000,
      hasListing: true,
      askingPrice: 499000,
      thumbnailUrl: 'https://cdn.example.com/listing-thumb.jpg',
      commentCount: 8,
      guessCount: 4,
      savedAt: '2026-04-06T12:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBe(property.thumbnailUrl);
    expect(transformed.streetName).toBe(property.street);
    expect(transformed.houseNumber).toBe(property.houseNumber);
    expect(transformed.houseNumberAddition).toBe(property.houseNumberAddition);
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(property.geometry, property.countryCode)
    );
  });

  it('prefers imageryGeometry when deriving aerial imagery', () => {
    const property = {
      id: 'property-2',
      nationalId: null,
      countryCode: 'NL' as CountryCode,
      street: 'Teststraat',
      houseNumber: 12,
      houseNumberAddition: null,
      address: 'Teststraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      postalCode: '5611 AA',
      geometry: {
        type: 'Point' as const,
        coordinates: [5.4667, 51.4416] as [number, number],
      },
      imageryGeometry: {
        type: 'Point' as const,
        coordinates: [5.4675, 51.4421] as [number, number],
      },
      yearBuilt: 1998,
      floorAreaM2: 120,
      status: 'active' as const,
      officialValuation: 475000,
      hasListing: true,
      askingPrice: 499000,
      thumbnailUrl: null,
      commentCount: 8,
      guessCount: 4,
      savedAt: '2026-04-06T12:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBeNull();
    expect(transformed.streetName).toBe(property.street);
    expect(transformed.houseNumber).toBe(property.houseNumber);
    expect(transformed.houseNumberAddition).toBe(property.houseNumberAddition);
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(property.imageryGeometry, property.countryCode)
    );
  });
});

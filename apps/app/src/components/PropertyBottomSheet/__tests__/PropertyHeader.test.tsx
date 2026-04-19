import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PropertyHeader } from '../PropertyHeader';
import type { PropertyDetailsData } from '../types';

const baseProperty: PropertyDetailsData = {
  id: 'property-1',
  nationalId: null,
  countryCode: 'NL',
  address: 'Teststraat 12',
  city: 'Eindhoven',
  postalCode: '5611 AA',
  geometry: { type: 'Point', coordinates: [5.47, 51.44] },
  imageryGeometry: { type: 'Point', coordinates: [5.4701, 51.4401] },
  yearBuilt: 1998,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 475000,
  hasListing: true,
  askingPrice: 499000,
  thumbnailUrl: null,
  aerialImageUrl: null,
  activityLevel: 'warm',
  commentCount: 8,
  guessCount: 4,
  viewCount: 42,
  likeCount: 3,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-06T00:00:00.000Z',
};

describe('PropertyHeader', () => {
  it('renders listing thumbnails without the aerial marker', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          thumbnailUrl: 'https://cdn.huishype.nl/listing-thumb.jpg',
        }}
      />
    );

    expect(screen.getByTestId('property-header-listing')).toBeTruthy();
    expect(screen.getByTestId('property-header-image')).toBeTruthy();
    expect(screen.queryByTestId('property-header-marker')).toBeNull();
  });

  it('renders aerial imagery with the marker when no listing thumbnail exists', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          aerialImageUrl: 'https://images.huishype.nl/aerial.jpg',
        }}
      />
    );

    expect(screen.getByTestId('property-header-satellite')).toBeTruthy();
    expect(screen.getByTestId('property-header-image')).toBeTruthy();
    expect(screen.getByTestId('property-header-marker')).toBeTruthy();
  });

  it('falls back from a broken listing thumbnail to aerial imagery', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          thumbnailUrl: 'https://cdn.huishype.nl/broken-listing.jpg',
        }}
      />
    );

    fireEvent(screen.getByTestId('property-header-image'), 'error');

    return waitFor(() => {
      expect(screen.getByTestId('property-header-marker')).toBeTruthy();
      expect(screen.queryByTestId('property-header-placeholder')).toBeNull();
    });
  });

  it('renders the placeholder when neither listing nor aerial imagery is available', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          countryCode: 'DE',
          geometry: null,
          imageryGeometry: null,
        }}
      />
    );

    expect(screen.getByTestId('property-header-placeholder')).toBeTruthy();
  });
});

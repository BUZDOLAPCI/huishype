import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PropertyImageSurface } from '../PropertyImageSurface';

describe('PropertyImageSurface', () => {
  it('renders listing photos without a marker and keeps cover mode', () => {
    render(
      <PropertyImageSurface
        source={{ listingPhotoUrl: 'https://example.com/listing.jpg' }}
        style={{ width: 120, height: 80 }}
        imageTestID="property-image"
        markerTestID="property-marker"
      />
    );

    const image = screen.getByTestId('property-image');
    expect(image).toBeTruthy();
    expect(image.props.resizeMode).toBe('cover');
    expect(screen.queryByTestId('property-marker')).toBeNull();
  });

  it('renders aerial imagery with a marker and cover mode', () => {
    render(
      <PropertyImageSurface
        source={{
          aerialImageUrl: 'https://example.com/aerial.jpg',
          countryCode: 'NL',
        }}
        style={{ width: 120, height: 80 }}
        imageTestID="property-image"
        markerTestID="property-marker"
      />
    );

    const image = screen.getByTestId('property-image');
    expect(image).toBeTruthy();
    expect(image.props.resizeMode).toBe('cover');
    expect(screen.getByTestId('property-marker')).toBeTruthy();
  });
});

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PropertyImageSurface } from '../PropertyImageSurface';

describe('PropertyImageSurface', () => {
  it('renders listing photos without a marker and keeps cover mode', () => {
    render(
      <PropertyImageSurface
        source={{ listingPhotoUrl: 'https://cdn.huishype.nl/listing.jpg' }}
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
          aerialImageUrl: 'https://images.huishype.nl/aerial.jpg',
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

  it('falls back from a broken listing image to aerial imagery before placeholder', () => {
    render(
        <PropertyImageSurface
        source={{
          listingPhotoUrl: 'https://cdn.huishype.nl/broken-listing.jpg',
          aerialImageUrl: 'https://images.huishype.nl/aerial.jpg',
          countryCode: 'NL',
        }}
        style={{ width: 120, height: 80 }}
        imageTestID="property-image"
        markerTestID="property-marker"
        placeholder={<Text>placeholder</Text>}
      />
    );

    fireEvent(screen.getByTestId('property-image'), 'error');

    const image = screen.getByTestId('property-image');
    expect(image.props.source).toEqual({ uri: 'https://images.huishype.nl/aerial.jpg' });
    expect(screen.getByTestId('property-marker')).toBeTruthy();
    expect(screen.queryByText('placeholder')).toBeNull();
  });

  it('renders the provided placeholder after all image candidates fail', () => {
    render(
      <PropertyImageSurface
        source={{ listingPhotoUrl: 'https://cdn.huishype.nl/broken-listing.jpg' }}
        style={{ width: 120, height: 80 }}
        imageTestID="property-image"
        placeholder={<Text>placeholder</Text>}
      />
    );

    fireEvent(screen.getByTestId('property-image'), 'error');

    expect(screen.queryByTestId('property-image')).toBeNull();
    expect(screen.getByText('placeholder')).toBeTruthy();
  });
});

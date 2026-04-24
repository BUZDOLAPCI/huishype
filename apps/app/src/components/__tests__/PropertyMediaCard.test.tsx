import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PropertyMediaCard, type PropertyMediaData } from '../PropertyMediaCard';

const baseProperty: PropertyMediaData = {
  id: 'prop-1',
  address: 'Keizersgracht 42',
  city: 'Amsterdam',
  postalCode: '1015 CN',
  countryCode: 'NL',
  officialValuation: 389000,
  officialValuationYear: 2024,
  askingPrice: 415000,
  fmv: 400000,
  activityLevel: 'warm',
  yearBuilt: 1925,
  floorAreaM2: 142,
  viewCount: 1600,
};

describe('PropertyMediaCard', () => {
  it('renders address and city', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByText('Keizersgracht 42')).toBeTruthy();
    expect(screen.getByText('Amsterdam, 1015 CN')).toBeTruthy();
  });

  it('renders with full variant by default', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByTestId('property-media-card')).toBeTruthy();
  });

  it('renders activity badge for warm properties', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByTestId('activity-badge')).toBeTruthy();
  });

  it('does not render activity badge for cold properties', () => {
    render(
      <PropertyMediaCard property={{ ...baseProperty, activityLevel: 'cold' }} />
    );
    expect(screen.queryByTestId('activity-badge')).toBeNull();
  });

  it('renders placeholder when no image available', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByTestId('property-media-placeholder')).toBeTruthy();
  });

  it('renders image when listingPhotoUrl is provided', () => {
    render(
      <PropertyMediaCard
        property={{ ...baseProperty, listingPhotoUrl: 'https://cdn.huishype.nl/photo.jpg' }}
      />
    );
    expect(screen.getByTestId('property-media-image')).toBeTruthy();
  });

  it('renders a marker when using aerial imagery fallback', () => {
    render(
      <PropertyMediaCard
        property={{
          ...baseProperty,
          listingPhotoUrl: null,
          aerialImageUrl: 'https://images.huishype.nl/aerial.jpg',
        }}
      />
    );

    expect(screen.getByTestId('property-media-image')).toBeTruthy();
    expect(screen.getByTestId('property-media-aerial-marker')).toBeTruthy();
  });

  it('renders stat pills with year built and floor area', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByTestId('stat-pills')).toBeTruthy();
    expect(screen.getByText('1925')).toBeTruthy();
    expect(screen.getByText('142 m\u00B2')).toBeTruthy();
  });

  it('does not render stat pills when no data', () => {
    const minimal: PropertyMediaData = {
      id: 'prop-2',
      address: 'Test 1',
      city: 'City',
    };
    render(<PropertyMediaCard property={minimal} />);
    expect(screen.queryByTestId('stat-pills')).toBeNull();
  });

  it('renders display price', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    expect(screen.getByTestId('display-price')).toBeTruthy();
  });

  it('prefers FMV over asking price over official valuation', () => {
    render(<PropertyMediaCard property={baseProperty} />);
    // The display price label should be "Crowd Estimate" since FMV is available
    expect(screen.getByText('Crowd Estimate')).toBeTruthy();
  });

  it('falls back to asking price when no FMV', () => {
    const noFmv: PropertyMediaData = {
      ...baseProperty,
      fmv: null,
    };
    render(<PropertyMediaCard property={noFmv} />);
    expect(screen.getByText('Asking Price')).toBeTruthy();
  });

  it('falls back to official valuation when no FMV or asking', () => {
    const valOnly: PropertyMediaData = {
      ...baseProperty,
      fmv: null,
      askingPrice: null,
    };
    render(<PropertyMediaCard property={valOnly} />);
    expect(screen.getByText('WOZ Value (2024)')).toBeTruthy();
  });

  it('shows generic valuation label for non-NL countries', () => {
    const german: PropertyMediaData = {
      ...baseProperty,
      countryCode: 'DE',
      fmv: null,
      askingPrice: null,
    };
    render(<PropertyMediaCard property={german} />);
    expect(screen.getByText('Official Valuation (2024)')).toBeTruthy();
  });

  it('renders no price row when all prices null', () => {
    const noPrices: PropertyMediaData = {
      id: 'prop-3',
      address: 'Test 1',
      city: 'City',
      officialValuation: null,
      askingPrice: null,
      fmv: null,
    };
    render(<PropertyMediaCard property={noPrices} />);
    expect(screen.queryByTestId('display-price')).toBeNull();
  });

  it('calls onPress when card is pressed', () => {
    const onPress = jest.fn();
    render(<PropertyMediaCard property={baseProperty} onPress={onPress} />);
    fireEvent.press(screen.getByText('Keizersgracht 42'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders compact variant with activity dot instead of badge', () => {
    render(<PropertyMediaCard property={baseProperty} variant="compact" />);
    expect(screen.getByTestId('activity-dot')).toBeTruthy();
    expect(screen.queryByTestId('activity-badge')).toBeNull();
  });

  it('compact variant does not render stat pills', () => {
    render(<PropertyMediaCard property={baseProperty} variant="compact" />);
    expect(screen.queryByTestId('stat-pills')).toBeNull();
  });
});

describe('PropertyMediaCard - Multi-country edge cases', () => {
  it('handles property without postal code', () => {
    const noPc: PropertyMediaData = {
      ...baseProperty,
      postalCode: null,
    };
    render(<PropertyMediaCard property={noPc} />);
    expect(screen.getByText('Amsterdam')).toBeTruthy();
  });

  it('handles property without country code', () => {
    const noCC: PropertyMediaData = {
      ...baseProperty,
      countryCode: undefined,
    };
    render(<PropertyMediaCard property={noCC} />);
    expect(screen.getByText('Keizersgracht 42')).toBeTruthy();
  });
});

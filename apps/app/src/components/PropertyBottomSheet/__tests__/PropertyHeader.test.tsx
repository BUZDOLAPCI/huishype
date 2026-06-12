import React from 'react';
import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  PropertyHeader,
  getPropertyAddressTitle,
  getPropertySecondaryLocation,
} from '../PropertyHeader';
import type { PropertyDetailsData } from '../types';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Linking = {
    openURL: jest.fn(),
    canOpenURL: jest.fn().mockResolvedValue(true),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getInitialURL: jest.fn().mockResolvedValue(null),
  };
  return RN;
});

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

function flattenDeepStyle(style: StyleProp<ViewStyle>): ViewStyle {
  const flatten = (value: unknown): unknown[] =>
    Array.isArray(value) ? value.flatMap(flatten) : [value];

  return flatten(style).reduce<ViewStyle>((merged, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...merged, ...(value as ViewStyle) };
    }

    return merged;
  }, {});
}

describe('PropertyHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('renders the flat summary with address, location, metrics, status pills, and map link', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          activityLevel: 'hot',
          marketState: 'for-rent',
        }}
      />
    );

    expect(screen.queryByText('Property Detail')).toBeNull();
    expect(screen.getByText('Teststraat 12')).toBeTruthy();
    expect(screen.getByText('Eindhoven, 5611 AA')).toBeTruthy();
    expect(screen.getByText('1998')).toBeTruthy();
    expect(screen.getByText('120 m\u00B2')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByTestId('property-header-status-pills')).toBeTruthy();
    expect(screen.getByTestId('property-header-activity-pill')).toBeTruthy();
    expect(screen.getByTestId('property-header-listing-pill')).toBeTruthy();
    expect(screen.getByText('Hot')).toBeTruthy();
    expect(screen.getByText('For rent')).toBeTruthy();
    expect(screen.getByText('Open in Google Maps')).toBeTruthy();
  });

  it('renders activity and listing pills for active listings', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          activityLevel: 'hot',
          marketState: 'for-rent',
        }}
      />
    );

    expect(screen.getByTestId('property-header-status-pills')).toBeTruthy();
    expect(screen.getByTestId('property-header-activity-pill')).toBeTruthy();
    expect(screen.getByTestId('property-header-listing-pill')).toBeTruthy();
    expect(screen.getByText('Hot')).toBeTruthy();
    expect(screen.getByText('For rent')).toBeTruthy();
  });

  it('lays out status pills horizontally while the title fits on one line', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: 'Short 1',
          activityLevel: 'hot',
          marketState: 'for-sale',
        }}
      />
    );

    fireEvent(screen.getByText('Short 1'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 180, height: 35 } },
    });

    expect(flattenDeepStyle(screen.getByTestId('property-header-status-pills').props.style))
      .toMatchObject({ flexDirection: 'row' });
  });

  it('stacks status pills when the inline layout makes the title wrap', () => {
    const longAddress = 'Very Long Teststraat Address Name 123';

    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: longAddress,
          activityLevel: 'hot',
          marketState: 'for-sale',
        }}
      />
    );

    fireEvent(screen.getByText(longAddress), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 180, height: 70 } },
    });

    expect(flattenDeepStyle(screen.getByTestId('property-header-status-pills').props.style))
      .toMatchObject({ flexDirection: 'column' });
  });

  it('renders listing pills for terminal listing states and hides unlisted properties', () => {
    const { rerender } = render(
      <PropertyHeader property={{ ...baseProperty, marketState: 'sold' }} />
    );

    expect(screen.getByTestId('property-header-listing-pill')).toBeTruthy();
    expect(screen.getByText('Sold')).toBeTruthy();

    rerender(<PropertyHeader property={{ ...baseProperty, marketState: 'rented' }} />);

    expect(screen.getByTestId('property-header-listing-pill')).toBeTruthy();
    expect(screen.getByText('Rented')).toBeTruthy();

    rerender(<PropertyHeader property={{ ...baseProperty, marketState: 'not-listed' }} />);

    expect(screen.queryByText('For sale')).toBeNull();
    expect(screen.queryByText('For rent')).toBeNull();
    expect(screen.queryByText('Sold')).toBeNull();
    expect(screen.queryByText('Rented')).toBeNull();
    expect(screen.queryByTestId('property-header-listing-pill')).toBeNull();
  });

  it('opens the property address in Google Maps from the main property card', () => {
    render(<PropertyHeader property={baseProperty} />);

    fireEvent.press(screen.getByText('Open in Google Maps'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=Teststraat%2012%2C%205611AA%2C%20Eindhoven%2C%20NL'
    );
  });

  it('renders only the street address as the title when address includes postcode and city', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: 'Beeldbuisring 41, 5651 HA Eindhoven',
          postalCode: '5651 HA',
          city: 'Eindhoven',
        }}
      />
    );

    expect(screen.getByText('Beeldbuisring 41')).toBeTruthy();
    expect(screen.queryByText('Beeldbuisring 41, 5651 HA Eindhoven')).toBeNull();
    expect(screen.getByText('Eindhoven, 5651 HA')).toBeTruthy();
  });

  it('exports the same street-only address title formatting for compact headers', () => {
    expect(getPropertyAddressTitle({
      address: 'Beeldbuisring 41, 5651 HA Eindhoven',
    } as PropertyDetailsData)).toBe('Beeldbuisring 41');
    expect(getPropertyAddressTitle({
      address: '  Standalone Address  ',
    } as PropertyDetailsData)).toBe('Standalone Address');
  });

  it('exports the same secondary location formatting for compact headers', () => {
    expect(getPropertySecondaryLocation({
      city: 'Eindhoven',
      postalCode: '5651 HA',
    } as PropertyDetailsData)).toBe('Eindhoven, 5651 HA');
    expect(getPropertySecondaryLocation({
      city: undefined as unknown as string,
      postalCode: '5651 HA',
    } as PropertyDetailsData)).toBe('5651 HA');
  });

  it('reports the measured summary card bottom', () => {
    const onSummaryCardBottomLayout = jest.fn();
    render(
      <PropertyHeader
        property={baseProperty}
        onSummaryCardBottomLayout={onSummaryCardBottomLayout}
      />
    );

    fireEvent(screen.getByTestId('property-header-summary-card'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 210, width: 360, height: 168 } },
    });

    expect(onSummaryCardBottomLayout).toHaveBeenCalledWith(378);
  });

  it('renders the optional hero close button and calls its handler', () => {
    const onHeaderClose = jest.fn();
    const { rerender } = render(<PropertyHeader property={baseProperty} />);

    expect(screen.queryByTestId('property-header-close')).toBeNull();

    rerender(<PropertyHeader property={baseProperty} onHeaderClose={onHeaderClose} />);

    fireEvent.press(screen.getByTestId('property-header-close'));

    expect(onHeaderClose).toHaveBeenCalledTimes(1);
  });

  it('renders optional hero share and like buttons and calls their handlers', () => {
    const onShare = jest.fn();
    const onLike = jest.fn();
    const { rerender } = render(<PropertyHeader property={baseProperty} />);

    expect(screen.queryByTestId('property-header-share')).toBeNull();
    expect(screen.queryByTestId('property-header-like')).toBeNull();

    rerender(<PropertyHeader property={baseProperty} onShare={onShare} onLike={onLike} />);

    fireEvent.press(screen.getByTestId('property-header-share'));
    fireEvent.press(screen.getByTestId('property-header-like'));

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('uses the filled heart variant when the property is liked', () => {
    render(
      <PropertyHeader
        property={{ ...baseProperty, isLiked: true }}
        onLike={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Unlike property')).toBeTruthy();
    expect(screen.getByTestId('property-header-like-icon-filled')).toBeTruthy();
    expect(screen.queryByTestId('property-header-like-icon')).toBeNull();
  });

  it('uses compact Dutch postcodes in Google Maps queries', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: 'Beeldbuisring 45, 5651 HA Eindhoven',
          postalCode: '5651 HA',
        }}
      />
    );

    fireEvent.press(screen.getByText('Open in Google Maps'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=Beeldbuisring%2045%2C%205651HA%20Eindhoven%2C%205651HA%2C%20Eindhoven%2C%20NL'
    );
  });

  it('falls back to coordinates for Google Maps when address text is missing', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: '',
          postalCode: null,
          city: '',
          countryCode: '',
        }}
      />
    );

    fireEvent.press(screen.getByText('Open in Google Maps'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=51.44%2C5.47'
    );
  });

  it('handles nullish address fields without crashing and falls back to coordinates', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          address: null as unknown as string,
          postalCode: null,
          city: undefined as unknown as string,
          countryCode: undefined as unknown as string,
        }}
      />
    );

    fireEvent.press(screen.getByText('Open in Google Maps'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=51.44%2C5.47'
    );
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('renders a postal-code-only location without a leading comma', () => {
    render(
      <PropertyHeader
        property={{
          ...baseProperty,
          city: undefined as unknown as string,
          postalCode: '5651 HA',
        }}
      />
    );

    expect(screen.getByText('5651 HA')).toBeTruthy();
    expect(screen.queryByText(', 5651 HA')).toBeNull();
  });
});

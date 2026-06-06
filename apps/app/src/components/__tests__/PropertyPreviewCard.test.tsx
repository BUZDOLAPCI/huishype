import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { PropertyPreviewCard, type PropertyPreviewData } from '../PropertyPreviewCard';

describe('PropertyPreviewCard', () => {
  const mockProperty: PropertyPreviewData = {
    id: 'test-id-123',
    address: 'Teststraat 123',
    city: 'Eindhoven',
    postalCode: '5600 AA',
    countryCode: 'NL',
    officialValuation: 350000,
    officialValuationYear: 2024,
    activityLevel: 'warm',
    activityScore: 25,
  };

  it('renders property address and city', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByTestId('property-preview-address').props.children).toBe('Teststraat 123');
    expect(screen.getByText('Eindhoven, 5600 AA')).toBeTruthy();
  });

  it('renders only the street line when the full address also contains postcode and city', () => {
    render(
      <PropertyPreviewCard
        property={{
          ...mockProperty,
          address: 'Beeldbuisring 41, 5651 HA Eindhoven',
          streetName: 'Beeldbuisring',
          houseNumber: 41,
          houseNumberAddition: null,
          postalCode: '5651 HA',
          city: 'Eindhoven',
        }}
      />
    );

    expect(screen.getByTestId('property-preview-address').props.children).toBe('Beeldbuisring 41');
    expect(screen.getByText('Eindhoven, 5651 HA')).toBeTruthy();
  });

  it('displays formatted price when official valuation is present', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    // Price is rendered as formatted value (e.g., "€ 350.000")
    expect(screen.getByText(/350/)).toBeTruthy();
    expect(screen.getByText('WOZ Value')).toBeTruthy();
  });

  it('shows activity indicator based on activity level', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows "Hot" for hot activity level', () => {
    const hotProperty: PropertyPreviewData = {
      ...mockProperty,
      activityLevel: 'hot',
    };
    render(<PropertyPreviewCard property={hotProperty} />);

    expect(screen.getByText('Hot')).toBeTruthy();
  });

  it('shows "Quiet" for cold activity level', () => {
    const coldProperty: PropertyPreviewData = {
      ...mockProperty,
      activityLevel: 'cold',
    };
    render(<PropertyPreviewCard property={coldProperty} />);

    expect(screen.getByText('Quiet')).toBeTruthy();
  });

  it('renders a listing pill below the activity pill for active listings', () => {
    render(
      <PropertyPreviewCard
        property={{
          ...mockProperty,
          activityLevel: 'warm',
          marketState: 'for-sale',
        }}
      />
    );

    expect(screen.getByTestId('property-preview-activity-pill')).toBeTruthy();
    expect(screen.getByTestId('property-preview-listing-pill')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('For sale')).toBeTruthy();
  });

  it('renders listing pills for terminal listing states and hides unlisted properties', () => {
    const { rerender } = render(
      <PropertyPreviewCard property={{ ...mockProperty, marketState: 'sold' }} />
    );

    expect(screen.getByTestId('property-preview-listing-pill')).toBeTruthy();
    expect(screen.getByText('Sold')).toBeTruthy();

    rerender(<PropertyPreviewCard property={{ ...mockProperty, marketState: 'rented' }} />);
    expect(screen.getByTestId('property-preview-listing-pill')).toBeTruthy();
    expect(screen.getByText('Rented')).toBeTruthy();

    rerender(<PropertyPreviewCard property={{ ...mockProperty, marketState: 'not-listed' }} />);
    expect(screen.queryByText('For sale')).toBeNull();
    expect(screen.queryByText('For rent')).toBeNull();
    expect(screen.queryByText('Sold')).toBeNull();
    expect(screen.queryByText('Rented')).toBeNull();
    expect(screen.queryByTestId('property-preview-listing-pill')).toBeNull();
  });

  it('renders quick action buttons', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByText('Like')).toBeTruthy();
    expect(screen.getByText('Comment')).toBeTruthy();
    expect(screen.getByText('Guess')).toBeTruthy();
  });

  it('calls onLike when Like button is pressed', () => {
    const onLike = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onLike={onLike} />);

    fireEvent.press(screen.getByTestId('group-preview-like-button'));

    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('calls onComment when Comment button is pressed', () => {
    const onComment = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onComment={onComment} />);

    fireEvent.press(screen.getByTestId('group-preview-comment-button'));

    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('calls onGuess when Guess button is pressed', () => {
    const onGuess = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onGuess={onGuess} />);

    fireEvent.press(screen.getByTestId('group-preview-guess-button'));

    expect(onGuess).toHaveBeenCalledTimes(1);
  });

  it('calls onPress when card is pressed', () => {
    const onPress = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onPress={onPress} />);

    // Press the card (the Pressable component wraps the entire content)
    fireEvent.press(screen.getByTestId('property-preview-address'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('handles property without postal code', () => {
    const propertyWithoutPostalCode: PropertyPreviewData = {
      ...mockProperty,
      postalCode: null,
    };
    render(<PropertyPreviewCard property={propertyWithoutPostalCode} />);

    // Should show city without postal code
    expect(screen.getByText('Eindhoven')).toBeTruthy();
  });

  it('handles property without official valuation', () => {
    const propertyWithoutWozValue: PropertyPreviewData = {
      ...mockProperty,
      officialValuation: null,
    };
    render(<PropertyPreviewCard property={propertyWithoutWozValue} />);

    // Should render without crashing
    expect(screen.getByTestId('property-preview-address').props.children).toBe('Teststraat 123');
  });

  it('renders a WOZ price skeleton when valuation is expected but missing', () => {
    render(
      <PropertyPreviewCard
        property={{
          ...mockProperty,
          officialValuation: null,
          officialValuationYear: null,
          officialValuationSourceFetch: {
            source: 'woz',
            expectedValuationYear: 2025,
            supportsClientFetch: { web: false, native: false },
          },
        }}
      />
    );

    expect(screen.getByText('WOZ Value')).toBeTruthy();
    expect(screen.getByTestId('property-preview-price-value-skeleton')).toBeTruthy();
  });

  it('displays asking price when provided', () => {
    const propertyWithAskingPrice: PropertyPreviewData = {
      ...mockProperty,
      officialValuation: null,
      askingPrice: 395000,
    };
    render(<PropertyPreviewCard property={propertyWithAskingPrice} />);

    // Should render the formatted asking price
    expect(screen.getByText(/395/)).toBeTruthy();
    expect(screen.getByText('Asking Price')).toBeTruthy();
  });

  it('displays FMV when provided', () => {
    const propertyWithFmv: PropertyPreviewData = {
      ...mockProperty,
      fmv: 380000,
    };
    render(<PropertyPreviewCard property={propertyWithFmv} />);

    // FMV takes priority — should render the formatted FMV price
    expect(screen.getByText(/380/)).toBeTruthy();
    expect(screen.getByText('Crowd FMV')).toBeTruthy();
  });

  it('prefers FMV over asking price over official valuation', () => {
    const propertyWithAllPrices: PropertyPreviewData = {
      ...mockProperty,
      officialValuation: 350000,
      askingPrice: 395000,
      fmv: 380000,
    };
    render(<PropertyPreviewCard property={propertyWithAllPrices} />);

    // Should show FMV price (380) not asking (395) or valuation (350)
    expect(screen.getByText(/380/)).toBeTruthy();
  });

  it('defaults to cold activity level when not specified', () => {
    const propertyWithoutActivityLevel: PropertyPreviewData = {
      id: 'test-id',
      address: 'Test Address',
      city: 'Test City',
    };
    render(<PropertyPreviewCard property={propertyWithoutActivityLevel} />);

    expect(screen.getByText('Quiet')).toBeTruthy();
  });

  it('shows close button when showCloseButton is true', () => {
    const onClose = jest.fn();
    render(
      <PropertyPreviewCard property={mockProperty} showCloseButton={true} onClose={onClose} />
    );

    const closeButton = screen.getByTestId('property-preview-close-button');
    expect(closeButton).toBeTruthy();
    fireEvent.press(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports overriding the close button testID', () => {
    render(
      <PropertyPreviewCard
        property={mockProperty}
        showCloseButton={true}
        onClose={jest.fn()}
        closeButtonTestID="group-preview-close-button"
      />
    );

    expect(screen.getByTestId('group-preview-close-button')).toBeTruthy();
    expect(screen.queryByTestId('property-preview-close-button')).toBeNull();
  });

  it('hides close button by default', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.queryByTestId('property-preview-close-button')).toBeNull();
  });

  it('renders arrow when showArrow is true', () => {
    render(<PropertyPreviewCard property={mockProperty} showArrow={true} />);

    expect(screen.getByTestId('property-preview-arrow')).toBeTruthy();
  });

  it('shows "Liked" state correctly', () => {
    render(<PropertyPreviewCard property={mockProperty} isLiked={true} />);

    expect(screen.getByText('Liked')).toBeTruthy();
    expect(screen.queryByText('Like')).toBeNull();
  });

  it('renders stat pills when like/comment counts are provided', () => {
    const propertyWithStats: PropertyPreviewData = {
      ...mockProperty,
      likeCount: 415000,
      commentCount: 12,
    };
    render(<PropertyPreviewCard property={propertyWithStats} />);

    expect(screen.getByText('415K')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders a marker when using aerial imagery fallback', () => {
    const propertyWithAerial: PropertyPreviewData = {
      ...mockProperty,
      countryCode: 'NL',
      aerialImageUrl: 'https://images.huishype.nl/aerial.jpg',
      listingPhotoUrl: null,
    };

    render(<PropertyPreviewCard property={propertyWithAerial} />);

    expect(screen.getByTestId('property-thumbnail-image')).toBeTruthy();
    expect(screen.getByTestId('property-thumbnail-marker')).toBeTruthy();
  });

  it('does not render a marker for listing thumbnails', () => {
    render(
      <PropertyPreviewCard
        property={{
          ...mockProperty,
          thumbnailUrl: 'https://cdn.huishype.nl/listing-thumb.jpg',
          countryCode: 'NL',
        }}
      />
    );

    expect(screen.getByTestId('property-thumbnail-image')).toBeTruthy();
    expect(screen.queryByTestId('property-thumbnail-marker')).toBeNull();
  });

  it('shrinks long addresses instead of truncating with ellipsis', () => {
    const longAddress = 'Beeldbuisring 41 A-12 Achterzijde';

    render(
      <PropertyPreviewCard
        property={{
          ...mockProperty,
          address: longAddress,
        }}
      />
    );

    fireEvent(screen.getByTestId('property-preview-address-container'), 'layout', {
      nativeEvent: { layout: { width: 150, height: 20, x: 0, y: 0 } },
    });
    fireEvent(screen.UNSAFE_getByProps({ testID: 'property-preview-address-measure' }), 'layout', {
      nativeEvent: { layout: { width: 260, height: 20, x: 0, y: 0 } },
    });

    const addressText = screen.getByTestId('property-preview-address');

    expect(addressText.props.children).toBe(longAddress);
    expect(addressText.props.ellipsizeMode).toBe('clip');
    expect(addressText.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontSize: 11.5 })])
    );
  });
});

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
    activityLevel: 'warm',
    activityScore: 25,
  };

  it('renders property address and city', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByText('Teststraat 123')).toBeTruthy();
    expect(screen.getByText('Eindhoven, 5600 AA')).toBeTruthy();
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
    fireEvent.press(screen.getByText('Teststraat 123'));

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
    expect(screen.getByText('Teststraat 123')).toBeTruthy();
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
      <PropertyPreviewCard
        property={mockProperty}
        showCloseButton={true}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByTestId('property-preview-close-button');
    expect(closeButton).toBeTruthy();
    fireEvent.press(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides close button by default', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.queryByTestId('property-preview-close-button')).toBeNull();
  });

  it('renders arrow when showArrow is true', () => {
    render(
      <PropertyPreviewCard property={mockProperty} showArrow={true} />
    );

    expect(screen.getByTestId('property-preview-arrow')).toBeTruthy();
  });

  it('shows "Liked" state correctly', () => {
    render(
      <PropertyPreviewCard property={mockProperty} isLiked={true} />
    );

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
      aerialImageUrl: 'https://example.com/aerial.jpg',
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
          thumbnailUrl: 'https://cdn.example.com/listing-thumb.jpg',
          countryCode: 'NL',
        }}
      />
    );

    expect(screen.getByTestId('property-thumbnail-image')).toBeTruthy();
    expect(screen.queryByTestId('property-thumbnail-marker')).toBeNull();
  });
});

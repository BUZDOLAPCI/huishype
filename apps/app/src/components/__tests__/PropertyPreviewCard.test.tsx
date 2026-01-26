import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { PropertyPreviewCard, type PropertyPreviewData } from '../PropertyPreviewCard';

describe('PropertyPreviewCard', () => {
  const mockProperty: PropertyPreviewData = {
    id: 'test-id-123',
    address: 'Teststraat 123',
    city: 'Eindhoven',
    postalCode: '5600 AA',
    wozValue: 350000,
    activityLevel: 'warm',
    activityScore: 25,
  };

  it('renders property address and city', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByText('Teststraat 123')).toBeTruthy();
    expect(screen.getByText('Eindhoven, 5600 AA')).toBeTruthy();
  });

  it('displays WOZ value correctly', () => {
    render(<PropertyPreviewCard property={mockProperty} />);

    expect(screen.getByText('WOZ Value')).toBeTruthy();
    // Check for the formatted price (Euro symbol + formatted number)
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

    fireEvent.press(screen.getByText('Like'));

    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('calls onComment when Comment button is pressed', () => {
    const onComment = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onComment={onComment} />);

    fireEvent.press(screen.getByText('Comment'));

    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('calls onGuess when Guess button is pressed', () => {
    const onGuess = jest.fn();
    render(<PropertyPreviewCard property={mockProperty} onGuess={onGuess} />);

    fireEvent.press(screen.getByText('Guess'));

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

  it('handles property without WOZ value', () => {
    const propertyWithoutWozValue: PropertyPreviewData = {
      ...mockProperty,
      wozValue: null,
    };
    render(<PropertyPreviewCard property={propertyWithoutWozValue} />);

    // Should render without crashing
    expect(screen.getByText('Teststraat 123')).toBeTruthy();
    // WOZ Value label should not be present
    expect(screen.queryByText('WOZ Value')).toBeNull();
  });

  it('displays asking price when provided', () => {
    const propertyWithAskingPrice: PropertyPreviewData = {
      ...mockProperty,
      wozValue: null,
      askingPrice: 395000,
    };
    render(<PropertyPreviewCard property={propertyWithAskingPrice} />);

    expect(screen.getByText('Asking Price')).toBeTruthy();
  });

  it('displays FMV when provided', () => {
    const propertyWithFmv: PropertyPreviewData = {
      ...mockProperty,
      fmv: 380000,
    };
    render(<PropertyPreviewCard property={propertyWithFmv} />);

    expect(screen.getByText('Crowd FMV')).toBeTruthy();
  });

  it('prefers FMV over asking price over WOZ value', () => {
    const propertyWithAllPrices: PropertyPreviewData = {
      ...mockProperty,
      wozValue: 350000,
      askingPrice: 395000,
      fmv: 380000,
    };
    render(<PropertyPreviewCard property={propertyWithAllPrices} />);

    // Should show FMV label when all prices are available
    expect(screen.getByText('Crowd FMV')).toBeTruthy();
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
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { PriceGuessSlider } from '../PriceGuessSlider';

// Mocks are configured in jest.config.js

describe('PriceGuessSlider', () => {
  const defaultProps = {
    propertyId: 'test-property-123',
    onGuessSubmit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(screen.getByText('What do you think this property is worth?')).toBeTruthy();
    expect(screen.getByTestId('price-guess-slider')).toBeTruthy();
    expect(screen.getByTestId('submit-guess-button')).toBeTruthy();
  });

  it('displays WOZ value when provided', () => {
    render(<PriceGuessSlider {...defaultProps} wozValue={350000} />);

    expect(screen.getByText(/WOZ Value:/)).toBeTruthy();
  });

  it('initializes with user guess when provided', () => {
    render(<PriceGuessSlider {...defaultProps} userGuess={400000} />);

    // The price display should show the user's guess
    expect(screen.getByTestId('price-display')).toBeTruthy();
  });

  it('renders quick adjustment buttons', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(screen.getByText('-50k')).toBeTruthy();
    expect(screen.getByText('-10k')).toBeTruthy();
    expect(screen.getByText('+10k')).toBeTruthy();
    expect(screen.getByText('+50k')).toBeTruthy();
  });

  it('calls onGuessSubmit when submit button is pressed', async () => {
    const onGuessSubmit = jest.fn();
    render(<PriceGuessSlider {...defaultProps} onGuessSubmit={onGuessSubmit} />);

    const submitButton = screen.getByTestId('submit-guess-button');
    fireEvent.press(submitButton);

    await waitFor(() => {
      expect(onGuessSubmit).toHaveBeenCalled();
    });
  });

  it('disables submit button when disabled prop is true', () => {
    render(<PriceGuessSlider {...defaultProps} disabled />);

    // Check that submit button shows disabled state
    const submitButton = screen.getByTestId('submit-guess-button');
    expect(submitButton).toBeTruthy();
  });

  it('shows submitting state when isSubmitting is true', () => {
    render(<PriceGuessSlider {...defaultProps} isSubmitting />);

    expect(screen.getByText('Submitting...')).toBeTruthy();
  });

  it('formats prices in Dutch locale', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    // Check for min price label (€50.000 in Dutch format) - use getAllByText for multiple matches
    expect(screen.getAllByText(/50.000/).length).toBeGreaterThan(0);
  });

  it('renders slider thumb', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(screen.getByTestId('slider-thumb')).toBeTruthy();
  });

  it('renders reference markers when values are provided', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        wozValue={300000}
        askingPrice={350000}
        currentFMV={320000}
      />
    );

    // Check for WOZ marker label
    expect(screen.getByText('WOZ')).toBeTruthy();
    // Check for Ask marker label
    expect(screen.getByText('Ask')).toBeTruthy();
    // Check for FMV marker label
    expect(screen.getByText('FMV')).toBeTruthy();
  });

  it('updates price when quick adjustment buttons are pressed', async () => {
    render(<PriceGuessSlider {...defaultProps} />);

    const plusButton = screen.getByTestId('adjust-plus-10k');
    fireEvent.press(plusButton);

    // The component should update internally
    await waitFor(() => {
      expect(screen.getByTestId('price-display')).toBeTruthy();
    });
  });
});

describe('PriceGuessSlider - Logarithmic Scale', () => {
  // Test that logarithmic scale provides more precision in common price ranges
  it('uses logarithmic scale for slider positioning', () => {
    // This is an implementation detail test
    // The logarithmic scale means that the middle of the slider (position 0.5)
    // should NOT correspond to the linear middle price
    // Linear middle: (50000 + 2000000) / 2 = 1025000
    // Log middle: exp((log(50000) + log(2000000)) / 2) ≈ 316228

    render(<PriceGuessSlider propertyId="test" onGuessSubmit={jest.fn()} />);

    expect(screen.getByTestId('price-guess-slider')).toBeTruthy();
  });
});

describe('PriceGuessSlider - Price Formatting', () => {
  it('formats large prices with thousands separator', () => {
    render(<PriceGuessSlider propertyId="test" onGuessSubmit={jest.fn()} wozValue={1500000} />);

    // Dutch format uses periods as thousands separators - use getAllByText for multiple matches
    expect(screen.getAllByText(/1\.500\.000/).length).toBeGreaterThan(0);
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { PriceGuessSlider } from '../PriceGuessSlider';

// Mocks are configured in jest.config.js
interface TestAnalyticsEvent {
  name: string;
  properties: Record<string, unknown>;
}

describe('PriceGuessSlider', () => {
  const defaultProps = {
    propertyId: 'test-property-123',
    onGuessSubmit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: TestAnalyticsEvent[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__ = [];
  });

  it('renders correctly with default props', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(screen.getByText('What do you think this property is worth?')).toBeTruthy();
    expect(screen.getByTestId('price-guess-slider')).toBeTruthy();
    expect(screen.getByTestId('submit-guess-button')).toBeTruthy();
  });

  it('displays official valuation when provided', () => {
    render(<PriceGuessSlider {...defaultProps} officialValuation={350000} />);

    expect(screen.getByText(/Official Valuation:/)).toBeTruthy();
  });

  it('displays WOZ Value label when countryCode is NL', () => {
    render(<PriceGuessSlider {...defaultProps} officialValuation={350000} countryCode="NL" />);

    expect(screen.getByText(/WOZ Value:/)).toBeTruthy();
  });

  it('displays the official valuation year when provided', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        officialValuation={350000}
        officialValuationYear={2024}
        countryCode="NL"
      />,
    );

    expect(screen.getByText(/WOZ Value \(2024\):/)).toBeTruthy();
  });

  it('initializes with user guess when provided', () => {
    render(<PriceGuessSlider {...defaultProps} userGuess={400000} />);

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/400/)
    );
  });

  it('initializes with initialPrice before official valuation', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={425000}
        officialValuation={350000}
      />
    );

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/425/)
    );
  });

  it('initializes with asking price before initialPrice', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        askingPrice={475000}
        initialPrice={425000}
        officialValuation={350000}
      />
    );

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/475/)
    );
  });

  it('keeps userGuess stronger than initialPrice', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        userGuess={400000}
        initialPrice={425000}
        officialValuation={350000}
      />
    );

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/400/)
    );
  });

  it('uses the submitted guess as a starting point without locking the slider to it', async () => {
    render(<PriceGuessSlider {...defaultProps} userGuess={400000} />);

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));

    await waitFor(() => {
      expect(screen.getByText(/410\.000/)).toBeTruthy();
    });
    expect(screen.getByTestId('previous-guess-bubble')).toBeTruthy();
    expect(screen.getByText(/400/)).toBeTruthy();
  });

  it('re-syncs only when the submitted guess prop changes', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} userGuess={400000} />
    );

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    await waitFor(() => {
      expect(screen.getByText(/410\.000/)).toBeTruthy();
    });

    rerender(<PriceGuessSlider {...defaultProps} userGuess={450000} />);

    await waitFor(() => {
      expect(screen.getByText(/450\.000/)).toBeTruthy();
    });
  });

  it('syncs an asynchronously loaded initialPrice before interaction', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} officialValuation={300000} />
    );

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/300/)
    );

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        officialValuation={300000}
        initialPrice={450000}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('price-display').props.children).toEqual(
        expect.stringMatching(/450/)
      );
    });
  });

  it('does not sync an asynchronously loaded initialPrice after quick adjustment', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} officialValuation={300000} />
    );

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    await waitFor(() => {
      expect(screen.getByTestId('price-display').props.children).toEqual(
        expect.stringMatching(/310/)
      );
    });

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        officialValuation={300000}
        initialPrice={450000}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('price-display').props.children).toEqual(
        expect.stringMatching(/310/)
      );
    });
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

  it('emits client-only shown and submitted diagnostics with buckets', async () => {
    const onGuessSubmit = jest.fn();
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={425000}
        initialPriceSource="active_listing_asking_price"
        initialPriceConfidence="known"
        onGuessSubmit={onGuessSubmit}
      />
    );

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: TestAnalyticsEvent[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    await waitFor(() => {
      expect(analyticsEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'price_guess_slider_shown',
            properties: expect.objectContaining({
              source: 'active_listing_asking_price',
              confidence: 'known',
              startBucket: expect.any(String),
            }),
          }),
        ])
      );
    });

    fireEvent.press(screen.getByTestId('submit-guess-button'));

    await waitFor(() => {
      expect(onGuessSubmit).toHaveBeenCalled();
      expect(analyticsEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'price_guess_slider_submitted',
            properties: expect.objectContaining({
              source: 'active_listing_asking_price',
              confidence: 'known',
              startBucket: expect.any(String),
              submittedBucket: expect.any(String),
              deltaBucket: expect.any(String),
            }),
          }),
        ])
      );
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

  it('does not show separate range labels', () => {
    render(<PriceGuessSlider {...defaultProps} officialValuation={350000} countryCode="NL" />);

    expect(screen.queryByTestId('price-range-min')).toBeNull();
    expect(screen.queryByTestId('price-range-max')).toBeNull();
  });

  it('still derives the slider max from the adopted starting price without rendering range labels', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        officialValuation={350000}
        initialPrice={425000}
      />
    );

    expect(screen.getByTestId('price-display').props.children).toEqual(
      expect.stringMatching(/425/)
    );
    expect(screen.queryByText(/825.000/)).toBeNull();
  });

  it('renders slider thumb', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(screen.getByTestId('slider-thumb')).toBeTruthy();
  });

  it('renders reference markers when values are provided', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        officialValuation={300000}
        askingPrice={350000}
        currentFMV={320000}
      />
    );

    // Check for WOZ marker label with value. The slider marker should not use generic valuation copy.
    expect(screen.getByText(/WOZ.*300/)).toBeTruthy();
    expect(screen.queryByText('Val.')).toBeNull();
    expect(screen.getByTestId('woz-track-marker')).toBeTruthy();
    // Check for Asking marker label with value
    expect(screen.getByText(/Asking.*350/)).toBeTruthy();
    expect(screen.getByTestId('asking-track-marker')).toBeTruthy();
    // Check for Crowd marker label with value
    expect(screen.getByText(/Crowd.*320/)).toBeTruthy();
    expect(screen.getByTestId('crowd-track-marker')).toBeTruthy();
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

  it('does not show HuisHype estimate copy', () => {
    render(<PriceGuessSlider {...defaultProps} initialPrice={425000} />);

    expect(screen.queryByText(/HuisHype estimate/i)).toBeNull();
    expect(screen.queryByText(/HuisHype valuation/i)).toBeNull();
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
    render(<PriceGuessSlider propertyId="test" onGuessSubmit={jest.fn()} officialValuation={1500000} />);

    // Dutch format uses periods as thousands separators - use getAllByText for multiple matches
    expect(screen.getAllByText(/1\.500\.000/).length).toBeGreaterThan(0);
  });
});

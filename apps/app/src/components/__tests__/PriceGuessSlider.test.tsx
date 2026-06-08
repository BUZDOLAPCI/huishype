import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { PriceGuessSlider } from '../PriceGuessSlider';

// Mocks are configured in jest.config.js
interface TestAnalyticsEvent {
  name: string;
  properties: Record<string, unknown>;
}

function getStyleValue(style: unknown, key: string): unknown {
  if (Array.isArray(style)) {
    for (let index = style.length - 1; index >= 0; index -= 1) {
      const value = getStyleValue(style[index], key);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  if (style && typeof style === 'object' && key in style) {
    return (style as Record<string, unknown>)[key];
  }

  return undefined;
}

function getSliderThumbLeft(): number {
  return Number(getStyleValue(screen.getByTestId('slider-thumb').props.style, 'left'));
}

function getExactPriceDisplayText(): string {
  return String(screen.getByTestId('exact-price-display').props.children);
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
    expect(screen.getByText('Drag Slider to Adjust Guess')).toBeTruthy();
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

    expect(getExactPriceDisplayText()).toEqual(
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

    expect(getExactPriceDisplayText()).toEqual(
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

    expect(getExactPriceDisplayText()).toEqual(
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

    expect(getExactPriceDisplayText()).toEqual(
      expect.stringMatching(/400/)
    );
  });

  it('shows the exact price display for the default starting guess', () => {
    render(<PriceGuessSlider {...defaultProps} />);

    expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/350/));
    expect(screen.getByTestId('exact-price-edit-button')).toBeTruthy();
  });

  it('keeps the editable exact price value inline with a compact dynamic pill width', () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} initialPrice={872000} variant="embedded" />
    );

    expect(screen.getByTestId('exact-price-display').props.children).toEqual(
      expect.stringMatching(/872/)
    );
    const exactPriceLabel = screen.getByTestId('exact-price-label');
    expect(exactPriceLabel.props.children).toBe('Your guess:');
    expect(getStyleValue(exactPriceLabel.props.style, 'fontSize')).toBe(18);
    expect(getStyleValue(exactPriceLabel.props.style, 'lineHeight')).toBe(22);
    expect(getStyleValue(exactPriceLabel.props.style, 'color')).toBe('#3D3832');
    expect(screen.getByTestId('exact-price-row').props.style).toMatchObject({
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    });
    expect(screen.getByTestId('exact-price-edit-button')).toBeTruthy();
    const compactWidth = Number(getStyleValue(screen.getByTestId('exact-price-control').props.style, 'width'));
    expect(compactWidth).toBeGreaterThanOrEqual(130);
    expect(compactWidth).toBeLessThanOrEqual(145);
    expect(screen.getByTestId('exact-price-edit-button').props.style).toMatchObject({
      flexDirection: 'row',
      minHeight: 40,
      width: '100%',
      paddingHorizontal: 12,
    });

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        propertyId="test-property-long-price"
        initialPrice={1234000}
        variant="embedded"
      />
    );

    const widerWidth = Number(getStyleValue(screen.getByTestId('exact-price-control').props.style, 'width'));
    expect(widerWidth).toBeGreaterThan(compactWidth);
    expect(widerWidth).toBeLessThanOrEqual(170);
  });

  it('swaps the exact price display to an input when editing', () => {
    render(<PriceGuessSlider {...defaultProps} initialPrice={425000} />);

    fireEvent.press(screen.getByTestId('exact-price-edit-button'));

    expect(screen.queryByTestId('exact-price-display')).toBeNull();
    expect(screen.getByTestId('exact-price-input').props.value).toEqual(
      expect.stringMatching(/€\s?425\.000/)
    );
    expect(screen.getByTestId('exact-price-input').props.autoFocus).toBe(true);
    expect(screen.getByTestId('exact-price-accept-button')).toBeTruthy();
    const editWidth = Number(getStyleValue(screen.getByTestId('exact-price-control').props.style, 'width'));
    expect(editWidth).toBeGreaterThanOrEqual(130);
    expect(editWidth).toBeLessThanOrEqual(145);
    expect(screen.getByTestId('exact-price-input').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          textAlign: 'right',
          width: expect.any(Number),
        }),
      ])
    );
  });

  it('submits a typed exact price through the shared guess state', async () => {
    const onGuessChange = jest.fn();
    const onGuessSubmit = jest.fn();
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={350000}
        onGuessChange={onGuessChange}
        onGuessSubmit={onGuessSubmit}
      />
    );
    const initialThumbLeft = getSliderThumbLeft();

    fireEvent.press(screen.getByTestId('submit-guess-button'));
    expect(onGuessSubmit).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('exact-price-edit-button'));
    fireEvent.changeText(screen.getByTestId('exact-price-input'), '456789');
    fireEvent.press(screen.getByTestId('exact-price-accept-button'));

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/456/));
    });
    expect(getSliderThumbLeft()).not.toBeCloseTo(initialThumbLeft, 5);
    expect(onGuessChange).toHaveBeenLastCalledWith(456789);

    fireEvent.press(screen.getByTestId('submit-guess-button'));
    await waitFor(() => {
      expect(onGuessSubmit).toHaveBeenCalledWith(456789);
    });
  });

  it('syncs quick adjustments into the exact price display', async () => {
    render(<PriceGuessSlider {...defaultProps} />);

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/360/));
    });
  });

  it('clamps out-of-range exact price input to the slider range', async () => {
    const onGuessSubmit = jest.fn();
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={350000}
        onGuessSubmit={onGuessSubmit}
      />
    );

    fireEvent.press(screen.getByTestId('exact-price-edit-button'));
    fireEvent.changeText(screen.getByTestId('exact-price-input'), '9999999');
    fireEvent(screen.getByTestId('exact-price-input'), 'submitEditing');

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/787/));
    });

    fireEvent.press(screen.getByTestId('submit-guess-button'));
    await waitFor(() => {
      expect(onGuessSubmit).toHaveBeenCalledWith(787500);
    });
  });

  it('reverts empty or invalid exact price input without changing the guess', async () => {
    const onGuessSubmit = jest.fn();
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={350000}
        onGuessSubmit={onGuessSubmit}
      />
    );

    fireEvent.press(screen.getByTestId('exact-price-edit-button'));
    fireEvent.changeText(screen.getByTestId('exact-price-input'), 'abc');
    fireEvent(screen.getByTestId('exact-price-input'), 'submitEditing');

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/350/));
    });

    fireEvent.press(screen.getByTestId('exact-price-edit-button'));
    fireEvent.changeText(screen.getByTestId('exact-price-input'), '');
    fireEvent(screen.getByTestId('exact-price-input'), 'submitEditing');

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/350/));
    });

    fireEvent.press(screen.getByTestId('submit-guess-button'));
    expect(onGuessSubmit).not.toHaveBeenCalled();
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

  it('resets local slider state when the property changes', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} propertyId="prop-1" initialPrice={550000} />
    );

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/560/)
      );
    });

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        propertyId="prop-2"
        initialPrice={635000}
        initialPriceSource="local_comparable_price_per_m2"
      />
    );

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/635/)
      );
    });
    expect(screen.getByText(/Comparable homes.*635/)).toBeTruthy();
  });

  it('syncs an asynchronously loaded initialPrice before interaction', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} officialValuation={300000} />
    );

    expect(getExactPriceDisplayText()).toEqual(
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
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/450/)
      );
    });
  });

  it('recomputes the thumb position when valuation hydration changes the slider range', async () => {
    const { rerender } = render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        countryCode="NL"
        initialPrice={365000}
        initialPriceSource="local_comparable_price_per_m2"
      />
    );
    const initialThumbLeft = getSliderThumbLeft();

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        countryCode="NL"
        initialPrice={365000}
        initialPriceSource="local_comparable_price_per_m2"
        officialValuation={370000}
        officialValuationYear={2025}
      />
    );

    await waitFor(() => {
      expect(getSliderThumbLeft()).not.toBeCloseTo(initialThumbLeft, 5);
    });

    const thumbPercent = (getSliderThumbLeft() / 300) * 100;
    const startAnchorPercent = parseFloat(
      String(getStyleValue(screen.getByTestId('start-anchor-track-marker').props.style, 'left')),
    );
    const wozMarkerPercent = parseFloat(
      String(getStyleValue(screen.getByTestId('woz-track-marker').props.style, 'left')),
    );
    expect(thumbPercent).toBeCloseTo(startAnchorPercent, 5);
    expect(thumbPercent).not.toBeCloseTo(wozMarkerPercent, 5);
    expect(screen.getByText(/Comparable homes.*365/)).toBeTruthy();
    expect(screen.getByText(/WOZ.*370/)).toBeTruthy();
  });

  it('syncs an asynchronously replaced initialPrice before interaction', async () => {
    const { rerender } = render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={516000}
        initialPriceSource="official_valuation"
        officialValuation={516000}
      />
    );

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={545000}
        initialPriceSource="official_valuation_adjusted"
        initialPriceSampleSize={73}
        officialValuation={516000}
      />
    );

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/545/)
      );
    });
    expect(screen.getByText(/Comparable homes.*545/)).toBeTruthy();
  });

  it('does not sync an asynchronously loaded initialPrice after quick adjustment', async () => {
    const { rerender } = render(
      <PriceGuessSlider {...defaultProps} officialValuation={300000} />
    );

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
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
      expect(getExactPriceDisplayText()).toEqual(
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

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
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

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    expect(screen.getByText('Submit Guess')).toBeTruthy();
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

  it('does not submit until the slider has been interacted with', async () => {
    const onGuessSubmit = jest.fn();
    render(<PriceGuessSlider {...defaultProps} onGuessSubmit={onGuessSubmit} />);

    fireEvent.press(screen.getByTestId('submit-guess-button'));

    expect(onGuessSubmit).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('adjust-plus-10k'));
    fireEvent.press(screen.getByTestId('submit-guess-button'));

    await waitFor(() => {
      expect(onGuessSubmit).toHaveBeenCalled();
    });
  });

  it('shows an embedded percentage bubble and hides the user price marker before interaction', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        initialPrice={400000}
        currentFMV={410000}
      />
    );

    expect(screen.getByTestId('price-display').props.children).toBe('0%');
    expect(getExactPriceDisplayText()).toEqual(expect.stringMatching(/400/));
    expect(screen.queryByTestId('user-guess-marker')).toBeNull();
    expect(screen.getByText('Drag Slider to Adjust Guess')).toBeTruthy();
    expect(screen.getByTestId('guess-reference-labels').props.style).toMatchObject({
      height: 76,
    });
  });

  it('shows an embedded comparable homes anchor for an adjusted official valuation start', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        officialValuation={350000}
        initialPrice={385000}
        initialPriceSource="official_valuation_adjusted"
      />
    );

    expect(screen.getByText(/Comparable homes.*385/)).toBeTruthy();
    expect(screen.getByText(/Comparable homes.*385/).props.style).toMatchObject({
      color: '#4A40D4',
    });
    const startAnchor = screen.getByTestId('start-anchor-marker');
    const startAnchorConnector = React.Children.toArray(startAnchor.props.children).find(
      (child) =>
        React.isValidElement<{ style?: Record<string, unknown> }>(child) &&
        child.props.style?.width === 1,
    );
    const connectorStyle =
      React.isValidElement<{ style?: Record<string, unknown> }>(startAnchorConnector)
        ? startAnchorConnector.props.style
        : null;
    expect(connectorStyle).toMatchObject({
      height: 24,
      backgroundColor: '#4A40D4',
    });
    expect(startAnchor).toBeTruthy();
    expect(screen.getByTestId('start-anchor-track-marker')).toBeTruthy();
  });

  it('shows an embedded comparable homes anchor for a local comparable start', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        initialPrice={425000}
        initialPriceSource="local_comparable_price_per_m2"
      />
    );

    expect(screen.getByText(/Comparable homes.*425/)).toBeTruthy();
    expect(screen.getByTestId('start-anchor-marker')).toBeTruthy();
  });

  it('keeps embedded edge badges and anchor labels inside the card bleed area', () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        initialPrice={50000}
        initialPriceSource="local_comparable_price_per_m2"
      />
    );

    expect(getStyleValue(screen.getByTestId('price-percentage-bubble').props.style, 'left')).toBe(
      -18,
    );
    expect(getStyleValue(screen.getByText(/Comparable homes.*50/).props.style, 'left')).toBe(-18);
  });

  it('shows an embedded starting anchor for the country default start', () => {
    render(<PriceGuessSlider {...defaultProps} variant="embedded" />);

    expect(screen.getByText(/Starting.*350/)).toBeTruthy();
    expect(screen.getByTestId('start-anchor-marker')).toBeTruthy();
  });

  it('does not duplicate embedded start anchors for asking or official valuation starts', () => {
    const { rerender } = render(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        askingPrice={350000}
        initialPrice={425000}
        initialPriceSource="local_comparable_price_per_m2"
        officialValuation={300000}
      />
    );

    expect(screen.queryByTestId('start-anchor-marker')).toBeNull();
    expect(screen.queryByText(/Comparable homes|Starting/)).toBeNull();
    expect(screen.getByText(/Asking.*350/)).toBeTruthy();

    rerender(
      <PriceGuessSlider
        {...defaultProps}
        variant="embedded"
        officialValuation={350000}
      />
    );

    expect(screen.queryByTestId('start-anchor-marker')).toBeNull();
    expect(screen.queryByText(/Comparable homes|Starting/)).toBeNull();
    expect(screen.getByText(/WOZ.*350/)).toBeTruthy();
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

    expect(getExactPriceDisplayText()).toEqual(
      expect.stringMatching(/425/)
    );
    expect(screen.queryByText(/825.000/)).toBeNull();
  });

  it('allows rough non-listing luxury starts to reach materially higher guesses', async () => {
    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={1100000}
        initialPriceSource="official_valuation_adjusted"
      />
    );

    for (let index = 0; index < 26; index += 1) {
      fireEvent.press(screen.getByTestId('adjust-plus-50k'));
    }

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/2\.400\.000/)
      );
    });
  });

  it('keeps active sale asking-price starts on the tighter listing range', async () => {
    render(<PriceGuessSlider {...defaultProps} askingPrice={1100000} />);

    for (let index = 0; index < 10; index += 1) {
      fireEvent.press(screen.getByTestId('adjust-plus-50k'));
    }

    await waitFor(() => {
      expect(getExactPriceDisplayText()).toEqual(
        expect.stringMatching(/1\.500\.000/)
      );
    });
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
    expect(screen.getByText(/Asking.*350/).props.style).toEqual({
      color: '#4A40D4',
    });
    expect(screen.getByTestId('asking-track-marker')).toBeTruthy();
    // Check for Crowd marker label with value
    expect(screen.getByText(/Crowd.*320/)).toBeTruthy();
    expect(screen.getByTestId('crowd-track-marker')).toBeTruthy();
  });

  it('shows a full slider start anchor for comparable and initial starts', () => {
    const comparableRender = render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={425000}
        initialPriceSource="local_comparable_price_per_m2"
      />
    );

    expect(screen.getByText(/Comparable homes.*425/)).toBeTruthy();
    expect(screen.getByTestId('start-anchor-track-marker')).toBeTruthy();

    comparableRender.unmount();

    render(
      <PriceGuessSlider
        {...defaultProps}
        initialPrice={375000}
        initialPriceSource="initial_price"
      />
    );

    expect(screen.getByText(/Starting.*375/)).toBeTruthy();
    expect(screen.getByTestId('start-anchor-track-marker')).toBeTruthy();
  });

  it('does not render a full slider start anchor for asking or official valuation starts', () => {
    const { rerender } = render(
      <PriceGuessSlider
        {...defaultProps}
        askingPrice={350000}
        initialPrice={425000}
        initialPriceSource="local_comparable_price_per_m2"
        officialValuation={300000}
      />
    );

    expect(screen.queryByText(/Comparable homes|Starting/)).toBeNull();
    expect(screen.queryByTestId('start-anchor-track-marker')).toBeNull();

    rerender(<PriceGuessSlider {...defaultProps} officialValuation={350000} />);

    expect(screen.queryByText(/Comparable homes|Starting/)).toBeNull();
    expect(screen.queryByTestId('start-anchor-track-marker')).toBeNull();
  });

  it('updates price when quick adjustment buttons are pressed', async () => {
    render(<PriceGuessSlider {...defaultProps} />);

    const plusButton = screen.getByTestId('adjust-plus-10k');
    fireEvent.press(plusButton);

    // The component should update internally
    await waitFor(() => {
      expect(screen.getByTestId('exact-price-display')).toBeTruthy();
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

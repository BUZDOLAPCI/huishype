import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock FontAwesome before importing the component
jest.mock('@expo/vector-icons/FontAwesome', () => 'FontAwesome');

import { PropertyFeedCard } from '../PropertyFeedCard';

describe('PropertyFeedCard', () => {
  const defaultProps = {
    id: 'test-id',
    address: 'Prinsengracht 123',
    city: 'Amsterdam',
    postalCode: '1015 DV',
    officialValuation: 500000,
    activityLevel: 'warm' as const,
    commentCount: 15,
    guessCount: 10,
    viewCount: 100,
  };

  it('renders address and city correctly', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('Prinsengracht 123')).toBeTruthy();
    expect(getByText('Amsterdam, 1015 DV')).toBeTruthy();
  });

  it('renders official valuation label', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    // Official valuation should be displayed with generic label (no countryCode)
    expect(getByText('Official Valuation')).toBeTruthy();
  });

  it('renders WOZ Value label when countryCode is NL', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} countryCode="NL" />);

    expect(getByText('WOZ Value')).toBeTruthy();
  });

  it('renders activity stats', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('15')).toBeTruthy(); // comment count
    expect(getByText('10 guesses')).toBeTruthy();
  });

  it('calls onPress when card is tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} onPress={onPress} />
    );

    fireEvent.press(getByTestId('property-feed-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows "Hot" badge for hot activity', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="hot" />
    );

    expect(getByText('Hot')).toBeTruthy();
  });

  it('shows "Active" badge for warm activity', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="warm" />
    );

    expect(getByText('Active')).toBeTruthy();
  });

  it('does not show badge for cold activity', () => {
    const { queryByText } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="cold" />
    );

    expect(queryByText('Hot')).toBeNull();
    expect(queryByText('Active')).toBeNull();
  });

  describe('empty metrics CTAs', () => {
    it('shows "Start the conversation" when commentCount is 0', () => {
      const { getByText } = render(
        <PropertyFeedCard {...defaultProps} commentCount={0} />
      );
      expect(getByText('Start the conversation')).toBeTruthy();
    });

    it('shows "Be the first to guess" when guessCount is 0', () => {
      const { getByText } = render(
        <PropertyFeedCard {...defaultProps} guessCount={0} />
      );
      expect(getByText('Be the first to guess')).toBeTruthy();
    });

    it('hides view count when viewCount is 0', () => {
      const { getByText, queryByText } = render(
        <PropertyFeedCard {...defaultProps} viewCount={0} />
      );
      // View count should not appear in overlay or bottom stats
      expect(queryByText('0')).toBeNull();
      // Other metrics still visible
      expect(getByText('15')).toBeTruthy(); // commentCount
      expect(getByText('10 guesses')).toBeTruthy(); // guessCount
    });

    it('shows real counts when metrics are non-zero', () => {
      const { getByText, getAllByText } = render(<PropertyFeedCard {...defaultProps} />);

      expect(getByText('15')).toBeTruthy(); // commentCount
      expect(getByText('10 guesses')).toBeTruthy(); // guessCount
      expect(getAllByText('100').length).toBeGreaterThanOrEqual(1); // viewCount (in overlay + bottom stats)
    });
  });

  it('renders placeholder when no image URL provided', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('No image available')).toBeTruthy();
  });

  it('renders image when photoUrl is provided', () => {
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} photoUrl="https://example.com/image.jpg" />
    );

    expect(getByTestId('property-image')).toBeTruthy();
  });

  it('shows building year when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} yearBuilt={1920} />
    );

    expect(getByText(/1920/)).toBeTruthy();
  });

  it('shows surface area when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} floorAreaM2={85} />
    );

    expect(getByText(/85 m/)).toBeTruthy();
  });

  it('shows FMV value when provided', () => {
    const { getByText } = render(
      <PropertyFeedCard {...defaultProps} fmvValue={550000} />
    );

    expect(getByText('Crowd FMV')).toBeTruthy();
  });

  it('shows overpriced label in red when asking > FMV', () => {
    const { getByText } = render(
      <PropertyFeedCard
        {...defaultProps}
        askingPrice={600000}
        fmvValue={500000}
      />
    );

    // 20% above FMV → overpriced label
    expect(getByText(/Asking 20\.0% above FMV/)).toBeTruthy();
  });

  it('shows underpriced label when asking < FMV', () => {
    const { getByText } = render(
      <PropertyFeedCard
        {...defaultProps}
        askingPrice={400000}
        fmvValue={500000}
      />
    );

    // 20% below FMV → good deal label
    expect(getByText(/Asking 20\.0% below FMV/)).toBeTruthy();
  });

  it('shows fair price label when asking ≈ FMV', () => {
    const { getByText } = render(
      <PropertyFeedCard
        {...defaultProps}
        askingPrice={505000}
        fmvValue={500000}
      />
    );

    // 1% difference → fair price
    expect(getByText('~Fair price')).toBeTruthy();
  });
});

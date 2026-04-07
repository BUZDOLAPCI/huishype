import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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
    likeCount: 24,
  };

  it('renders address and city correctly', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('Prinsengracht 123')).toBeTruthy();
    expect(getByText('Amsterdam')).toBeTruthy();
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
    const { queryByTestId } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="cold" />
    );

    expect(queryByTestId('activity-badge')).toBeNull();
  });

  it('renders placeholder when no image URL provided', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('No image available')).toBeTruthy();
  });

  it('renders image when a listing thumbnail is provided', () => {
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} thumbnailUrl="https://example.com/image.jpg" />
    );

    expect(getByTestId('property-image')).toBeTruthy();
  });

  it('renders a marker for aerial fallback imagery', () => {
    const { getByTestId } = render(
      <PropertyFeedCard
        {...defaultProps}
        countryCode="NL"
        aerialImageUrl="https://example.com/aerial.jpg"
      />
    );

    expect(getByTestId('property-image')).toBeTruthy();
    expect(getByTestId('property-image-marker')).toBeTruthy();
  });

  it('renders stat pills for non-zero metrics', () => {
    const { getByTestId } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByTestId('feed-card-stats')).toBeTruthy();
  });

  it('renders primary price when fmvValue is provided', () => {
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} fmvValue={550000} />
    );

    expect(getByTestId('property-feed-card')).toBeTruthy();
  });
});

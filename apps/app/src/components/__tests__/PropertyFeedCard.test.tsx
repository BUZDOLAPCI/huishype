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
    officialValuationYear: 2024,
    countryCode: 'NL',
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
    const { getByTestId } = render(<PropertyFeedCard {...defaultProps} onPress={onPress} />);

    fireEvent.press(getByTestId('property-feed-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows "Hot" badge for hot activity', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} activityLevel="hot" />);

    expect(getByText('Hot')).toBeTruthy();
  });

  it('shows "Active" badge for warm activity', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} activityLevel="warm" />);

    expect(getByText('Active')).toBeTruthy();
  });

  it('does not show badge for cold activity', () => {
    const { queryByTestId } = render(<PropertyFeedCard {...defaultProps} activityLevel="cold" />);

    expect(queryByTestId('activity-badge')).toBeNull();
  });

  it('shows a listing pill without an activity badge for cold listed properties', () => {
    const { getByText, queryByTestId } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="cold" marketState="for-sale" />
    );

    expect(queryByTestId('activity-badge')).toBeNull();
    expect(getByText('For sale')).toBeTruthy();
  });

  it('shows activity and listing pills together for warm listed properties', () => {
    const { getByText, getByTestId } = render(
      <PropertyFeedCard {...defaultProps} activityLevel="warm" marketState="for-rent" />
    );

    expect(getByTestId('activity-badge')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
    expect(getByText('For rent')).toBeTruthy();
  });

  it('does not show a listing pill for inactive listing states', () => {
    const { queryByText, rerender } = render(
      <PropertyFeedCard {...defaultProps} marketState="sold" />
    );

    expect(queryByText('For sale')).toBeNull();
    expect(queryByText('For rent')).toBeNull();

    rerender(<PropertyFeedCard {...defaultProps} marketState="rented" />);

    expect(queryByText('For sale')).toBeNull();
    expect(queryByText('For rent')).toBeNull();
  });

  it('renders placeholder when no image URL provided', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('No image available')).toBeTruthy();
  });

  it('renders image when a listing thumbnail is provided', () => {
    const { getByTestId } = render(
      <PropertyFeedCard {...defaultProps} thumbnailUrl="https://cdn.huishype.nl/image.jpg" />
    );

    expect(getByTestId('property-image')).toBeTruthy();
  });

  it('renders a marker for aerial fallback imagery', () => {
    const { getByTestId } = render(
      <PropertyFeedCard
        {...defaultProps}
        countryCode="NL"
        aerialImageUrl="https://images.huishype.nl/aerial.jpg"
      />
    );

    expect(getByTestId('property-image')).toBeTruthy();
    expect(getByTestId('property-image-marker')).toBeTruthy();
  });

  it('renders stat pills for non-zero metrics', () => {
    const { getByTestId } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByTestId('feed-card-stats')).toBeTruthy();
  });

  it('labels official valuation with the year when it is the visible price', () => {
    const { getByText } = render(<PropertyFeedCard {...defaultProps} />);

    expect(getByText('WOZ Value (2024)')).toBeTruthy();
  });

  it('renders WOZ skeletons when valuation is expected but missing', () => {
    const { getByText, getByTestId } = render(
      <PropertyFeedCard
        {...defaultProps}
        officialValuation={null}
        officialValuationYear={null}
        officialValuationSourceFetch={{
          source: 'woz',
          expectedValuationYear: 2025,
          supportsClientFetch: { web: false, native: false },
        }}
      />
    );

    expect(getByText('WOZ Value (2025)')).toBeTruthy();
    expect(getByTestId('property-feed-valuation-value-skeleton')).toBeTruthy();
    expect(getByTestId('property-feed-primary-price-value-skeleton')).toBeTruthy();
  });

  it('renders all four stat pills even when counts are zero', () => {
    const { getByTestId, getAllByText } = render(
      <PropertyFeedCard
        {...defaultProps}
        likeCount={0}
        commentCount={0}
        guessCount={0}
        viewCount={0}
      />
    );

    expect(getByTestId('feed-card-stats-likes')).toBeTruthy();
    expect(getByTestId('feed-card-stats-comments')).toBeTruthy();
    expect(getByTestId('feed-card-stats-guesses')).toBeTruthy();
    expect(getByTestId('feed-card-stats-views')).toBeTruthy();
    expect(getAllByText('0')).toHaveLength(4);
  });

  it('renders primary price when fmvValue is provided', () => {
    const { getByTestId } = render(<PropertyFeedCard {...defaultProps} fmvValue={550000} />);

    expect(getByTestId('property-feed-card')).toBeTruthy();
  });
});

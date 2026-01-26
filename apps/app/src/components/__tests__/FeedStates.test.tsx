import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock FontAwesome before importing components
jest.mock('@expo/vector-icons/FontAwesome', () => 'FontAwesome');

import { FeedLoadingState, FeedLoadingMore } from '../FeedLoadingState';
import { FeedErrorState } from '../FeedErrorState';
import { FeedEmptyState } from '../FeedEmptyState';

describe('FeedLoadingState', () => {
  it('renders loading indicator', () => {
    const { getByTestId, getByText } = render(<FeedLoadingState />);

    expect(getByTestId('feed-loading')).toBeTruthy();
    expect(getByText('Loading properties...')).toBeTruthy();
  });
});

describe('FeedLoadingMore', () => {
  it('renders inline loading indicator', () => {
    const { getByTestId } = render(<FeedLoadingMore />);

    expect(getByTestId('feed-loading-more')).toBeTruthy();
  });
});

describe('FeedErrorState', () => {
  it('renders error message', () => {
    const { getByTestId, getByText } = render(
      <FeedErrorState message="Network error" />
    );

    expect(getByTestId('feed-error')).toBeTruthy();
    expect(getByText('Oops!')).toBeTruthy();
    expect(getByText('Network error')).toBeTruthy();
  });

  it('renders default message when none provided', () => {
    const { getByText } = render(<FeedErrorState />);

    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('calls onRetry when retry button is pressed', () => {
    const mockRetry = jest.fn();
    const { getByTestId } = render(
      <FeedErrorState message="Error" onRetry={mockRetry} />
    );

    fireEvent.press(getByTestId('feed-retry-button'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    const { queryByTestId } = render(<FeedErrorState message="Error" />);

    expect(queryByTestId('feed-retry-button')).toBeNull();
  });
});

describe('FeedEmptyState', () => {
  it('renders empty state message', () => {
    const { getByTestId, getByText } = render(<FeedEmptyState />);

    expect(getByTestId('feed-empty')).toBeTruthy();
    expect(getByText('No properties found')).toBeTruthy();
    expect(getByText('No properties to show.')).toBeTruthy();
  });

  it('shows filter-specific message for "new" filter', () => {
    const { getByText } = render(<FeedEmptyState filter="new" />);

    expect(getByText('No new properties found. Check back later!')).toBeTruthy();
  });

  it('shows filter-specific message for "trending" filter', () => {
    const { getByText } = render(<FeedEmptyState filter="trending" />);

    expect(getByText('No trending properties at the moment.')).toBeTruthy();
  });

  it('shows filter-specific message for "price_mismatch" filter', () => {
    const { getByText } = render(<FeedEmptyState filter="price_mismatch" />);

    expect(getByText('No properties with price mismatches found.')).toBeTruthy();
  });
});

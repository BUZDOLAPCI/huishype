import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { FeedFilterChips } from '../FeedFilterChips';

describe('FeedFilterChips', () => {
  const mockOnFilterChange = jest.fn();

  beforeEach(() => {
    mockOnFilterChange.mockClear();
  });

  it('renders all filter options', () => {
    const { getByText } = render(
      <FeedFilterChips activeFilter="trending" onFilterChange={mockOnFilterChange} />
    );

    expect(getByText('Trending')).toBeTruthy();
    expect(getByText('Latest')).toBeTruthy();
    expect(getByText('Recent Activity')).toBeTruthy();
  });

  it('calls onFilterChange when a chip is pressed', () => {
    const { getByTestId } = render(
      <FeedFilterChips activeFilter="trending" onFilterChange={mockOnFilterChange} />
    );

    fireEvent.press(getByTestId('filter-chip-latest'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('latest');
  });

  it('calls onFilterChange with activity filter value', () => {
    const { getByTestId } = render(
      <FeedFilterChips activeFilter="trending" onFilterChange={mockOnFilterChange} />
    );

    fireEvent.press(getByTestId('filter-chip-recent-activity'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('recent-activity');
  });

  it('renders with trending filter active', () => {
    const { getByTestId } = render(
      <FeedFilterChips
        activeFilter="trending"
        onFilterChange={mockOnFilterChange}
      />
    );

    expect(getByTestId('filter-chip-trending')).toBeTruthy();
  });
});

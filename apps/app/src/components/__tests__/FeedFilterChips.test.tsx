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
    expect(getByText('Activity')).toBeTruthy();
  });

  it('calls onFilterChange when a chip is pressed', () => {
    const { getByTestId } = render(
      <FeedFilterChips activeFilter="trending" onFilterChange={mockOnFilterChange} />
    );

    fireEvent.press(getByTestId('filter-chip-activity'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('activity');
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

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock FontAwesome before importing the component
jest.mock('@expo/vector-icons/FontAwesome', () => 'FontAwesome');

import { FeedFilterChips } from '../FeedFilterChips';

describe('FeedFilterChips', () => {
  const mockOnFilterChange = jest.fn();

  beforeEach(() => {
    mockOnFilterChange.mockClear();
  });

  it('renders all filter options', () => {
    const { getByText } = render(
      <FeedFilterChips activeFilter="all" onFilterChange={mockOnFilterChange} />
    );

    expect(getByText('All')).toBeTruthy();
    expect(getByText('New')).toBeTruthy();
    expect(getByText('Trending')).toBeTruthy();
    expect(getByText('Price Mismatch')).toBeTruthy();
  });

  it('calls onFilterChange when a chip is pressed', () => {
    const { getByTestId } = render(
      <FeedFilterChips activeFilter="all" onFilterChange={mockOnFilterChange} />
    );

    fireEvent.press(getByTestId('filter-chip-trending'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('trending');
  });

  it('calls onFilterChange with correct filter value', () => {
    const { getByTestId } = render(
      <FeedFilterChips activeFilter="all" onFilterChange={mockOnFilterChange} />
    );

    fireEvent.press(getByTestId('filter-chip-new'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('new');

    fireEvent.press(getByTestId('filter-chip-price_mismatch'));
    expect(mockOnFilterChange).toHaveBeenCalledWith('price_mismatch');
  });

  it('renders with trending filter active', () => {
    const { getByTestId } = render(
      <FeedFilterChips
        activeFilter="trending"
        onFilterChange={mockOnFilterChange}
      />
    );

    // The active chip should render without errors
    expect(getByTestId('filter-chip-trending')).toBeTruthy();
  });
});

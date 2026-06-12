import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedTabBar } from '../FeedTabBar';
import { LanguageProvider } from '@/src/i18n';

function renderTabBar(activeFilter: React.ComponentProps<typeof FeedTabBar>['activeFilter']) {
  const onFilterChange = jest.fn();
  render(<FeedTabBar activeFilter={activeFilter} onFilterChange={onFilterChange} />, {
    wrapper: LanguageProvider,
  });

  return { onFilterChange };
}

describe('FeedTabBar', () => {
  it('renders ordered feed tabs with selectable state', () => {
    renderTabBar('recent-activity');

    expect(screen.getByTestId('feed-tab-trending')).toBeTruthy();
    expect(screen.getByTestId('feed-tab-latest')).toBeTruthy();
    expect(screen.getByTestId('feed-tab-recent-activity')).toBeTruthy();
    expect(screen.getByTestId('feed-tab-following')).toBeTruthy();
    expect(screen.getByTestId('feed-tab-recent-activity').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('feed-tab-trending').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('calls onFilterChange with the selected tab', () => {
    const { onFilterChange } = renderTabBar('trending');

    fireEvent.press(screen.getByTestId('feed-tab-latest'));

    expect(onFilterChange).toHaveBeenCalledWith('latest');
  });
});

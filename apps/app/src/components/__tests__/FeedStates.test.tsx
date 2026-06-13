import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { FeedLoadingState, FeedLoadingMore } from '../FeedLoadingState';
import { FeedErrorState } from '../FeedErrorState';
import { FeedEmptyState } from '../FeedEmptyState';
import { LanguageProvider, useLanguage } from '@/src/i18n';

function ForceDutch() {
  const { setLanguage } = useLanguage();

  React.useEffect(() => {
    void setLanguage('nl');
  }, [setLanguage]);

  return null;
}

function renderInDutch(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <ForceDutch />
      {ui}
    </LanguageProvider>
  );
}

describe('FeedLoadingState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders loading indicator', () => {
    const { getByTestId, getByText } = render(<FeedLoadingState />);
    const loadingState = getByTestId('feed-loading');

    expect(loadingState).toBeTruthy();
    expect(getByText('Loading properties...')).toBeTruthy();
  });

  it('keeps the loading surface transparent so the screen background remains visible', () => {
    const { getByTestId } = render(<FeedLoadingState />);
    const loadingState = getByTestId('feed-loading');

    expect(loadingState.props.style).toEqual({ backgroundColor: 'transparent' });
  });

  it('renders Dutch loading copy when the app language is Dutch', async () => {
    const { getByText } = renderInDutch(<FeedLoadingState />);

    await waitFor(() => {
      expect(getByText('Woningen laden...')).toBeTruthy();
    });
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
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders empty state message', () => {
    const { getByTestId, getByText } = render(<FeedEmptyState />);

    expect(getByTestId('feed-empty')).toBeTruthy();
    expect(getByText('No properties found')).toBeTruthy();
    expect(getByText('No properties to show.')).toBeTruthy();
  });

  it('shows filter-specific message for "trending" filter', () => {
    const { getByText } = render(<FeedEmptyState filter="trending" />);

    expect(getByText('No trending properties at the moment.')).toBeTruthy();
  });

  it('shows filter-specific message for "activity" filter', () => {
    const { getByText } = render(<FeedEmptyState filter="activity" />);

    expect(getByText('No property posts yet. Be the first to like, comment, or guess.')).toBeTruthy();
  });

  it('renders Dutch following empty state for signed-out users', async () => {
    const { getByText, queryByText } = renderInDutch(
      <FeedEmptyState filter="activity" signedIn={false} />
    );

    await waitFor(() => {
      expect(getByText('Log in om Volgend te zien')).toBeTruthy();
      expect(queryByText('Sign in to see Following')).toBeNull();
    });
  });
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QuickActions } from '../QuickActions';

describe('src/components/QuickActions', () => {
  it('renders the compact action row without full-only actions', () => {
    render(<QuickActions />);

    expect(screen.getByTestId('quick-action-like')).toBeTruthy();
    expect(screen.getByTestId('quick-action-comment')).toBeTruthy();
    expect(screen.getByTestId('quick-action-guess')).toBeTruthy();
    expect(screen.queryByTestId('quick-action-save')).toBeNull();
    expect(screen.queryByTestId('quick-action-share')).toBeNull();
  });

  it('adds save and share controls only in the full variant', () => {
    render(
      <QuickActions variant="full" onSave={jest.fn()} onShare={jest.fn()} />
    );

    expect(screen.getByTestId('quick-action-save')).toBeTruthy();
    expect(screen.getByTestId('quick-action-share')).toBeTruthy();
  });

  it('shows active labels for liked and saved states', () => {
    render(
      <QuickActions
        variant="full"
        isLiked
        isSaved
        onLike={jest.fn()}
        onSave={jest.fn()}
        onShare={jest.fn()}
      />
    );

    expect(screen.getByText('Liked')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('fires every supplied action callback', () => {
    const onLike = jest.fn();
    const onComment = jest.fn();
    const onGuess = jest.fn();
    const onSave = jest.fn();
    const onShare = jest.fn();

    render(
      <QuickActions
        variant="full"
        onLike={onLike}
        onComment={onComment}
        onGuess={onGuess}
        onSave={onSave}
        onShare={onShare}
      />
    );

    fireEvent.press(screen.getByTestId('quick-action-like'));
    fireEvent.press(screen.getByTestId('quick-action-comment'));
    fireEvent.press(screen.getByTestId('quick-action-guess'));
    fireEvent.press(screen.getByTestId('quick-action-save'));
    fireEvent.press(screen.getByTestId('quick-action-share'));

    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(onGuess).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('formats large compact counts and falls back to labels for zero counts', () => {
    const { rerender } = render(<QuickActions likeCount={1500} />);

    expect(screen.getByText('1.5K')).toBeTruthy();

    rerender(<QuickActions likeCount={0} />);
    expect(screen.getByText('Like')).toBeTruthy();

    rerender(<QuickActions isLiked likeCount={0} />);
    expect(screen.getByText('Liked')).toBeTruthy();
  });
});

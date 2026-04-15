import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QuickActions } from '../QuickActions';

describe('QuickActions', () => {
  it('renders Like, Comment, and Guess buttons in compact variant', () => {
    render(<QuickActions />);
    expect(screen.getByTestId('quick-action-like')).toBeTruthy();
    expect(screen.getByTestId('quick-action-comment')).toBeTruthy();
    expect(screen.getByTestId('quick-action-guess')).toBeTruthy();
  });

  it('does not render Save/Share in compact variant', () => {
    render(<QuickActions onSave={jest.fn()} onShare={jest.fn()} />);
    expect(screen.queryByTestId('quick-action-save')).toBeNull();
    expect(screen.queryByTestId('quick-action-share')).toBeNull();
  });

  it('renders Save and Share in full variant', () => {
    render(
      <QuickActions variant="full" onSave={jest.fn()} onShare={jest.fn()} />
    );
    expect(screen.getByTestId('quick-action-save')).toBeTruthy();
    expect(screen.getByTestId('quick-action-share')).toBeTruthy();
  });

  it('shows active labels in the full variant', () => {
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

  it('calls onLike when Like is pressed', () => {
    const onLike = jest.fn();
    render(<QuickActions onLike={onLike} />);
    fireEvent.press(screen.getByTestId('quick-action-like'));
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('calls onComment when Comment is pressed', () => {
    const onComment = jest.fn();
    render(<QuickActions onComment={onComment} />);
    fireEvent.press(screen.getByTestId('quick-action-comment'));
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('calls onGuess when Guess is pressed', () => {
    const onGuess = jest.fn();
    render(<QuickActions onGuess={onGuess} />);
    fireEvent.press(screen.getByTestId('quick-action-guess'));
    expect(onGuess).toHaveBeenCalledTimes(1);
  });

  it('shows formatted like count', () => {
    render(<QuickActions likeCount={1500} />);
    expect(screen.getByText('1.5K')).toBeTruthy();
  });

  it('shows label when count is 0', () => {
    render(<QuickActions likeCount={0} />);
    expect(screen.getByText('Like')).toBeTruthy();
  });

  it('shows "Liked" label when isLiked is true', () => {
    render(<QuickActions isLiked likeCount={0} />);
    // In compact variant with 0 count, it shows "Liked" label
    expect(screen.getByText('Liked')).toBeTruthy();
  });
});

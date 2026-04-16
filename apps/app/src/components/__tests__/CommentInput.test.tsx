import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CommentInput } from '../CommentInput';

describe('src/components/CommentInput', () => {
  it('gates comment entry for signed-out users', () => {
    const onSubmit = jest.fn();

    render(<CommentInput isAuthenticated={false} onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');

    expect(screen.getByPlaceholderText('Log in to comment...')).toBeTruthy();
    expect(input.props.editable).toBe(false);

    fireEvent.press(screen.getByTestId('comment-send-button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed text for authenticated users and clears the draft', () => {
    const onSubmit = jest.fn();
    render(<CommentInput isAuthenticated currentUsername="caslan" onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');

    expect(screen.getByTestId('user-avatar')).toBeTruthy();

    fireEvent.changeText(input, '  Hello world  ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(onSubmit).toHaveBeenCalledWith('Hello world');
    expect(input.props.value).toBe('');
  });

  it('ignores blank drafts even when authenticated', () => {
    const onSubmit = jest.fn();

    render(<CommentInput isAuthenticated onSubmit={onSubmit} />);

    fireEvent.changeText(screen.getByTestId('comment-text-input'), '   ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows reply context and lets the user dismiss it', () => {
    const onCancelReply = jest.fn();

    render(
      <CommentInput
        isAuthenticated
        replyTo={{ id: 'c-1', username: 'sophie_k' }}
        onCancelReply={onCancelReply}
      />
    );

    expect(screen.getByText(/Replying to @sophie_k/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('cancel-reply'));

    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('uses custom testID', () => {
    render(<CommentInput isAuthenticated testID="custom-input" />);
    expect(screen.getByTestId('custom-input')).toBeTruthy();
  });
});

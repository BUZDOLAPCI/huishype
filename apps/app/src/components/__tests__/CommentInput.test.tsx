import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  CommentInput,
  getFittedTextInputHeight,
  MIN_TEXT_INPUT_HEIGHT,
} from '../CommentInput';

describe('src/components/CommentInput', () => {
  it('lets signed-out users draft and preserves the draft when auth is required', () => {
    const onSubmit = jest.fn(() => false);

    render(<CommentInput isAuthenticated={false} onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');

    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
    expect(input.props.editable).toBe(true);

    fireEvent.changeText(input, '  Hello after login  ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(onSubmit).toHaveBeenCalledWith('Hello after login');
    expect(input.props.value).toBe('  Hello after login  ');
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

  it('fits measured input height while keeping the one-line minimum', () => {
    expect(getFittedTextInputHeight(86)).toBe(86);
    expect(getFittedTextInputHeight(20)).toBe(MIN_TEXT_INPUT_HEIGHT);
    expect(getFittedTextInputHeight(34.2)).toBe(35);
  });

  it('uses custom testID', () => {
    render(<CommentInput isAuthenticated testID="custom-input" />);
    expect(screen.getByTestId('custom-input')).toBeTruthy();
  });
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CommentInput } from '../CommentInput';

describe('CommentInput', () => {
  it('renders input with placeholder for authenticated users', () => {
    render(<CommentInput isAuthenticated />);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
  });

  it('renders disabled placeholder for unauthenticated users', () => {
    render(<CommentInput isAuthenticated={false} />);
    expect(screen.getByPlaceholderText('Log in to comment...')).toBeTruthy();
  });

  it('renders send button', () => {
    render(<CommentInput isAuthenticated />);
    expect(screen.getByTestId('comment-send-button')).toBeTruthy();
  });

  it('calls onSubmit with trimmed content', () => {
    const onSubmit = jest.fn();
    render(<CommentInput isAuthenticated onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');
    fireEvent.changeText(input, '  Hello world  ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(onSubmit).toHaveBeenCalledWith('Hello world');
  });

  it('does not submit empty content', () => {
    const onSubmit = jest.fn();
    render(<CommentInput isAuthenticated onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId('comment-send-button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit whitespace-only content', () => {
    const onSubmit = jest.fn();
    render(<CommentInput isAuthenticated onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');
    fireEvent.changeText(input, '   ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears input after submission', () => {
    const onSubmit = jest.fn();
    render(<CommentInput isAuthenticated onSubmit={onSubmit} />);

    const input = screen.getByTestId('comment-text-input');
    fireEvent.changeText(input, 'Test comment');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(input.props.value).toBe('');
  });

  it('shows reply indicator when replyTo is set', () => {
    render(
      <CommentInput
        isAuthenticated
        replyTo={{ id: 'c-1', username: 'sophie_k' }}
      />
    );
    expect(screen.getByText(/Replying to @sophie_k/)).toBeTruthy();
  });

  it('calls onCancelReply when cancel is pressed', () => {
    const onCancelReply = jest.fn();
    render(
      <CommentInput
        isAuthenticated
        replyTo={{ id: 'c-1', username: 'sophie_k' }}
        onCancelReply={onCancelReply}
      />
    );
    fireEvent.press(screen.getByTestId('cancel-reply'));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('does not show reply indicator when replyTo is null', () => {
    render(<CommentInput isAuthenticated replyTo={null} />);
    expect(screen.queryByText(/Replying to/)).toBeNull();
  });

  it('uses custom testID', () => {
    render(<CommentInput isAuthenticated testID="custom-input" />);
    expect(screen.getByTestId('custom-input')).toBeTruthy();
  });
});

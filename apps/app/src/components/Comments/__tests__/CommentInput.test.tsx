import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { CommentInput } from '../CommentInput';

describe('src/components/Comments/CommentInput', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancelReply = jest.fn();
  let dismissSpy: jest.SpiedFunction<typeof Keyboard.dismiss>;

  beforeEach(() => {
    jest.clearAllMocks();
    dismissSpy = jest.spyOn(Keyboard, 'dismiss');
  });

  it('renders custom placeholder', () => {
    const { getByPlaceholderText } = render(
      <CommentInput
        isAuthenticated
        onSubmit={mockOnSubmit}
        placeholder="Custom placeholder"
      />
    );

    expect(getByPlaceholderText('Custom placeholder')).toBeTruthy();
  });

  it('submits a trimmed comment, clears the draft, and dismisses the keyboard', () => {
    const { getByTestId } = render(
      <CommentInput isAuthenticated onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-text-input');
    fireEvent.changeText(input, '  Test comment  ');
    fireEvent.press(getByTestId('comment-send-button'));

    expect(mockOnSubmit).toHaveBeenCalledWith('Test comment');
    expect(input.props.value).toBe('');
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('does not submit when content is only whitespace', () => {
    const { getByTestId } = render(
      <CommentInput isAuthenticated onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-text-input');
    fireEvent.changeText(input, '   ');
    fireEvent.press(getByTestId('comment-send-button'));

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('tracks the character count and blocks over-limit submission', () => {
    const { getByTestId, queryByText } = render(
      <CommentInput isAuthenticated onSubmit={mockOnSubmit} maxLength={10} />
    );

    const input = getByTestId('comment-text-input');
    fireEvent.changeText(input, 'This is a very long comment');
    fireEvent.press(getByTestId('comment-send-button'));

    expect(getByTestId('character-count').children.join('')).toContain('27/10');
    expect(queryByText(/too long/i)).toBeNull();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('switches into reply mode and clears the draft when reply is cancelled', () => {
    const { getByTestId, getByText, getByPlaceholderText } = render(
      <CommentInput
        onSubmit={mockOnSubmit}
        isAuthenticated
        replyTo={{ id: 'comment-1', username: 'testuser' }}
        onCancelReply={mockOnCancelReply}
      />
    );

    const input = getByTestId('comment-text-input');

    fireEvent.changeText(input, 'draft reply');

    expect(getByPlaceholderText('Reply to @testuser...')).toBeTruthy();
    expect(getByText(/Replying to @testuser/)).toBeTruthy();

    fireEvent.press(getByTestId('cancel-reply'));

    expect(mockOnCancelReply).toHaveBeenCalled();
    expect(input.props.value).toBe('');
  });

  it('locks the input while a submission is pending', () => {
    const { getByTestId } = render(
      <CommentInput isAuthenticated onSubmit={mockOnSubmit} isSubmitting={true} />
    );

    const input = getByTestId('comment-text-input');
    expect(input.props.editable).toBe(false);

    fireEvent.press(getByTestId('comment-send-button'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});

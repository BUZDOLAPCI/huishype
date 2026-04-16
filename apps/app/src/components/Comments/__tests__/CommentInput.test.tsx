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
      <CommentInput onSubmit={mockOnSubmit} placeholder="Custom placeholder" />
    );

    expect(getByPlaceholderText('Custom placeholder')).toBeTruthy();
  });

  it('submits a trimmed comment, clears the draft, and dismisses the keyboard', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, '  Test comment  ');
    fireEvent.press(getByTestId('submit-button'));

    expect(mockOnSubmit).toHaveBeenCalledWith('Test comment');
    expect(input.props.value).toBe('');
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('does not submit when content is only whitespace', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, '   ');
    fireEvent.press(getByTestId('submit-button'));

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('tracks the character count and blocks over-limit submission', () => {
    const { getByTestId, getByText } = render(
      <CommentInput onSubmit={mockOnSubmit} maxLength={10} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'This is a very long comment');
    fireEvent.press(getByTestId('submit-button'));

    expect(getByTestId('character-count').children.join('')).toContain('27/10');
    expect(getByText(/too long/i)).toBeTruthy();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('switches into reply mode and clears the draft when reply is cancelled', () => {
    const { getByTestId, getByText, getByPlaceholderText } = render(
      <CommentInput
        onSubmit={mockOnSubmit}
        replyTo={{ id: 'comment-1', username: 'testuser' }}
        onCancelReply={mockOnCancelReply}
      />
    );

    const input = getByTestId('comment-input');

    fireEvent.changeText(input, 'draft reply');

    expect(getByPlaceholderText('Reply to @testuser...')).toBeTruthy();
    expect(getByTestId('reply-indicator')).toBeTruthy();
    expect(getByText('@testuser')).toBeTruthy();

    fireEvent.press(getByTestId('cancel-reply-button'));

    expect(mockOnCancelReply).toHaveBeenCalled();
    expect(input.props.value).toBe('');
  });

  it('locks the input while a submission is pending', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} isSubmitting={true} />
    );

    const input = getByTestId('comment-input');
    expect(input.props.editable).toBe(false);

    fireEvent.press(getByTestId('submit-button'));
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});

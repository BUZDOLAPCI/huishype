import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CommentInput } from '../CommentInput';

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

describe('CommentInput', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancelReply = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders text input with placeholder', () => {
    const { getByPlaceholderText } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    expect(getByPlaceholderText('Share your thoughts...')).toBeTruthy();
  });

  it('renders custom placeholder', () => {
    const { getByPlaceholderText } = render(
      <CommentInput onSubmit={mockOnSubmit} placeholder="Custom placeholder" />
    );

    expect(getByPlaceholderText('Custom placeholder')).toBeTruthy();
  });

  it('renders character count', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} maxLength={500} />
    );

    expect(getByTestId('character-count')).toBeTruthy();
  });

  it('updates character count as user types', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} maxLength={500} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'Hello world');

    expect(getByTestId('character-count').children.join('')).toContain('11');
  });

  it('renders submit button', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    expect(getByTestId('submit-button')).toBeTruthy();
  });

  it('submit button is disabled when input is empty', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const submitButton = getByTestId('submit-button');
    fireEvent.press(submitButton);

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with content when submit button is pressed', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'Test comment content');

    const submitButton = getByTestId('submit-button');
    fireEvent.press(submitButton);

    expect(mockOnSubmit).toHaveBeenCalledWith('Test comment content');
  });

  it('clears input after successful submit', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'Test comment');
    fireEvent.press(getByTestId('submit-button'));

    // Input should be cleared after submit
    expect(input.props.value).toBe('');
  });

  it('trims whitespace before submitting', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, '  Test comment  ');
    fireEvent.press(getByTestId('submit-button'));

    expect(mockOnSubmit).toHaveBeenCalledWith('Test comment');
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

  it('shows reply indicator when replyTo is set', () => {
    const { getByTestId, getByText } = render(
      <CommentInput
        onSubmit={mockOnSubmit}
        replyTo={{ id: 'comment-1', username: 'testuser' }}
        onCancelReply={mockOnCancelReply}
      />
    );

    expect(getByTestId('reply-indicator')).toBeTruthy();
    expect(getByText('@testuser')).toBeTruthy();
  });

  it('does not show reply indicator when replyTo is null', () => {
    const { queryByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} replyTo={null} />
    );

    expect(queryByTestId('reply-indicator')).toBeNull();
  });

  it('calls onCancelReply when cancel button is pressed', () => {
    const { getByTestId } = render(
      <CommentInput
        onSubmit={mockOnSubmit}
        replyTo={{ id: 'comment-1', username: 'testuser' }}
        onCancelReply={mockOnCancelReply}
      />
    );

    fireEvent.press(getByTestId('cancel-reply-button'));
    expect(mockOnCancelReply).toHaveBeenCalled();
  });

  it('updates placeholder when replying', () => {
    const { getByPlaceholderText } = render(
      <CommentInput
        onSubmit={mockOnSubmit}
        replyTo={{ id: 'comment-1', username: 'testuser' }}
      />
    );

    expect(getByPlaceholderText('Reply to @testuser...')).toBeTruthy();
  });

  it('disables submit when over character limit', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} maxLength={10} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'This is a very long comment that exceeds the limit');
    fireEvent.press(getByTestId('submit-button'));

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows error message when over character limit', () => {
    const { getByTestId, getByText } = render(
      <CommentInput onSubmit={mockOnSubmit} maxLength={10} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'This is a very long comment');

    expect(getByText(/too long/i)).toBeTruthy();
  });

  it('disables input when isSubmitting is true', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} isSubmitting={true} />
    );

    const input = getByTestId('comment-input');
    expect(input.props.editable).toBe(false);
  });

  it('disables submit button when isSubmitting is true', () => {
    const { getByTestId } = render(
      <CommentInput onSubmit={mockOnSubmit} isSubmitting={true} />
    );

    const input = getByTestId('comment-input');
    fireEvent.changeText(input, 'Test comment');
    fireEvent.press(getByTestId('submit-button'));

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });
});

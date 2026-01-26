import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Comment, formatRelativeTime } from '../Comment';

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Mock current date to 2024-01-15 12:00:00
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns minutes ago for timestamps within an hour', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(formatRelativeTime(thirtyMinsAgo)).toBe('30m ago');
  });

  it('returns hours ago for timestamps within a day', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns days ago for timestamps within a week', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });

  it('returns weeks ago for timestamps within a month', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoWeeksAgo)).toBe('2w ago');
  });

  it('returns months ago for timestamps within a year', () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoMonthsAgo)).toBe('2mo ago');
  });

  it('returns years ago for old timestamps', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoYearsAgo)).toBe('2y ago');
  });
});

describe('Comment', () => {
  const mockComment = {
    id: 'comment-1',
    content: 'This is a test comment',
    user: {
      id: 'user-1',
      username: 'testuser',
      displayName: 'Test User',
      profilePhotoUrl: null,
      karma: 50,
    },
    likeCount: 10,
    createdAt: new Date().toISOString(),
    replies: [],
  };

  const mockOnLike = jest.fn();
  const mockOnReply = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders comment content', () => {
    const { getByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('This is a test comment')).toBeTruthy();
  });

  it('renders user display name', () => {
    const { getByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('Test User')).toBeTruthy();
  });

  it('renders username with @ symbol', () => {
    const { getByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('@testuser')).toBeTruthy();
  });

  it('renders username when displayName is null', () => {
    const commentWithoutDisplayName = {
      ...mockComment,
      user: { ...mockComment.user, displayName: null },
    };

    const { getByText } = render(
      <Comment
        comment={commentWithoutDisplayName}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    // When displayName is null, username should be shown as the display name
    expect(getByText('testuser')).toBeTruthy();
  });

  it('renders karma badge', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByTestId('karma-badge')).toBeTruthy();
  });

  it('renders like button', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByTestId('like-button')).toBeTruthy();
  });

  it('renders reply button for base comments', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        isReply={false}
      />
    );

    expect(getByTestId('reply-button')).toBeTruthy();
  });

  it('does not render reply button for replies', () => {
    const { queryByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        isReply={true}
      />
    );

    expect(queryByTestId('reply-button')).toBeNull();
  });

  it('calls onLike when like button is pressed', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    fireEvent.press(getByTestId('like-button'));
    expect(mockOnLike).toHaveBeenCalledWith('comment-1');
  });

  it('calls onReply when reply button is pressed', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    fireEvent.press(getByTestId('reply-button'));
    expect(mockOnReply).toHaveBeenCalledWith('comment-1', 'testuser');
  });

  it('renders like count when greater than 0', () => {
    const { getByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('10')).toBeTruthy();
  });

  it('does not render like count when 0', () => {
    const commentWithNoLikes = { ...mockComment, likeCount: 0 };
    const { queryByText } = render(
      <Comment
        comment={commentWithNoLikes}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    // The "0" should not be rendered
    expect(queryByText('0')).toBeNull();
  });

  it('renders replies nested under parent comment', () => {
    const commentWithReplies = {
      ...mockComment,
      replies: [
        {
          id: 'reply-1',
          content: 'This is a reply',
          user: {
            id: 'user-2',
            username: 'replyuser',
            displayName: 'Reply User',
            profilePhotoUrl: null,
            karma: 25,
          },
          likeCount: 5,
          createdAt: new Date().toISOString(),
          replies: [],
        },
      ],
    };

    const { getByText, getAllByTestId } = render(
      <Comment
        comment={commentWithReplies}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('This is a reply')).toBeTruthy();
    // Should have both parent comment and reply
    expect(getAllByTestId('karma-badge').length).toBe(2);
  });

  it('renders user avatar', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByTestId('user-avatar')).toBeTruthy();
  });
});

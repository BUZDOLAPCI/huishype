import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Comment, formatRelativeTime } from '../Comment';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
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
    userId: 'user-1',
    content: 'This is a test comment',
    user: {
      id: 'user-1',
      username: 'testuser',
      displayName: 'Test User',
      profilePhotoUrl: null,
      karma: 50,
    },
    likeCount: 10,
    isLiked: false,
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

  it('shows the action menu only after long-pressing a comment', () => {
    const onReport = jest.fn();
    const { getByTestId, queryByTestId, queryByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={onReport}
      />
    );

    expect(queryByTestId('comment-action-menu')).toBeNull();
    expect(queryByTestId('comment-report-menu-item')).toBeNull();

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');

    expect(getByTestId('comment-action-menu')).toBeTruthy();
    expect(getByTestId('comment-report-menu-item')).toBeTruthy();
    expect(getByTestId('comment-copy-menu-item')).toBeTruthy();
    expect(queryByText('Translate')).toBeNull();
  });

  it('shows and confirms delete for the current user comment', () => {
    const onDelete = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
        onDelete={onDelete}
        currentUserId="user-1"
      />
    );

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');
    expect(getByTestId('comment-delete-menu-item')).toBeTruthy();
    fireEvent.press(getByTestId('comment-delete-menu-item'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((button) => button.text === 'Delete')?.onPress?.();

    expect(onDelete).toHaveBeenCalledWith('comment-1');
    alertSpy.mockRestore();
  });

  it('does not show delete for another user comment', () => {
    const { getByTestId, queryByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
        onDelete={jest.fn()}
        currentUserId="user-2"
      />
    );

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');

    expect(queryByTestId('comment-delete-menu-item')).toBeNull();
  });

  it('reports from the long-press menu and closes the menu', () => {
    const onReport = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={onReport}
      />
    );

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');
    fireEvent.press(getByTestId('comment-report-menu-item'));

    expect(onReport).toHaveBeenCalledWith('comment-1');
    expect(queryByTestId('comment-action-menu')).toBeNull();
  });

  it('copies the comment text from the long-press menu and closes the menu', async () => {
    const { getByTestId, queryByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
      />
    );

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');
    await act(async () => {
      fireEvent.press(getByTestId('comment-copy-menu-item'));
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('This is a test comment');
    await waitFor(() => {
      expect(queryByTestId('comment-action-menu')).toBeNull();
    });
  });

  it('closes the long-press menu when the backdrop is pressed', () => {
    const { getByTestId, queryByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
      />
    );

    fireEvent(getByTestId('comment-long-press-target'), 'longPress');
    fireEvent.press(getByTestId('comment-action-menu-backdrop'));

    expect(queryByTestId('comment-action-menu')).toBeNull();
  });

  it('does not expose a visible report button without long press', () => {
    const { queryByText } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
      />
    );

    expect(queryByText('Report')).toBeNull();
  });

  it('renders deleted comments as tombstones with visible replies and no parent actions', () => {
    const { getByText, queryByText, queryByTestId, getAllByTestId } = render(
      <Comment
        comment={{
          ...mockComment,
          userId: null,
          user: null,
          isDeleted: true,
          content: '',
          likeCount: 0,
          replies: [
            {
              id: 'reply-1',
              userId: 'user-2',
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
        }}
        onLike={mockOnLike}
        onReply={mockOnReply}
        onReport={jest.fn()}
        onDelete={jest.fn()}
        currentUserId="user-1"
      />
    );

    expect(getByText('Deleted comment')).toBeTruthy();
    expect(queryByText('Test User')).toBeNull();
    expect(getByText('This is a reply')).toBeTruthy();
    expect(getAllByTestId('like-button')).toHaveLength(1);
    expect(queryByTestId('comment-action-menu')).toBeNull();
  });

  it('navigates to the author profile when the avatar is pressed', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    fireEvent.press(getByTestId('comment-author-avatar-button'));
    expect(router.push).toHaveBeenCalledWith('/user/@testuser');
  });

  it('navigates to the author profile when the name block is pressed', () => {
    const { getByTestId } = render(
      <Comment
        comment={mockComment}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    fireEvent.press(getByTestId('comment-author-button'));
    expect(router.push).toHaveBeenCalledWith('/user/@testuser');
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

  it('renders the liked state from comment data', () => {
    const { getByLabelText } = render(
      <Comment
        comment={{ ...mockComment, isLiked: true }}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByLabelText('Unlike comment')).toBeTruthy();
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

    const { getByText } = render(
      <Comment
        comment={commentWithReplies}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByText('This is a reply')).toBeTruthy();
    expect(getByText('Reply User')).toBeTruthy();
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

  it('keeps reply avatars smaller than top-level avatars', () => {
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

    const { getAllByTestId } = render(
      <Comment
        comment={commentWithReplies}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    const [parentAvatar, replyAvatar] = getAllByTestId('user-avatar');
    const getWidth = (style: unknown) => {
      const entries = Array.isArray(style) ? style : [style];
      const widthEntry = entries.find(
        (entry): entry is { width?: number } =>
          !!entry && typeof entry === 'object' && 'width' in entry,
      );
      return widthEntry?.width;
    };

    expect(getWidth(parentAvatar.props.style)).toBe(32);
    expect(getWidth(replyAvatar.props.style)).toBe(28);
  });

  it('passes profilePhotoUrl through to the shared avatar component', () => {
    const commentWithPhoto = {
      ...mockComment,
      user: {
        ...mockComment.user,
        profilePhotoUrl: 'https://example.com/avatar.jpg',
      },
    };

    const { getByTestId } = render(
      <Comment
        comment={commentWithPhoto}
        onLike={mockOnLike}
        onReply={mockOnReply}
      />
    );

    expect(getByTestId('user-avatar').props.source).toEqual({
      uri: 'https://example.com/avatar.jpg',
    });
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { CommentCell, type CommentData } from '../CommentCell';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Alert: {
      alert: jest.fn(),
    },
  };
});

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

const mockComment: CommentData = {
  id: 'comment-1',
  userId: 'user-1',
  authorId: 'user-1',
  author: 'MarcoV',
  authorDisplayName: 'Marco V.',
  authorProfilePhotoUrl: null,
  authorKarma: 120,
  content: 'The renovation potential here is incredible.',
  likeCount: 12,
  isLiked: false,
  createdAt: '2h ago',
  replies: [
    {
      id: 'reply-1',
      userId: 'user-2',
      authorId: 'user-2',
      author: 'SophieK',
      authorDisplayName: 'Sophie K.',
      authorProfilePhotoUrl: null,
      authorKarma: 50,
      content: 'Agreed! The garden is a huge plus.',
      likeCount: 4,
      isLiked: false,
      createdAt: '1h ago',
    },
  ],
  replyCount: 1,
};

describe('CommentCell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders author name', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByText('Marco V.')).toBeTruthy();
  });

  it('renders comment content', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByText('The renovation potential here is incredible.')).toBeTruthy();
  });

  it('renders timestamp', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByText('2h ago')).toBeTruthy();
  });

  it('renders like count', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('does not render like count when 0', () => {
    render(
      <CommentCell comment={{ ...mockComment, likeCount: 0 }} />
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('calls onLike when like button pressed', () => {
    const onLike = jest.fn();
    render(<CommentCell comment={mockComment} onLike={onLike} />);
    fireEvent.press(screen.getByTestId('comment-like-button'));
    expect(onLike).toHaveBeenCalledWith('comment-1');
  });

  it('renders Reply button on top-level comments', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByTestId('comment-reply-button')).toBeTruthy();
  });

  it('does not render Reply button on reply comments', () => {
    render(<CommentCell comment={mockComment} isReply />);
    expect(screen.queryByTestId('comment-reply-button')).toBeNull();
  });

  it('calls onReply when Reply button pressed', () => {
    const onReply = jest.fn();
    render(<CommentCell comment={mockComment} onReply={onReply} />);
    fireEvent.press(screen.getByTestId('comment-reply-button'));
    expect(onReply).toHaveBeenCalledWith('comment-1');
  });

  it('shows the action menu only after long-pressing a comment', () => {
    const onReport = jest.fn();
    render(<CommentCell comment={mockComment} onReport={onReport} />);

    expect(screen.queryByTestId('comment-action-menu')).toBeNull();
    expect(screen.queryByTestId('comment-report-menu-item')).toBeNull();

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');

    expect(screen.getByTestId('comment-action-menu')).toBeTruthy();
    expect(screen.getByTestId('comment-report-menu-item')).toBeTruthy();
    expect(screen.getByTestId('comment-copy-menu-item')).toBeTruthy();
    expect(screen.queryByTestId('comment-delete-menu-item')).toBeNull();
    expect(screen.queryByText('Translate')).toBeNull();
  });

  it('shows delete between report and copy for the current user comment', () => {
    render(
      <CommentCell
        comment={mockComment}
        currentUserId="user-1"
        onReport={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');

    const menu = screen.getByTestId('comment-action-menu');
    expect(screen.getByTestId('comment-report-menu-item')).toBeTruthy();
    expect(screen.getByTestId('comment-delete-menu-item')).toBeTruthy();
    expect(screen.getByTestId('comment-copy-menu-item')).toBeTruthy();
    expect(
      menu.findAllByType(Text)
        .map((item: { props: { children: unknown } }) => item.props.children)
        .filter((label: unknown): label is string =>
          typeof label === 'string' && ['Report', 'Delete', 'Copy'].includes(label)
        ),
    ).toEqual(['Report', 'Delete', 'Copy']);
  });

  it('does not show delete for another user comment', () => {
    render(
      <CommentCell
        comment={mockComment}
        currentUserId="user-2"
        onReport={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');

    expect(screen.getByTestId('comment-action-menu')).toBeTruthy();
    expect(screen.queryByTestId('comment-delete-menu-item')).toBeNull();
  });

  it('confirms before deleting the current user comment', () => {
    const onDelete = jest.fn();
    render(
      <CommentCell
        comment={mockComment}
        currentUserId="user-1"
        onReport={jest.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');
    fireEvent.press(screen.getByTestId('comment-delete-menu-item'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete comment?',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    buttons[1].onPress();
    expect(onDelete).toHaveBeenCalledWith('comment-1');
  });

  it('reports from the long-press menu and closes the menu', () => {
    const onReport = jest.fn();
    render(<CommentCell comment={mockComment} onReport={onReport} />);

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');
    fireEvent.press(screen.getByTestId('comment-report-menu-item'));

    expect(onReport).toHaveBeenCalledWith('comment-1');
    expect(screen.queryByTestId('comment-action-menu')).toBeNull();
  });

  it('copies the comment text from the long-press menu and closes the menu', async () => {
    const { queryByTestId } = render(<CommentCell comment={mockComment} onReport={jest.fn()} />);

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');
    await act(async () => {
      fireEvent.press(screen.getByTestId('comment-copy-menu-item'));
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      'The renovation potential here is incredible.',
    );
    await waitFor(() => {
      expect(queryByTestId('comment-action-menu')).toBeNull();
    });
  });

  it('closes the long-press menu when the backdrop is pressed', () => {
    render(<CommentCell comment={mockComment} onReport={jest.fn()} />);

    fireEvent(screen.getByTestId('comment-cell'), 'longPress');
    fireEvent.press(screen.getByTestId('comment-action-menu-backdrop'));

    expect(screen.queryByTestId('comment-action-menu')).toBeNull();
  });

  it('does not expose a visible report button without long press', () => {
    render(<CommentCell comment={mockComment} onReport={jest.fn()} />);

    expect(screen.queryByText('Report')).toBeNull();
  });

  it('renders a deleted parent as a placeholder without actions and keeps replies visible', () => {
    render(
      <CommentCell
        comment={{
          ...mockComment,
          userId: null,
          authorId: undefined,
          isDeleted: true,
          content: '',
          likeCount: 0,
        }}
        currentUserId="user-1"
        onLike={jest.fn()}
        onReply={jest.fn()}
        onDelete={jest.fn()}
        onReport={jest.fn()}
      />
    );

    expect(screen.getByTestId('deleted-comment-placeholder')).toBeTruthy();
    expect(screen.getByText('Deleted comment')).toBeTruthy();
    expect(screen.queryByText('Marco V.')).toBeNull();
    expect(screen.getByText('Sophie K.')).toBeTruthy();
    expect(screen.queryByTestId('comment-reply-button')).toBeNull();
    expect(screen.queryByTestId('comment-action-menu')).toBeNull();
    expect(screen.getByText('Agreed! The garden is a huge plus.')).toBeTruthy();
    expect(screen.getAllByTestId('comment-like-button')).toHaveLength(1);
  });

  it('navigates to the author profile when avatar is pressed', () => {
    render(<CommentCell comment={mockComment} />);
    fireEvent.press(screen.getByTestId('comment-author-avatar-button'));
    expect(router.push).toHaveBeenCalledWith('/user/user-1');
  });

  it('navigates to the author profile when name is pressed', () => {
    render(<CommentCell comment={mockComment} />);
    fireEvent.press(screen.getByTestId('comment-author-button'));
    expect(router.push).toHaveBeenCalledWith('/user/user-1');
  });

  it('shows "View 1 reply" toggle when replies exist', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByTestId('view-replies-button')).toBeTruthy();
    expect(screen.getByText('View 1 reply')).toBeTruthy();
  });

  it('pluralizes reply count correctly', () => {
    const withManyReplies: CommentData = {
      ...mockComment,
      replies: [
        ...(mockComment.replies ?? []),
        {
          id: 'reply-2',
          authorId: 'user-3',
          author: 'JanV',
          authorProfilePhotoUrl: null,
          authorKarma: 30,
          content: 'Second reply.',
          likeCount: 0,
          createdAt: '30m ago',
        },
      ],
      replyCount: 2,
    };
    render(<CommentCell comment={withManyReplies} />);
    expect(screen.getByText('View 2 replies')).toBeTruthy();
  });

  it('does not show reply toggle when no replies', () => {
    const noReplies: CommentData = {
      ...mockComment,
      replies: [],
      replyCount: 0,
    };
    render(<CommentCell comment={noReplies} />);
    expect(screen.queryByTestId('view-replies-button')).toBeNull();
  });

  it('expands replies when toggle is pressed', () => {
    render(<CommentCell comment={mockComment} />);
    fireEvent.press(screen.getByTestId('view-replies-button'));
    expect(screen.getByText('Agreed! The garden is a huge plus.')).toBeTruthy();
  });

  it('uses compact variant without reply functionality', () => {
    render(<CommentCell comment={mockComment} variant="compact" />);
    // In compact variant, no Reply button
    expect(screen.queryByTestId('comment-reply-button')).toBeNull();
    // No view replies toggle
    expect(screen.queryByTestId('view-replies-button')).toBeNull();
  });

  it('falls back to username when no display name', () => {
    const noDisplayName: CommentData = {
      ...mockComment,
      authorDisplayName: undefined,
    };
    render(<CommentCell comment={noDisplayName} />);
    expect(screen.getByText('MarcoV')).toBeTruthy();
  });

  it('renders reply liked state from likedCommentIds prop', () => {
    const likedIds = new Set(['reply-1']);
    render(
      <CommentCell
        comment={mockComment}
        likedCommentIds={likedIds}
        onLike={jest.fn()}
      />
    );
    // Expand replies
    fireEvent.press(screen.getByTestId('view-replies-button'));
    // The reply's like button should show 'Unlike' (liked state)
    const likeButtons = screen.getAllByTestId('comment-like-button');
    // First is parent (not liked), second is reply (liked)
    expect(likeButtons[0]).toHaveAccessibilityValue({});
    expect(likeButtons[1].props.accessibilityLabel).toBe('Unlike');
  });

  it('calls onLike with the reply id when an expanded reply heart is pressed', () => {
    const onLike = jest.fn();
    render(<CommentCell comment={mockComment} onLike={onLike} />);

    fireEvent.press(screen.getByTestId('view-replies-button'));
    fireEvent.press(screen.getAllByTestId('comment-like-button')[1]);

    expect(onLike).toHaveBeenCalledWith('reply-1');
  });

  it('renders parent liked state from likedCommentIds prop', () => {
    const likedIds = new Set(['comment-1']);
    render(
      <CommentCell
        comment={mockComment}
        likedCommentIds={likedIds}
        onLike={jest.fn()}
      />
    );
    const likeButton = screen.getAllByTestId('comment-like-button')[0];
    expect(likeButton.props.accessibilityLabel).toBe('Unlike');
  });

  it('uses comment.isLiked when likedCommentIds not provided', () => {
    const likedComment: CommentData = {
      ...mockComment,
      isLiked: true,
    };
    render(<CommentCell comment={likedComment} onLike={jest.fn()} />);
    const likeButton = screen.getAllByTestId('comment-like-button')[0];
    expect(likeButton.props.accessibilityLabel).toBe('Unlike');
  });
});

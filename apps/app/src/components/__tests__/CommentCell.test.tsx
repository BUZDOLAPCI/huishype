import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CommentCell, type CommentData } from '../CommentCell';

const mockComment: CommentData = {
  id: 'comment-1',
  author: 'MarcoV',
  authorDisplayName: 'Marco V.',
  authorKarma: 120,
  content: 'The renovation potential here is incredible.',
  likeCount: 12,
  isLiked: false,
  createdAt: '2h ago',
  replies: [
    {
      id: 'reply-1',
      author: 'SophieK',
      authorDisplayName: 'Sophie K.',
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
  it('renders author name and karma badge', () => {
    render(<CommentCell comment={mockComment} />);
    expect(screen.getByText('Marco V.')).toBeTruthy();
    expect(screen.getByTestId('karma-badge')).toBeTruthy();
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
          author: 'JanV',
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
});

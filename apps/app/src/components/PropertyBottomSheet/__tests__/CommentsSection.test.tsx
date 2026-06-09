import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CommentsSection } from '../CommentsSection';
import type { PropertyDetailsData } from '../types';

const mockUseComments = jest.fn();
const mockUseAuthContext = jest.fn();
const mockSubmitMutate = jest.fn();
const mockLikeMutate = jest.fn();
const mockDeleteMutate = jest.fn();

jest.mock('../../../hooks/useComments', () => ({
  useComments: (...args: unknown[]) => mockUseComments(...args),
  useSubmitComment: () => ({
    mutate: mockSubmitMutate,
    isPending: false,
  }),
  useLikeComment: () => ({
    mutate: mockLikeMutate,
  }),
  useDeleteComment: () => ({
    mutate: mockDeleteMutate,
  }),
}));

jest.mock('../../../providers/AuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

jest.mock('../SectionCard', () => ({
  SectionCard: ({ children, title, description, trailing }: {
    children: React.ReactNode;
    title?: string;
    description?: string;
    trailing?: React.ReactNode;
  }) => {
    const React = require('react');
    const { Text, View } = require('react-native');
    return (
      <View>
        {title ? <Text>{title}</Text> : null}
        {description ? <Text>{description}</Text> : null}
        {trailing}
        {children}
      </View>
    );
  },
}));

jest.mock('../../Comments', () => ({
  CommentInput: ({
    onSubmit,
    replyTo,
    onCancelReply,
  }: {
    onSubmit: (content: string) => void;
    replyTo?: { id: string; username: string } | null;
    onCancelReply?: () => void;
  }) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    return (
      <View>
        <Text>Comment input</Text>
        {replyTo ? <Text>Replying to @{replyTo.username}</Text> : null}
        <Pressable testID="mock-comment-input-submit" onPress={() => onSubmit('Draft comment')}>
          <Text>Submit draft</Text>
        </Pressable>
        <Pressable testID="mock-comment-input-cancel" onPress={onCancelReply}>
          <Text>Cancel reply</Text>
        </Pressable>
      </View>
    );
  },
  CommentSortToggle: () => {
    const React = require('react');
    const { Text, View } = require('react-native');
    return (
      <View>
        <Text>Popular</Text>
        <Text>Recent</Text>
      </View>
    );
  },
}));

jest.mock('../../CommentCell', () => ({
  CommentCell: ({
    comment,
    onLike,
    onReply,
    onDelete,
    currentUserId,
  }: {
    comment: { id: string; content: string };
    onLike: (commentId: string) => void;
    onReply: (commentId: string) => void;
    onDelete?: (commentId: string) => void;
    currentUserId?: string | null;
  }) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    return (
      <View testID="comment-cell">
        <Text>{comment.content}</Text>
        <Pressable testID={`comment-like-${comment.id}`} onPress={() => onLike(comment.id)}>
          <Text>Like</Text>
        </Pressable>
        <Pressable testID={`comment-reply-${comment.id}`} onPress={() => onReply(comment.id)}>
          <Text>Reply</Text>
        </Pressable>
        <Text testID={`comment-current-user-${comment.id}`}>{currentUserId ?? ''}</Text>
        <Pressable testID={`comment-delete-${comment.id}`} onPress={() => onDelete?.(comment.id)}>
          <Text>Delete</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('../../ReportModal', () => ({
  ReportModal: () => null,
}));

const property: PropertyDetailsData = {
  id: 'property-123',
  nationalId: null,
  countryCode: 'NL',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: null,
  yearBuilt: 1998,
  floorAreaM2: 112,
  status: 'active',
  officialValuation: 350000,
  askingPrice: 365000,
  marketState: 'for-sale',
  activityLevel: 'warm',
  commentCount: 2,
  guessCount: 0,
  viewCount: 0,
  likeCount: 0,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function collectText(node: unknown): string[] {
  if (node === null || typeof node !== 'object') {
    return [];
  }

  const children = (node as { children?: unknown[] }).children ?? [];
  return children.flatMap((child) => {
    if (typeof child === 'string') {
      return [child];
    }

    return collectText(child);
  });
}

describe('CommentsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthContext.mockReturnValue({ isAuthenticated: false });
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [],
            meta: { total: 2 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });
  });

  it('defaults to popular comments and renders Popular before Recent', () => {
    const screen = render(<CommentsSection property={property} />);

    expect(mockUseComments).toHaveBeenCalledWith('property-123', 'popular');

    const texts = collectText(screen.toJSON());
    expect(texts.indexOf('Popular')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Recent')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Popular')).toBeLessThan(texts.indexOf('Recent'));
  });

  it('renders the comment count title, shared cells, and preview view-all action', () => {
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              makeComment('comment-1', 'First comment'),
              makeComment('comment-2', 'Second comment'),
              makeComment('comment-3', 'Third comment'),
              makeComment('comment-4', 'Fourth comment'),
            ],
            meta: { total: 4 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(<CommentsSection property={property} onViewAll={jest.fn()} />);

    expect(screen.getByText('Comments')).toBeTruthy();
    expect(screen.getByText('Read the neighborhood takes and add your own perspective on the address.')).toBeTruthy();
    expect(screen.getByText('4 comments')).toBeTruthy();
    expect(screen.getAllByTestId('comment-cell')).toHaveLength(3);
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.queryByText('Fourth comment')).toBeNull();
    expect(screen.getByText('View all 4 comments')).toBeTruthy();
  });

  it('uses the view-all callback instead of expanding the preview when provided', () => {
    const onViewAll = jest.fn();
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              makeComment('comment-1', 'First comment'),
              makeComment('comment-2', 'Second comment'),
              makeComment('comment-3', 'Third comment'),
              makeComment('comment-4', 'Fourth comment'),
            ],
            meta: { total: 4 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(<CommentsSection property={property} onViewAll={onViewAll} />);

    fireEvent.press(screen.getByText('View all 4 comments'));

    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Fourth comment')).toBeNull();
  });

  it('likes preview comments using the fetched liked state', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'viewer-1', username: 'viewer' },
    });
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                ...makeComment('comment-1', 'Liked comment'),
                isLiked: true,
                likeCount: 3,
              },
            ],
            meta: { total: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(<CommentsSection property={property} />);

    fireEvent.press(screen.getByTestId('comment-like-comment-1'));

    expect(mockLikeMutate).toHaveBeenCalledWith({
      commentId: 'comment-1',
      isCurrentlyLiked: true,
    });
  });

  it('passes current user and deletes preview comments through the delete hook', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'user-comment-1', username: 'viewer' },
    });
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [makeComment('comment-1', 'Owned comment')],
            meta: { total: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(<CommentsSection property={property} />);

    expect(screen.getByTestId('comment-current-user-comment-1').props.children).toBe(
      'user-comment-1',
    );

    fireEvent.press(screen.getByTestId('comment-delete-comment-1'));

    expect(mockDeleteMutate).toHaveBeenCalledWith(
      'comment-1',
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('opens reply mode and submits preview replies with the parent id', async () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'viewer-1', username: 'viewer' },
    });
    mockSubmitMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.();
    });
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [makeComment('comment-1', 'Parent comment')],
            meta: { total: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(<CommentsSection property={property} />);

    fireEvent.press(screen.getByTestId('comment-reply-comment-1'));

    expect(screen.getByText('Replying to @usercomment-1')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mock-comment-input-submit'));

    expect(mockSubmitMutate).toHaveBeenCalledWith(
      { content: 'Draft comment', parentId: 'comment-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Replying to @usercomment-1')).toBeNull();
    });
  });

  it('gates preview like and reply actions for signed-out users', () => {
    const onAuthRequired = jest.fn();
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [makeComment('comment-1', 'Signed out comment')],
            meta: { total: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const screen = render(
      <CommentsSection property={property} onAuthRequired={onAuthRequired} />
    );

    fireEvent.press(screen.getByTestId('comment-like-comment-1'));
    fireEvent.press(screen.getByTestId('comment-reply-comment-1'));

    expect(mockLikeMutate).not.toHaveBeenCalled();
    expect(mockSubmitMutate).not.toHaveBeenCalled();
    expect(onAuthRequired).toHaveBeenCalledTimes(2);
  });
});

function makeComment(id: string, content: string) {
  return {
    id,
    propertyId: 'property-123',
    userId: `user-${id}`,
    parentId: null,
    content,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    user: {
      id: `user-${id}`,
      username: `user${id}`,
      displayName: `User ${id}`,
      profilePhotoUrl: null,
      karma: 1,
    },
    likeCount: 0,
    isLiked: false,
    replies: [],
  };
}

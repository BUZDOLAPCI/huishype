import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CommentsRouteScreen } from '../CommentsRouteScreen';
import type { Comment } from '@/src/hooks/useComments';

const mockUseProperty = jest.fn();
const mockUseComments = jest.fn();
const mockSubmitMutate = jest.fn();
const mockLikeMutate = jest.fn();
const mockUseAuthContext = jest.fn();

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissTo: jest.fn(),
    canDismiss: () => false,
    canGoBack: () => false,
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/hooks/useIsLandscape', () => ({
  useIsLandscape: () => false,
}));

jest.mock('@/src/hooks/useHydratedNow', () => ({
  useHydratedNow: () => new Date('2024-01-01T01:00:00Z').getTime(),
}));

jest.mock('@/src/hooks/useProperties', () => ({
  useProperty: (...args: unknown[]) => mockUseProperty(...args),
}));

jest.mock('@/src/hooks/useComments', () => ({
  useComments: (...args: unknown[]) => mockUseComments(...args),
  useSubmitComment: () => ({
    mutate: mockSubmitMutate,
    isPending: false,
  }),
  useLikeComment: () => ({
    mutate: mockLikeMutate,
  }),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

jest.mock('@/src/components/ui/ResponsivePanel', () => ({
  ResponsivePanel: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/src/components/PropertyImageSurface', () => ({
  PropertyImageSurface: () => null,
}));

jest.mock('@/src/components', () => ({
  AuthModal: ({ visible }: { visible: boolean }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return visible ? <Text>Auth Modal Open</Text> : null;
  },
}));

jest.mock('@/src/components/ReportModal', () => ({
  ReportModal: () => null,
}));

jest.mock('@/src/components/Comments', () => ({
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

const property = {
  id: 'property-123',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  commentsDisabled: false,
};

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    propertyId: 'property-123',
    userId: 'user-1',
    parentId: null,
    content: 'A useful neighborhood comment',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    user: {
      id: 'user-1',
      username: 'parentuser',
      displayName: 'Parent User',
      profilePhotoUrl: null,
      karma: 12,
    },
    likeCount: 7,
    isLiked: true,
    replies: [],
    ...overrides,
  };
}

function mockComments(comments: Comment[]) {
  mockUseComments.mockReturnValue({
    data: {
      pages: [
        {
          data: comments,
          meta: {
            page: 1,
            limit: 20,
            total: comments.length,
            totalPages: 1,
          },
        },
      ],
    },
    isLoading: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
}

describe('CommentsRouteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProperty.mockReturnValue({ data: property });
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'viewer-1', username: 'viewer' },
    });
    mockComments([makeComment()]);
    mockSubmitMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.();
    });
  });

  it('uses fetched liked state when toggling a liked comment', () => {
    const screen = render(<CommentsRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getAllByTestId('comment-like-button')[0]);

    expect(mockLikeMutate).toHaveBeenCalledWith({
      commentId: 'comment-1',
      isCurrentlyLiked: true,
    });
  });

  it('opens reply mode and submits replies with the parent comment id', async () => {
    const screen = render(<CommentsRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('comment-reply-button'));

    expect(screen.getByText(/Replying to @parentuser/)).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('comment-text-input'), '  Reply draft  ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(mockSubmitMutate).toHaveBeenCalledWith(
      { content: 'Reply draft', parentId: 'comment-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    await waitFor(() => {
      expect(screen.queryByText(/Replying to @parentuser/)).toBeNull();
    });
  });

  it('keeps threaded replies expandable on the dedicated page', () => {
    mockComments([
      makeComment({
        replies: [
          makeComment({
            id: 'reply-1',
            userId: 'user-2',
            parentId: 'comment-1',
            content: 'Nested reply content',
            user: {
              id: 'user-2',
              username: 'replyuser',
              displayName: 'Reply User',
              profilePhotoUrl: null,
              karma: 4,
            },
            likeCount: 0,
            isLiked: false,
            replies: [],
          }),
        ],
      }),
    ]);

    const screen = render(<CommentsRouteScreen propertyId="property-123" />);

    expect(screen.getByText('View 1 reply')).toBeTruthy();

    fireEvent.press(screen.getByTestId('view-replies-button'));

    expect(screen.getByText('Nested reply content')).toBeTruthy();
  });

  it('gates likes for signed-out users', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: false,
      user: null,
    });

    const screen = render(<CommentsRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getAllByTestId('comment-like-button')[0]);

    expect(mockLikeMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Auth Modal Open')).toBeTruthy();
  });

  it('lets signed-out users draft a comment before auth on submit', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: false,
      user: null,
    });

    const screen = render(<CommentsRouteScreen propertyId="property-123" />);
    const input = screen.getByTestId('comment-text-input');

    fireEvent.changeText(input, '  Auth gated draft  ');
    fireEvent.press(screen.getByTestId('comment-send-button'));

    expect(mockSubmitMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Auth Modal Open')).toBeTruthy();
    expect(input.props.value).toBe('  Auth gated draft  ');
  });
});

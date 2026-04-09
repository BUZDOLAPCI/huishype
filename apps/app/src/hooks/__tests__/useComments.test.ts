import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { commentKeys, useLikeComment, type Comment } from '../useComments';

const mockUser = { id: 'user-123', email: 'test@test.com', displayName: 'Test User' };
let mockAuthUser: typeof mockUser | null = mockUser;
let mockAccessToken: string | null = 'mock-token';

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAccessToken,
    isLoading: false,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    signOut: jest.fn(),
    getAccessToken: jest.fn(),
    refreshAuth: jest.fn(),
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function seedCommentsQuery(queryClient: QueryClient, comments: Comment[]) {
  queryClient.setQueryData(
    commentKeys.list('property-123', 'recent', mockAuthUser?.id ?? 'anonymous'),
    {
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
      pageParams: [1],
    }
  );
}

function getCommentFromCache(queryClient: QueryClient, commentId: string) {
  const data = queryClient.getQueryData<{
    pages: Array<{ data: Comment[] }>;
  }>(commentKeys.list('property-123', 'recent', mockAuthUser?.id ?? 'anonymous'));

  const comments = data?.pages.flatMap((page) => page.data) ?? [];
  return comments.find((comment) => comment.id === commentId)
    ?? comments.flatMap((comment) => comment.replies).find((reply) => reply.id === commentId);
}

describe('useLikeComment', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockAccessToken = 'mock-token';
    mockFetch.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('likes a comment without sending an empty JSON content type header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: true, likeCount: 3 }),
    });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-1',
        isCurrentlyLiked: false,
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/comments/comment-1/like',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer mock-token' },
        })
      );
    });
  });

  it('unlikes a comment without sending an empty JSON content type header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: false, likeCount: 2 }),
    });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-2',
        isCurrentlyLiked: true,
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/comments/comment-2/like',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer mock-token' },
        })
      );
    });
  });

  it('omits headers entirely when no access token is available', async () => {
    mockAccessToken = null;
    mockAuthUser = null;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: true, likeCount: 1 }),
    });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-3',
        isCurrentlyLiked: false,
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/comments/comment-3/like',
        expect.objectContaining({
          method: 'POST',
          headers: {},
        })
      );
    });
  });

  it('updates the cached comment state from the authoritative like response', async () => {
    seedCommentsQuery(queryClient, [
      {
        id: 'comment-4',
        propertyId: 'property-123',
        userId: 'user-2',
        parentId: null,
        content: 'Cache me',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        user: {
          id: 'user-2',
          username: 'cacheuser',
          displayName: 'Cache User',
          profilePhotoUrl: null,
          karma: 10,
        },
        likeCount: 2,
        isLiked: false,
        replies: [],
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: true, likeCount: 3 }),
    });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-4',
        isCurrentlyLiked: false,
      });
    });

    await waitFor(() => {
      expect(getCommentFromCache(queryClient, 'comment-4')).toMatchObject({
        isLiked: true,
        likeCount: 3,
      });
    });
  });

  it('reconciles a stale POST 409 by loading the authoritative like state', async () => {
    seedCommentsQuery(queryClient, [
      {
        id: 'comment-5',
        propertyId: 'property-123',
        userId: 'user-2',
        parentId: null,
        content: 'Already liked on server',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        user: {
          id: 'user-2',
          username: 'cacheuser',
          displayName: 'Cache User',
          profilePhotoUrl: null,
          karma: 10,
        },
        likeCount: 0,
        isLiked: false,
        replies: [],
      },
    ]);

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'ALREADY_LIKED', message: 'Already liked' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ liked: true, likeCount: 4 }),
      });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-5',
        isCurrentlyLiked: false,
      });
    });

    await waitFor(() => {
      expect(getCommentFromCache(queryClient, 'comment-5')).toMatchObject({
        isLiked: true,
        likeCount: 4,
      });
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3100/comments/comment-5/like',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mock-token' },
      })
    );
  });

  it('reconciles a stale DELETE 404 by loading the authoritative unlike state', async () => {
    seedCommentsQuery(queryClient, [
      {
        id: 'comment-6',
        propertyId: 'property-123',
        userId: 'user-2',
        parentId: null,
        content: 'Already unliked on server',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        user: {
          id: 'user-2',
          username: 'cacheuser',
          displayName: 'Cache User',
          profilePhotoUrl: null,
          karma: 10,
        },
        likeCount: 5,
        isLiked: true,
        replies: [],
      },
    ]);

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'NOT_FOUND', message: 'Not liked' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ liked: false, likeCount: 2 }),
      });

    const { result } = renderHook(() => useLikeComment('property-123'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        commentId: 'comment-6',
        isCurrentlyLiked: true,
      });
    });

    await waitFor(() => {
      expect(getCommentFromCache(queryClient, 'comment-6')).toMatchObject({
        isLiked: false,
        likeCount: 2,
      });
    });
  });
});

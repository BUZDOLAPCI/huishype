import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useLikeComment } from '../useComments';

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
});

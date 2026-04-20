import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import {
  useFollowers,
  useFollowing,
  useFollowUser,
  usePublicProfile,
  useUnfollowUser,
  userKeys,
} from '../useUserProfile';
import { activityFeedKeys } from '../useActivityFeed';
import { propertyKeys } from '../useProperties';

const mockFetch = jest.fn();
const mockGetAccessToken = jest.fn();
const mockUser = {
  id: 'viewer-1',
  email: 'viewer@example.com',
  displayName: 'Viewer',
};

let mockAuthUser: typeof mockUser | null = mockUser;
let mockAccessToken: string | null = 'viewer-token';

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAccessToken,
    isLoading: false,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: mockGetAccessToken,
  }),
}));

jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
}));

global.fetch = mockFetch;

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
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function makeFollowListItem(id: string) {
  return {
    id,
    displayName: `User ${id}`,
    handle: `user-${id}`,
    profilePhotoUrl: null,
    followedAt: '2026-04-19T10:00:00.000Z',
    relationship: 'following' as const,
  };
}

describe('useUserProfile follow surfaces', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockAccessToken = null;
    mockGetAccessToken.mockResolvedValue('viewer-token');
    mockFetch.mockReset();
    (globalThis as typeof globalThis & { __HUISHYPE_ANALYTICS_EVENTS__?: unknown[] })
      .__HUISHYPE_ANALYTICS_EVENTS__ = [];
  });

  afterEach(() => {
    queryClient.clear();
    delete (
      globalThis as typeof globalThis & { __HUISHYPE_ANALYTICS_EVENTS__?: unknown[] }
    ).__HUISHYPE_ANALYTICS_EVENTS__;
  });

  it('sends auth on public-profile reads when a viewer token exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'target-user',
        displayName: 'Target User',
        handle: 'target-user',
        profilePhotoUrl: null,
        homeCountry: 'NL',
        karma: 10,
        karmaRank: { title: 'Contributor', level: 2 },
        guessCount: 2,
        commentCount: 3,
        joinedAt: '2026-01-01T00:00:00.000Z',
        followerCount: 4,
        followingCount: 5,
        relationship: 'following',
      }),
    });

    const { result } = renderHook(() => usePublicProfile('target-user'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.id).toBe('target-user');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/target-user/profile',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
  });

  it('paginates followers with increasing offsets', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeFollowListItem('newest')],
          pagination: {
            limit: 20,
            offset: 0,
            hasMore: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeFollowListItem('older')],
          pagination: {
            limit: 20,
            offset: 20,
            hasMore: false,
          },
        }),
      });

    const { result } = renderHook(() => useFollowers(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.pages[0]?.items[0]?.id).toBe('newest');
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(
        result.current.data?.pages.flatMap((page) => page.items).map((item) => item.id)
      ).toEqual(['newest', 'older']);
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3100/users/me/followers?limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3100/users/me/followers?limit=20&offset=20',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it('paginates following with increasing offsets', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeFollowListItem('followed-1')],
          pagination: {
            limit: 20,
            offset: 0,
            hasMore: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeFollowListItem('followed-2')],
          pagination: {
            limit: 20,
            offset: 20,
            hasMore: false,
          },
        }),
      });

    const { result } = renderHook(() => useFollowing(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.pages[0]?.items[0]?.id).toBe('followed-1');
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(
        result.current.data?.pages.flatMap((page) => page.items).map((item) => item.id)
      ).toEqual(['followed-1', 'followed-2']);
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3100/users/me/following?limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3100/users/me/following?limit=20&offset=20',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it('invalidates user and activity-feed queries and emits follow-created analytics', async () => {
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        relationship: 'following',
        followerCount: 9,
        followingCount: 6,
      }),
    });

    const { result } = renderHook(() => useFollowUser(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('target-user');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/target-user/follow',
      expect.objectContaining({
        method: 'PUT',
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userKeys.all,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: activityFeedKeys.all,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: propertyKeys.followingViewportRoot('auth:viewer-1'),
    });

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
          name: string;
          properties: Record<string, unknown>;
        }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    expect(analyticsEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'follow_created',
          properties: expect.objectContaining({
            targetUserId: 'target-user',
            relationship: 'following',
            followerCount: 9,
            followingCount: 6,
          }),
        }),
      ])
    );
  });

  it('invalidates user and activity-feed queries and emits unfollow analytics', async () => {
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        relationship: 'none',
        followerCount: 8,
        followingCount: 5,
      }),
    });

    const { result } = renderHook(() => useUnfollowUser(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('target-user');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/target-user/follow',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer viewer-token' },
      })
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userKeys.all,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: activityFeedKeys.all,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: propertyKeys.followingViewportRoot('auth:viewer-1'),
    });

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
          name: string;
          properties: Record<string, unknown>;
        }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    expect(analyticsEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'unfollow',
          properties: expect.objectContaining({
            targetUserId: 'target-user',
            relationship: 'none',
            followerCount: 8,
            followingCount: 5,
          }),
        }),
      ])
    );
  });
});

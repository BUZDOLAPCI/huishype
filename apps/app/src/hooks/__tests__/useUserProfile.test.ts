import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import {
  useFollowers,
  useFollowing,
  useFollowUser,
  useUserSearch,
  usePublicProfile,
  useUnfollowUser,
  useUpdateProfile,
  useUploadProfilePhoto,
  useDeleteProfilePhoto,
  normalizeUserSearchQuery,
  userKeys,
} from '../useUserProfile';
import { activityFeedKeys } from '../useActivityFeed';
import { commentKeys } from '../useComments';
import { feedKeys } from '../useFeed';
import { leaderboardKeys } from '../useLeaderboard';
import { propertyKeys } from '../useProperties';
import { userActivityKeys } from '../useUserActivity';

const mockFetch = jest.fn();
const mockGetAccessToken = jest.fn();
const mockUpdateAuthUserProfile = jest.fn();
const mockUser = {
  id: 'viewer-1',
  email: 'viewer@example.com',
  displayName: 'Viewer',
  username: 'viewer',
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
    updateAuthUserProfile: mockUpdateAuthUserProfile,
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
    mockUpdateAuthUserProfile.mockClear();
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

  it('does not fetch followers when the surface is disabled', () => {
    const { result } = renderHook(() => useFollowers(undefined, false), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
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

  it('does not fetch following when the surface is disabled', () => {
    const { result } = renderHook(() => useFollowing(undefined, false), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
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

describe('useUserProfile profile update', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockAccessToken = null;
    mockGetAccessToken.mockClear();
    mockGetAccessToken.mockResolvedValue('viewer-token');
    mockUpdateAuthUserProfile.mockClear();
    mockUpdateAuthUserProfile.mockResolvedValue(undefined);
    mockFetch.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('sends narrow identity payloads and syncs auth plus identity query families', async () => {
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    queryClient.setQueryData(userKeys.me('viewer-1'), {
      id: 'viewer-1',
      displayName: 'Viewer',
      handle: 'viewer',
      profilePhotoUrl: null,
      homeCountry: 'NL',
      karma: 10,
      karmaRank: { title: 'Contributor', level: 2 },
      guessCount: 2,
      commentCount: 1,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 3,
      followingCount: 4,
      relationship: 'self',
      email: 'viewer@example.com',
      averageAccuracy: null,
      savedCount: 1,
      likedCount: 2,
      lastNameChangeAt: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'viewer-1',
        displayName: 'New Viewer',
        handle: 'new_viewer',
        profilePhotoUrl: 'https://example.test/avatar.jpg',
        lastDisplayNameChangeAt: '2026-05-21T10:00:00.000Z',
        lastHandleChangeAt: '2026-05-21T10:00:00.000Z',
        displayNameChangeAvailableAt: '2026-05-28T10:00:00.000Z',
        handleChangeAvailableAt: '2026-06-20T10:00:00.000Z',
      }),
    });

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ handle: 'new_viewer' });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/me/profile',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer viewer-token',
        },
        body: JSON.stringify({ handle: 'new_viewer' }),
      })
    );
    expect(mockUpdateAuthUserProfile).toHaveBeenCalledWith({
      displayName: 'New Viewer',
      handle: 'new_viewer',
      profilePhotoUrl: 'https://example.test/avatar.jpg',
    });
    expect(queryClient.getQueryData(userKeys.me('viewer-1'))).toEqual(
      expect.objectContaining({
        displayName: 'New Viewer',
        handle: 'new_viewer',
        profilePhotoUrl: 'https://example.test/avatar.jpg',
        displayNameChangeAvailableAt: '2026-05-28T10:00:00.000Z',
        handleChangeAvailableAt: '2026-06-20T10:00:00.000Z',
      })
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: userKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: activityFeedKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: userActivityKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: feedKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: commentKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: leaderboardKeys.all });
  });

  it('uploads a profile photo and syncs auth plus identity caches', async () => {
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    queryClient.setQueryData(userKeys.me('viewer-1'), {
      id: 'viewer-1',
      displayName: 'Viewer',
      handle: 'viewer',
      profilePhotoUrl: null,
      homeCountry: 'NL',
      karma: 10,
      karmaRank: { title: 'Contributor', level: 2 },
      guessCount: 2,
      commentCount: 1,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 3,
      followingCount: 4,
      relationship: 'self',
      email: 'viewer@example.com',
      averageAccuracy: null,
      savedCount: 1,
      likedCount: 2,
      lastNameChangeAt: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'viewer-1',
        displayName: 'Viewer',
        handle: 'viewer',
        profilePhotoUrl: 'https://media.example/avatar.jpg',
        homeCountry: 'NL',
        lastDisplayNameChangeAt: null,
        lastHandleChangeAt: null,
        displayNameChangeAvailableAt: null,
        handleChangeAvailableAt: null,
      }),
    });

    const { result } = renderHook(() => useUploadProfilePhoto(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ imageBase64: 'abc123', mimeType: 'image/png' });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/me/profile-photo',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer viewer-token',
        },
        body: JSON.stringify({ imageBase64: 'abc123', mimeType: 'image/png' }),
      })
    );
    expect(mockUpdateAuthUserProfile).toHaveBeenCalledWith({
      displayName: 'Viewer',
      handle: 'viewer',
      profilePhotoUrl: 'https://media.example/avatar.jpg',
    });
    expect(queryClient.getQueryData(userKeys.me('viewer-1'))).toEqual(
      expect.objectContaining({
        profilePhotoUrl: 'https://media.example/avatar.jpg',
      })
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: userKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: activityFeedKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: userActivityKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: feedKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: commentKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: leaderboardKeys.all });
  });

  it('deletes a profile photo and syncs auth plus identity caches', async () => {
    queryClient.setQueryData(userKeys.me('viewer-1'), {
      id: 'viewer-1',
      displayName: 'Viewer',
      handle: 'viewer',
      profilePhotoUrl: 'https://media.example/avatar.jpg',
      homeCountry: 'NL',
      karma: 10,
      karmaRank: { title: 'Contributor', level: 2 },
      guessCount: 2,
      commentCount: 1,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 3,
      followingCount: 4,
      relationship: 'self',
      email: 'viewer@example.com',
      averageAccuracy: null,
      savedCount: 1,
      likedCount: 2,
      lastNameChangeAt: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'viewer-1',
        displayName: 'Viewer',
        handle: 'viewer',
        profilePhotoUrl: null,
        homeCountry: 'NL',
        lastDisplayNameChangeAt: null,
        lastHandleChangeAt: null,
        displayNameChangeAvailableAt: null,
        handleChangeAvailableAt: null,
      }),
    });

    const { result } = renderHook(() => useDeleteProfilePhoto(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/me/profile-photo',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer viewer-token',
        },
      })
    );
    expect(mockUpdateAuthUserProfile).toHaveBeenCalledWith({
      displayName: 'Viewer',
      handle: 'viewer',
      profilePhotoUrl: null,
    });
    expect(queryClient.getQueryData(userKeys.me('viewer-1'))).toEqual(
      expect.objectContaining({
        profilePhotoUrl: null,
      })
    );
  });
});

describe('useUserProfile user search', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockAccessToken = null;
    mockGetAccessToken.mockClear();
    mockGetAccessToken.mockResolvedValue('viewer-token');
    mockFetch.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('normalizes leading @ characters before deciding whether search is enabled', () => {
    expect(normalizeUserSearchQuery('  @@jo ')).toBe('jo');
    expect(normalizeUserSearchQuery('@a')).toBe('a');
  });

  it('does not fetch until the normalized query has at least two characters', () => {
    const { result } = renderHook(() => useUserSearch('@a'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('searches users with auth when a viewer is signed in', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'target-user',
            displayName: 'Target User',
            handle: 'target',
            profilePhotoUrl: null,
            relationship: 'none',
            followerCount: 3,
          },
        ],
        pagination: { limit: 20, offset: 0, hasMore: false },
      }),
    });

    const { result } = renderHook(() => useUserSearch(' @target '), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.items[0]?.id).toBe('target-user');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/search?q=target&limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      }),
    );
  });

  it('searches users without auth for signed-out viewers', async () => {
    mockAuthUser = null;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: { limit: 20, offset: 0, hasMore: false },
      }),
    });

    const { result } = renderHook(() => useUserSearch('target'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.items).toEqual([]);
    });

    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/search?q=target&limit=20&offset=0',
      expect.objectContaining({
        headers: {},
      }),
    );
  });
});

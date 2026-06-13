import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { usePropertyLike } from '../usePropertyLike';
import { propertyKeys } from '../useProperties';
import { activityFeedKeys } from '../useActivityFeed';

// Mock the AuthProvider context
const mockUser = { id: 'user-123', email: 'test@test.com', displayName: 'Test User' };
let mockAuthUser: typeof mockUser | null = mockUser;
const mockGetAccessToken = jest.fn();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAuthUser ? 'mock-token' : null,
    isLoading: false,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    signOut: jest.fn(),
    getAccessToken: mockGetAccessToken,
    refreshAuth: jest.fn(),
  }),
}));

// Mock fetch for like/unlike API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock API_URL
jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function seedActivityFeed(queryClient: QueryClient, propertyId: string, likeCount = 3) {
  queryClient.setQueryData(activityFeedKeys.infinite('public', 'public'), {
    pages: [
      {
        items: [
          {
            property: {
              id: propertyId,
              address: '456 Oak Ave',
              streetName: 'Oak Ave',
              houseNumber: 456,
              houseNumberAddition: null,
              city: 'Amsterdam',
              postalCode: '1011 AA',
              countryCode: 'NL',
              geometry: null,
              thumbnailUrl: null,
              isLiked: false,
            },
            lastActivityAt: '2026-04-07T12:00:00.000Z',
            counts: {
              likeCount,
              commentCount: 2,
              guessCount: 1,
            },
            recentActors: [],
            preview: {
              kind: 'summary',
              eventType: 'property_like',
              createdAt: '2026-04-07T12:00:00.000Z',
              actor: {
                id: 'user-1',
                displayName: 'Ada',
                handle: 'ada',
                profilePhotoUrl: null,
              },
              summary: 'Ada liked this property',
            },
          },
        ],
        pagination: {
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      },
    ],
    pageParams: [0],
  });
}

function getActivityFeedProperty(queryClient: QueryClient, propertyId: string) {
  const data = queryClient.getQueryData<{
    pages: Array<{
      items: Array<{
        property: { id: string; isLiked?: boolean; likeCount?: number };
        counts: { likeCount: number };
      }>;
    }>;
  }>(activityFeedKeys.infinite('public', 'public'));

  return data?.pages.flatMap((page) => page.items).find((item) => item.property.id === propertyId);
}

describe('usePropertyLike', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockGetAccessToken.mockResolvedValue('mock-token');
    mockFetch.mockReset();
  });

  afterEach(() => {
    act(() => {
      queryClient.clear();
    });
  });

  it('returns isLiked and likeCount from property query cache', () => {
    const propertyId = 'prop-1';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed the cache with a property that has isLiked and likeCount
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '123 Main St',
      city: 'Eindhoven',
      isLiked: true,
      likeCount: 5,
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(true);
    expect(result.current.likeCount).toBe(5);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not rerender when an unrelated query cache entry updates', () => {
    const propertyId = 'prop-1';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    let renderCount = 0;

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '123 Main St',
      city: 'Eindhoven',
      isLiked: true,
      likeCount: 5,
    });

    const { result } = renderHook(
      () => {
        renderCount += 1;
        return usePropertyLike({ propertyId });
      },
      { wrapper: createWrapper(queryClient) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      queryClient.setQueryData(['listings', propertyId], {
        data: [{ id: 'listing-1' }],
      });
    });

    expect(renderCount).toBe(initialRenderCount);
    expect(result.current.isLiked).toBe(true);
    expect(result.current.likeCount).toBe(5);
  });

  it('returns defaults when property is not in cache', () => {
    const { result } = renderHook(
      () => usePropertyLike({ propertyId: 'missing-prop' }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(0);
    expect(
      queryClient.getQueryCache().find({
        queryKey: propertyKeys.detail('missing-prop', 'auth:user-123'),
      })
    ).toBeUndefined();
  });

  it('returns feed initial state when property detail is not in cache', () => {
    const { result } = renderHook(
      () =>
        usePropertyLike({
          propertyId: 'feed-prop',
          initialIsLiked: true,
          initialLikeCount: 12,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(true);
    expect(result.current.likeCount).toBe(12);
  });

  it('returns defaults when propertyId is null', () => {
    const { result } = renderHook(
      () => usePropertyLike({ propertyId: null }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(0);
  });

  it('calls onAuthRequired when user is not authenticated', () => {
    mockAuthUser = null;
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertyLike({ propertyId: 'prop-1', onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    act(() => {
      result.current.toggleLike();
    });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('toggleLike fires like mutation and optimistically updates cache', async () => {
    const propertyId = 'prop-2';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed cache: not liked
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '456 Oak Ave',
      city: 'Amsterdam',
      isLiked: false,
      likeCount: 3,
    });

    // Mock successful like API call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: true, likeCount: 4 }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(3);

    await act(async () => {
      result.current.toggleLike();
    });

    // After optimistic update, cache should be updated
    const cached = queryClient.getQueryData<{ isLiked: boolean; likeCount: number }>(queryKey);
    expect(cached?.isLiked).toBe(true);
    expect(cached?.likeCount).toBe(4);

    // Verify fetch was called with POST
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/like`,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      })
    );
  });

  it('patches matching activity feed caches during optimistic and authoritative like updates', async () => {
    const propertyId = 'prop-feed-like';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    seedActivityFeed(queryClient, propertyId, 3);

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '456 Oak Ave',
      city: 'Amsterdam',
      isLiked: false,
      likeCount: 3,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: true, likeCount: 9 }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      result.current.toggleLike();
    });

    await waitFor(() => {
      expect(getActivityFeedProperty(queryClient, propertyId)).toMatchObject({
        property: expect.objectContaining({
          isLiked: true,
          likeCount: 9,
        }),
        counts: expect.objectContaining({
          likeCount: 9,
        }),
      });
    });
  });

  it('toggleLike fires unlike mutation when already liked', async () => {
    const propertyId = 'prop-3';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed cache: already liked
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '789 Pine Rd',
      city: 'Rotterdam',
      isLiked: true,
      likeCount: 10,
    });

    // Mock successful unlike API call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ liked: false, likeCount: 9 }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(true);

    await act(async () => {
      result.current.toggleLike();
    });

    // After optimistic update
    const cached = queryClient.getQueryData<{ isLiked: boolean; likeCount: number }>(queryKey);
    expect(cached?.isLiked).toBe(false);
    expect(cached?.likeCount).toBe(9);

    // Verify fetch was called with DELETE
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/like`,
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer mock-token' },
      })
    );
  });

  it('rolls back optimistic update on mutation error', async () => {
    const propertyId = 'prop-4';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed cache: not liked
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '101 Elm St',
      city: 'Utrecht',
      isLiked: false,
      likeCount: 2,
    });

    // Mock failed like API call
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      result.current.toggleLike();
    });

    // Wait for error rollback
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isLiked: boolean; likeCount: number }>(queryKey);
      expect(cached?.isLiked).toBe(false);
      expect(cached?.likeCount).toBe(2);
    });
  });

  it('keeps the liked state on already-liked conflicts until refetch corrects the count', async () => {
    const propertyId = 'prop-5';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '202 Birch St',
      city: 'Leiden',
      isLiked: false,
      likeCount: 7,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'ALREADY_LIKED',
        message: 'You have already liked this property.',
      }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      result.current.toggleLike();
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isLiked: boolean; likeCount: number }>(queryKey);
      expect(cached?.isLiked).toBe(true);
      expect(cached?.likeCount).toBe(8);
    });
  });

  it('keeps the unliked state on stale unlike conflicts instead of rolling back', async () => {
    const propertyId = 'prop-6';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '303 Cedar St',
      city: 'Haarlem',
      isLiked: true,
      likeCount: 1,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'NOT_FOUND',
        message: 'You have not liked this property.',
      }),
    });

    const { result } = renderHook(
      () => usePropertyLike({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      result.current.toggleLike();
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isLiked: boolean; likeCount: number }>(queryKey);
      expect(cached?.isLiked).toBe(false);
      expect(cached?.likeCount).toBe(0);
    });
  });

  it('does nothing when propertyId is null', () => {
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertyLike({ propertyId: null, onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    act(() => {
      result.current.toggleLike();
    });

    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls onAuthRequired when token refresh returns null', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertyLike({ propertyId: 'prop-1', onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      result.current.toggleLike();
    });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

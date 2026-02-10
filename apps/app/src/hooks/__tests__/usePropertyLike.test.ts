import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { usePropertyLike } from '../usePropertyLike';
import { propertyKeys } from '../useProperties';

// Mock the AuthProvider context
const mockUser = { id: 'user-123', email: 'test@test.com', displayName: 'Test User' };
let mockAuthUser: typeof mockUser | null = mockUser;

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAuthUser ? 'mock-token' : null,
    isLoading: false,
    signInWithGoogle: jest.fn(),
    signInWithApple: jest.fn(),
    signInWithMockToken: jest.fn(),
    signOut: jest.fn(),
    getAccessToken: jest.fn(),
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

describe('usePropertyLike', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockFetch.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('returns isLiked and likeCount from property query cache', () => {
    const propertyId = 'prop-1';
    const queryKey = propertyKeys.detail(propertyId);

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

  it('returns defaults when property is not in cache', () => {
    const { result } = renderHook(
      () => usePropertyLike({ propertyId: 'missing-prop' }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(0);
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
    const queryKey = propertyKeys.detail(propertyId);

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
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('toggleLike fires unlike mutation when already liked', async () => {
    const propertyId = 'prop-3';
    const queryKey = propertyKeys.detail(propertyId);

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
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('rolls back optimistic update on mutation error', async () => {
    const propertyId = 'prop-4';
    const queryKey = propertyKeys.detail(propertyId);

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
});

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { usePropertySave } from '../usePropertySave';
import { propertyKeys } from '../useProperties';
import { savedPropertyKeys } from '../useSavedProperties';

// Mock the AuthProvider context
const mockUser = { id: 'user-123', email: 'test@test.com', displayName: 'Test User' };
let mockAuthUser: typeof mockUser | null = mockUser;
const mockGetAccessToken = jest.fn<Promise<string | null>, []>();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAuthUser ? 'stale-token' : null,
    isLoading: false,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    signOut: jest.fn(),
    getAccessToken: mockGetAccessToken,
    refreshAuth: jest.fn(),
  }),
}));

// Mock fetch for save/unsave API calls
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

describe('usePropertySave', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockAuthUser = mockUser;
    mockFetch.mockReset();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('fresh-token');
  });

  afterEach(() => {
    act(() => {
      queryClient.clear();
    });
  });

  it('returns isSaved from property query cache', () => {
    const propertyId = 'prop-1';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed the cache with a property that has isSaved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '123 Main St',
      city: 'Eindhoven',
      isSaved: true,
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns defaults when property is not in cache', () => {
    const { result } = renderHook(
      () => usePropertySave({ propertyId: 'missing-prop' }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(false);
    expect(
      queryClient.getQueryCache().find({
        queryKey: propertyKeys.detail('missing-prop', 'auth:user-123'),
      })
    ).toBeUndefined();
  });

  it('returns defaults when propertyId is null', () => {
    const { result } = renderHook(
      () => usePropertySave({ propertyId: null }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(false);
  });

  it('calls onAuthRequired when user is not authenticated', () => {
    mockAuthUser = null;
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertySave({ propertyId: 'prop-1', onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    act(() => {
      result.current.toggleSave();
    });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls onAuthRequired when the access token cannot be refreshed', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertySave({ propertyId: 'prop-auth-missing', onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('toggleSave fires save mutation and optimistically updates cache', async () => {
    const propertyId = 'prop-2';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');
    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ saved: boolean }> }) => void) | undefined;

    // Seed cache: not saved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '456 Oak Ave',
      city: 'Amsterdam',
      isSaved: false,
    });

    // Mock successful save API call
    mockFetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(false);

    let togglePromise: Promise<void> | undefined;
    await act(async () => {
      togglePromise = result.current.toggleSave();
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
      expect(cached?.isSaved).toBe(true);
    });

    resolveFetch?.({
      ok: true,
      json: async () => ({ saved: true }),
    });

    await act(async () => {
      await togglePromise;
    });

    // Verify fetch was called with POST
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/save`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-token',
        }),
      })
    );
    expect(mockFetch.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': expect.anything(),
        }),
      })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: propertyKeys.detailBase(propertyId) })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: savedPropertyKeys.all })
    );
  });

  it('toggleSave fires unsave mutation when already saved', async () => {
    const propertyId = 'prop-3';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');
    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ saved: boolean }> }) => void) | undefined;

    // Seed cache: already saved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '789 Pine Rd',
      city: 'Rotterdam',
      isSaved: true,
    });

    // Mock successful unsave API call
    mockFetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(true);

    let togglePromise: Promise<void> | undefined;
    await act(async () => {
      togglePromise = result.current.toggleSave();
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
      expect(cached?.isSaved).toBe(false);
    });

    resolveFetch?.({
      ok: true,
      json: async () => ({ saved: false }),
    });

    await act(async () => {
      await togglePromise;
    });

    // Verify fetch was called with DELETE
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/save`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-token',
        }),
      })
    );
    expect(mockFetch.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': expect.anything(),
        }),
      })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: propertyKeys.detailBase(propertyId) })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: savedPropertyKeys.all })
    );
  });

  it('rolls back optimistic update on mutation error', async () => {
    const propertyId = 'prop-4';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');

    // Seed cache: not saved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '101 Elm St',
      city: 'Utrecht',
      isSaved: false,
    });

    // Mock failed save API call
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    // Wait for error rollback
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
      expect(cached?.isSaved).toBe(false);
    });
  });

  it('keeps the saved state on already-saved conflicts until refetch reconciles canonical data', async () => {
    const propertyId = 'prop-5';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData');

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '202 Birch St',
      city: 'Leiden',
      isSaved: false,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'ALREADY_SAVED',
        message: 'You have already saved this property.',
      }),
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(setQueryDataSpy).toHaveBeenLastCalledWith(
      queryKey,
      expect.objectContaining({ isSaved: true })
    );
  });

  it('keeps the unsaved state on stale unsave conflicts instead of rolling back', async () => {
    const propertyId = 'prop-6';
    const queryKey = propertyKeys.detail(propertyId, 'auth:user-123');
    const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData');

    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '303 Cedar St',
      city: 'Haarlem',
      isSaved: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'NOT_FOUND',
        message: 'You have not saved this property.',
      }),
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(setQueryDataSpy).toHaveBeenLastCalledWith(
      queryKey,
      expect.objectContaining({ isSaved: false })
    );
  });

  it('does nothing when propertyId is null', () => {
    const onAuthRequired = jest.fn();

    const { result } = renderHook(
      () => usePropertySave({ propertyId: null, onAuthRequired }),
      { wrapper: createWrapper(queryClient) }
    );

    act(() => {
      result.current.toggleSave();
    });

    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

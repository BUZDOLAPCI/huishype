import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { usePropertySave } from '../usePropertySave';
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
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('returns isSaved from property query cache', () => {
    const propertyId = 'prop-1';
    const queryKey = propertyKeys.detail(propertyId);

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

  it('toggleSave fires save mutation and optimistically updates cache', async () => {
    const propertyId = 'prop-2';
    const queryKey = propertyKeys.detail(propertyId);

    // Seed cache: not saved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '456 Oak Ave',
      city: 'Amsterdam',
      isSaved: false,
    });

    // Mock successful save API call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ saved: true }),
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(false);

    await act(async () => {
      result.current.toggleSave();
    });

    // After optimistic update, cache should be updated
    const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
    expect(cached?.isSaved).toBe(true);

    // Verify fetch was called with POST
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/save`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('toggleSave fires unsave mutation when already saved', async () => {
    const propertyId = 'prop-3';
    const queryKey = propertyKeys.detail(propertyId);

    // Seed cache: already saved
    queryClient.setQueryData(queryKey, {
      id: propertyId,
      address: '789 Pine Rd',
      city: 'Rotterdam',
      isSaved: true,
    });

    // Mock successful unsave API call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ saved: false }),
    });

    const { result } = renderHook(
      () => usePropertySave({ propertyId }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isSaved).toBe(true);

    await act(async () => {
      result.current.toggleSave();
    });

    // After optimistic update
    const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
    expect(cached?.isSaved).toBe(false);

    // Verify fetch was called with DELETE
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/properties/${propertyId}/save`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('rolls back optimistic update on mutation error', async () => {
    const propertyId = 'prop-4';
    const queryKey = propertyKeys.detail(propertyId);

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
      result.current.toggleSave();
    });

    // Wait for error rollback
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ isSaved: boolean }>(queryKey);
      expect(cached?.isSaved).toBe(false);
    });
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

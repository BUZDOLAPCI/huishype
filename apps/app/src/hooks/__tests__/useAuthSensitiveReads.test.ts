import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import { useActivityFeed } from '../useActivityFeed';
import { useNotifications } from '../useNotifications';
import { useUserActivity } from '../useUserActivity';

const mockFetch = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: {
      id: 'viewer-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
    },
    isAuthenticated: true,
    accessToken: null,
    getAccessToken: mockGetAccessToken,
  }),
}));

jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
}));

global.fetch = mockFetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('auth-sensitive app reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('viewer-token');
  });

  it('uses a fresh token for the following activity feed even when the auth snapshot is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: {
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    const { result } = renderHook(() => useActivityFeed('following'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/activity?scope=following&limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      }),
    );
  });

  it('uses a fresh token for the notifications list even when the auth snapshot is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: {
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/notifications?limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      }),
    );
  });

  it('uses a fresh token for personal activity even when the auth snapshot is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: {
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      }),
    });

    const { result } = renderHook(() => useUserActivity(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/users/me/activity?limit=20&offset=0',
      expect.objectContaining({
        headers: { Authorization: 'Bearer viewer-token' },
      }),
    );
  });
});

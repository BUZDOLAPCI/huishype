import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { readTileSourceKeys } from '../readTileSourceInvalidation';
import { __resetPropertyViewTrackingForTests, usePropertyView } from '../usePropertyView';

const mockPost = jest.fn<Promise<{ viewCount: number; uniqueViewers: number }>, [string, unknown, RequestInit?]>();
const mockGetAnonymousSessionId = jest.fn<Promise<string | null>, []>();
let mockIsAuthenticated = false;
let mockUserId: string | null = null;

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: mockIsAuthenticated,
    user: mockUserId ? { id: mockUserId } : null,
  }),
}));

jest.mock('../../lib/anonymousSession', () => ({
  getAnonymousSessionId: () => mockGetAnonymousSessionId(),
}));

jest.mock('../../utils/api', () => ({
  api: {
    post: (...args: [string, unknown, RequestInit?]) => mockPost(...args),
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

describe('usePropertyView', () => {
  beforeEach(() => {
    __resetPropertyViewTrackingForTests();
    mockPost.mockReset();
    mockGetAnonymousSessionId.mockReset();
    mockIsAuthenticated = false;
    mockUserId = null;

    mockPost.mockResolvedValue({
      viewCount: 1,
      uniqueViewers: 1,
    });
    mockGetAnonymousSessionId.mockResolvedValue('session-123');
  });

  it('tracks each property at most once per hook instance', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => usePropertyView(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.recordPropertyView('property-123');
      result.current.recordPropertyView('property-123');
      result.current.recordPropertyView('property-456');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/properties/property-123/view',
      {},
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      '/properties/property-456/view',
      {},
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    const firstHeaders = mockPost.mock.calls[0]?.[2]?.headers;
    const secondHeaders = mockPost.mock.calls[1]?.[2]?.headers;

    expect(firstHeaders).toBeInstanceOf(Headers);
    expect(secondHeaders).toBeInstanceOf(Headers);
    expect((firstHeaders as Headers).get('x-session-id')).toBe('session-123');
    expect((secondHeaders as Headers).get('x-session-id')).toBe('session-123');
    expect(queryClient.getQueryData(readTileSourceKeys.version)).toBe(2);
  });

  it('dedupes the same property across separate hook instances for the same viewer', async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);
    const firstHook = renderHook(() => usePropertyView(), { wrapper });
    const secondHook = renderHook(() => usePropertyView(), { wrapper });

    act(() => {
      firstHook.result.current.recordPropertyView('property-123');
      secondHook.result.current.recordPropertyView('property-123');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    expect(queryClient.getQueryData(readTileSourceKeys.version)).toBe(1);
  });

  it('allows retrying a property view after a failed mutation', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => usePropertyView(), {
      wrapper: createWrapper(queryClient),
    });

    mockPost
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        viewCount: 1,
        uniqueViewers: 1,
      });

    act(() => {
      result.current.recordPropertyView('property-123');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(readTileSourceKeys.version)).toBeUndefined();
    });

    act(() => {
      result.current.recordPropertyView('property-123');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    expect(queryClient.getQueryData(readTileSourceKeys.version)).toBe(1);
  });

  it('isolates shared dedupe by authenticated user identity', async () => {
    mockIsAuthenticated = true;
    mockUserId = 'user-123';

    const queryClient = createQueryClient();
    const firstHook = renderHook(() => usePropertyView(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      firstHook.result.current.recordPropertyView('property-123');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    __resetPropertyViewTrackingForTests();
    mockUserId = 'user-456';

    const secondHook = renderHook(() => usePropertyView(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      secondHook.result.current.recordPropertyView('property-123');
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    expect(mockGetAnonymousSessionId).not.toHaveBeenCalled();
  });
});

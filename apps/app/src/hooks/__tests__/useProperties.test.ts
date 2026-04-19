import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useFollowingViewport, useProperty } from '../useProperties';
import { api, fetchFollowingViewport } from '../../utils/api';

const mockGetAccessToken = jest.fn();
let mockUser: { id: string } | null = { id: 'viewer-1' };

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: !!mockUser,
    user: mockUser,
  }),
}));

jest.mock('../../utils/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  fetchFollowingViewport: jest.fn(),
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockFetchFollowingViewport = fetchFollowingViewport as jest.MockedFunction<
  typeof fetchFollowingViewport
>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
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

describe('useProperty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'viewer-1' };
  });

  it('fetches property details with an auth header when a token is available', async () => {
    mockGetAccessToken.mockResolvedValueOnce('viewer-token');
    mockApi.get.mockResolvedValueOnce({
      id: 'property-123',
      nationalId: null,
      countryCode: 'NL',
      address: 'Beeldbuisring 41',
      city: 'Eindhoven',
      postalCode: '5651HA',
      geometry: null,
      imageryGeometry: null,
      yearBuilt: 1999,
      floorAreaM2: 120,
      status: 'active',
      officialValuation: 410000,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      activityLevel: 'warm',
      commentCount: 2,
      guessCount: 1,
      viewCount: 10,
      uniqueViewers: 8,
      likeCount: 3,
      isLiked: true,
      isSaved: false,
    });

    const { result } = renderHook(() => useProperty('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith('/properties/property-123', {
      headers: {
        Authorization: 'Bearer viewer-token',
      },
    });
    expect(result.current.data?.isLiked).toBe(true);
  });

  it('falls back to an anonymous property fetch when no token exists', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    mockApi.get.mockResolvedValueOnce({
      id: 'property-123',
      nationalId: null,
      countryCode: 'NL',
      address: 'Beeldbuisring 41',
      city: 'Eindhoven',
      postalCode: '5651HA',
      geometry: null,
      imageryGeometry: null,
      yearBuilt: 1999,
      floorAreaM2: 120,
      status: 'active',
      officialValuation: 410000,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      activityLevel: 'warm',
      commentCount: 2,
      guessCount: 1,
      viewCount: 10,
      uniqueViewers: 8,
      likeCount: 0,
      isLiked: false,
      isSaved: false,
    });

    const { result } = renderHook(() => useProperty('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenCalledWith('/properties/property-123', undefined);
    expect(result.current.data?.isLiked).toBe(false);
  });
});

describe('useFollowingViewport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'viewer-1' };
  });

  it('stays disabled while signed out', () => {
    mockUser = null;

    const { result } = renderHook(
      () => useFollowingViewport([5.4, 51.4, 5.5, 51.5], undefined, true),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetchFollowingViewport).not.toHaveBeenCalled();
  });

  it('fetches the following overlay with viewer-sensitive auth enabled', async () => {
    mockGetAccessToken.mockResolvedValueOnce('viewer-token');
    mockFetchFollowingViewport.mockResolvedValueOnce([
      {
        id: 'property-123',
        coordinate: [5.47, 51.44],
        address: 'Beeldbuisring 41',
        city: 'Eindhoven',
        postalCode: '5651HA',
        countryCode: 'NL',
        askingPrice: 410000,
        thumbnailUrl: null,
        hasActiveListing: true,
        marketState: 'for-sale',
        activityTypes: ['comment'],
        actorCount: 2,
        lastActivityAt: '2026-04-19T09:00:00.000Z',
      },
    ]);

    const { result } = renderHook(
      () =>
        useFollowingViewport(
          [5.4, 51.4, 5.5, 51.5],
          {
            salePriceFrom: 300000,
            salePriceTo: 500000,
            rentPriceFrom: null,
            rentPriceTo: null,
            marketState: ['for-sale'],
            activity: 'recent',
          },
          true,
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(mockFetchFollowingViewport).toHaveBeenCalledWith(
      [5.4, 51.4, 5.5, 51.5],
      expect.objectContaining({
        salePriceFrom: 300000,
        salePriceTo: 500000,
        marketState: ['for-sale'],
      }),
    );
    expect(result.current.data).toHaveLength(1);
  });
});

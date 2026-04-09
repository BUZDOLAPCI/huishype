import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useProperty } from '../useProperties';
import { api } from '../../utils/api';

const mockGetAccessToken = jest.fn();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

jest.mock('../../utils/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

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

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useReadTileSource } from '../useReadTileSource';
import type { MapFilters } from '../../lib/sharedMapFilters';

const mockGetAccessToken = jest.fn<Promise<string | null>, []>();
const mockGetAnonymousSessionId = jest.fn<Promise<string | null>, []>();
const mockFetchReadTileSource = jest.fn();
let mockIsAuthenticated = true;

const filters: MapFilters = {
  salePriceFrom: null,
  salePriceTo: null,
  rentPriceFrom: null,
  rentPriceTo: null,
  marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
  activity: 'all',
};

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    accessToken: mockIsAuthenticated ? 'snapshot-token' : null,
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
    user: mockIsAuthenticated ? { id: 'user-123' } : null,
  }),
}));

jest.mock('@/src/lib/anonymousSession', () => ({
  getAnonymousSessionId: () => mockGetAnonymousSessionId(),
}));

jest.mock('@/src/utils/api', () => ({
  API_URL: 'http://api.test',
}));

jest.mock('@/src/lib/mapPropertySource', () => ({
  fetchReadTileSource: (...args: unknown[]) => mockFetchReadTileSource(...args),
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

describe('useReadTileSource', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockGetAccessToken.mockReset();
    mockGetAnonymousSessionId.mockReset();
    mockFetchReadTileSource.mockReset();
    mockGetAccessToken.mockResolvedValue('fresh-token');
    mockGetAnonymousSessionId.mockResolvedValue('session-123');
    mockFetchReadTileSource.mockResolvedValue({
      tileJsonUrl: 'http://api.test/tiles/properties/read.json',
      tileUrl: 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf',
      tileJson: { tiles: ['http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf'] },
      headerName: 'Authorization',
      headerValue: 'Bearer fresh-token',
      version: 0,
    });
  });

  it('uses fresh Authorization credentials for signed-in read TileJSON requests', async () => {
    const queryClient = createQueryClient();
    renderHook(() => useReadTileSource(filters, true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchReadTileSource).toHaveBeenCalledTimes(1);
    });

    expect(mockFetchReadTileSource).toHaveBeenCalledWith(
      'http://api.test',
      filters,
      {
        headerName: 'Authorization',
        headerValue: 'Bearer fresh-token',
      },
      0,
    );
    expect(mockGetAnonymousSessionId).not.toHaveBeenCalled();
  });

  it('uses the anonymous session ID for signed-out read TileJSON requests', async () => {
    mockIsAuthenticated = false;
    const queryClient = createQueryClient();

    renderHook(() => useReadTileSource(filters, true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchReadTileSource).toHaveBeenCalledTimes(1);
    });

    expect(mockFetchReadTileSource).toHaveBeenCalledWith(
      'http://api.test',
      filters,
      {
        headerName: 'x-session-id',
        headerValue: 'session-123',
      },
      0,
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });
});

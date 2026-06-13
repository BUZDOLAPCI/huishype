import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useFollowingTileSource } from '../useFollowingTileSource';
import { getFollowingTileFilterSignature } from '../tileFilterSignature';
import type { LocationFilterToken, MapFilters } from '../../lib/sharedMapFilters';

const mockGetAccessToken = jest.fn<Promise<string | null>, []>();
const mockFetchFollowingTileSource = jest.fn();

const filters: MapFilters = {
  salePriceFrom: null,
  salePriceTo: null,
  rentPriceFrom: null,
  rentPriceTo: null,
  marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
  activity: 'all',
  listedSince: 'all',
  scope: 'public',
  areas: [],
};

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: true,
    user: { id: 'user-123' },
  }),
}));

jest.mock('@/src/utils/api', () => ({
  API_URL: 'http://api.test',
}));

jest.mock('@/src/lib/mapPropertySource', () => ({
  fetchFollowingTileSource: (...args: unknown[]) => mockFetchFollowingTileSource(...args),
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

describe('useFollowingTileSource', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchFollowingTileSource.mockReset();
    mockGetAccessToken.mockResolvedValue('fresh-token');
    mockFetchFollowingTileSource.mockResolvedValue({
      tileJsonUrl: 'http://api.test/tiles/following/properties.json',
      tileUrl: 'http://api.test/tiles/following/properties/{z}/{x}/{y}.pbf',
      tileJson: {
        tiles: ['http://api.test/tiles/following/properties/{z}/{x}/{y}.pbf'],
      },
    });
  });

  it('keys following tile sources by canonical filters, following activity, and areas', async () => {
    const queryClient = createQueryClient();
    const cityArea: LocationFilterToken = {
      type: 'city',
      countryCode: 'NL',
      value: 'Eindhoven',
      label: 'Eindhoven',
    };
    const currentLocationArea: LocationFilterToken = {
      type: 'current-location',
      value: '52.370216,4.895168',
      label: 'Current location',
      coordinates: [4.895168, 52.370216],
      radiusMeters: 7500,
    };
    const filtered: MapFilters = {
      ...filters,
      salePriceFrom: 450000,
      marketState: ['for-sale', 'sold'],
      areas: [cityArea, currentLocationArea],
    };
    const expectedSignature = getFollowingTileFilterSignature(filtered, '10d');

    renderHook(() => useFollowingTileSource(filtered, '10d', true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchFollowingTileSource).toHaveBeenCalledTimes(1);
    });

    expect(expectedSignature).toContain('activity=10d');
    expect(expectedSignature).toContain('area=city%3ANL%3Aeindhoven');
    expect(expectedSignature).toContain('current-location%3A52.370216%3A4.895168%3A7500');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey.at(-1) === expectedSignature)
    ).toBe(true);
  });
});

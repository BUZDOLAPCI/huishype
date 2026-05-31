import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useReadTileSource } from '../useReadTileSource';
import { bumpReadTileSourceVersion } from '../readTileSourceInvalidation';
import { getReadTileFilterSignature } from '../tileFilterSignature';
import type { LocationFilterToken, MapFilters } from '../../lib/sharedMapFilters';

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
      cacheBustedTileUrl: 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf',
      tileJson: { tiles: ['http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf'] },
      headerName: 'Authorization',
      headerValue: 'Bearer fresh-token',
      version: 0,
    });
  });

  it('does not fetch read tiles before any read state exists in the runtime', async () => {
    const queryClient = createQueryClient();

    renderHook(() => useReadTileSource(filters, true), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchReadTileSource).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockGetAnonymousSessionId).not.toHaveBeenCalled();
  });

  it('uses fresh Authorization credentials for signed-in read TileJSON requests', async () => {
    const queryClient = createQueryClient();
    act(() => {
      bumpReadTileSourceVersion(queryClient);
    });
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
      1,
    );
    expect(mockGetAnonymousSessionId).not.toHaveBeenCalled();
  });

  it('keys read tile sources by the canonical filter and area signature', async () => {
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
      activity: '30d',
      areas: [cityArea, currentLocationArea],
    };
    const expectedSignature = getReadTileFilterSignature(filtered);

    act(() => {
      bumpReadTileSourceVersion(queryClient);
    });

    renderHook(() => useReadTileSource(filtered, true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockFetchReadTileSource).toHaveBeenCalledTimes(1);
    });

    expect(expectedSignature).toContain('area=city%3ANL%3Aeindhoven');
    expect(expectedSignature).toContain('current-location%3A52.370216%3A4.895168%3A7500');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey.at(-1) === expectedSignature)
    ).toBe(true);
  });

  it('uses the anonymous session ID for signed-out read TileJSON requests', async () => {
    mockIsAuthenticated = false;
    const queryClient = createQueryClient();
    act(() => {
      bumpReadTileSourceVersion(queryClient);
    });

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
      1,
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('keeps the previous read tile source while a bumped version is loading', async () => {
    const queryClient = createQueryClient();
    const initialTileSource = {
      tileJsonUrl: 'http://api.test/tiles/properties/read.json?readVersion=1',
      tileUrl: 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf',
      cacheBustedTileUrl: 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=1',
      tileJson: { tiles: ['http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=1'] },
      headerName: 'Authorization',
      headerValue: 'Bearer fresh-token',
      version: 1,
    };
    const refreshedTileSource = {
      ...initialTileSource,
      tileJsonUrl: 'http://api.test/tiles/properties/read.json?readVersion=2',
      cacheBustedTileUrl: 'http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=2',
      tileJson: {
        tiles: ['http://api.test/tiles/properties/read/{z}/{x}/{y}.pbf?readVersion=2'],
      },
      version: 2,
    };
    let resolveRefresh!: (value: typeof refreshedTileSource) => void;

    mockFetchReadTileSource
      .mockResolvedValueOnce(initialTileSource)
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );

    const { result } = renderHook(() => useReadTileSource(filters, true), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      bumpReadTileSourceVersion(queryClient);
    });

    await waitFor(() => {
      expect(result.current.data?.tileUrl).toBe(initialTileSource.tileUrl);
    });

    act(() => {
      bumpReadTileSourceVersion(queryClient);
    });

    await waitFor(() => {
      expect(mockFetchReadTileSource).toHaveBeenCalledTimes(2);
    });

    expect(mockFetchReadTileSource).toHaveBeenLastCalledWith(
      'http://api.test',
      filters,
      {
        headerName: 'Authorization',
        headerValue: 'Bearer fresh-token',
      },
      2,
    );
    expect(result.current.data?.tileUrl).toBe(initialTileSource.tileUrl);
    expect(result.current.data?.cacheBustedTileUrl).toBe(initialTileSource.cacheBustedTileUrl);

    act(() => {
      resolveRefresh(refreshedTileSource);
    });

    await waitFor(() => {
      expect(result.current.data?.cacheBustedTileUrl).toBe(refreshedTileSource.cacheBustedTileUrl);
    });
    expect(result.current.data?.tileUrl).toBe(initialTileSource.tileUrl);
  });
});

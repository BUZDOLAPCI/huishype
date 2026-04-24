import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { getViewerCacheKey, propertyKeys, useProperty } from '../useProperties';
import {
  api,
  fetchOfficialValuationFromSource,
  submitOfficialValuationHydration,
} from '../../utils/api';

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
  fetchOfficialValuationFromSource: jest.fn(),
  submitOfficialValuationHydration: jest.fn(),
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockFetchOfficialValuationFromSource =
  fetchOfficialValuationFromSource as jest.MockedFunction<typeof fetchOfficialValuationFromSource>;
const mockSubmitOfficialValuationHydration =
  submitOfficialValuationHydration as jest.MockedFunction<typeof submitOfficialValuationHydration>;

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

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return {
    queryClient,
    wrapper({ children }: PropsWithChildren) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

function buildPropertyResponse(overrides: Record<string, unknown> = {}) {
  return {
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
    officialValuationYear: 2023,
    officialValuationSourceFetch: {
      source: 'woz',
      expectedValuationYear: 2024,
      supportsClientFetch: {
        web: true,
        native: true,
      },
    },
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
    ...overrides,
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
    mockUser = null;
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

  it('keeps one-view recent activity quiet when deriving compatibility activity state', async () => {
    mockUser = null;
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
      socialScore: 0.1,
      recentSocialScore: 0.1,
      hasActiveListing: false,
      commentCount: 0,
      guessCount: 0,
      viewCount: 1,
      uniqueViewers: 1,
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

    expect(result.current.data?.activityLevel).toBe('cold');
  });

  it('uses reply-inclusive comment totals when detail payloads expose threaded counts', async () => {
    mockUser = null;
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
      topLevelCommentCount: 2,
      replyCount: 3,
      commentCount: 2,
      guessCount: 0,
      viewCount: 0,
      uniqueViewers: 0,
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

    expect(result.current.data?.commentCount).toBe(5);
  });

  it('derives activity from current social fields instead of stale legacy activity levels', async () => {
    mockUser = null;
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
      socialScore: 3,
      recentSocialScore: 0,
      hasActiveListing: false,
      activityLevel: 'hot',
      commentCount: 0,
      guessCount: 0,
      viewCount: 0,
      uniqueViewers: 0,
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

    expect(result.current.data?.activityLevel).toBe('warm');
  });

  it('keeps anonymous and authenticated property detail cache entries separate', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    mockUser = null;
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

    const anonymousHook = renderHook(() => useProperty('property-123'), {
      wrapper,
    });

    await waitFor(() => {
      expect(anonymousHook.result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(propertyKeys.detail('property-123', 'anon'))).toMatchObject({
      isSaved: false,
    });

    mockUser = { id: 'viewer-1' };
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
      isSaved: true,
    });

    const authenticatedHook = renderHook(() => useProperty('property-123'), {
      wrapper,
    });

    await waitFor(() => {
      expect(authenticatedHook.result.current.isSuccess).toBe(true);
    });

    expect(mockApi.get).toHaveBeenNthCalledWith(2, '/properties/property-123', {
      headers: {
        Authorization: 'Bearer viewer-token',
      },
    });
    expect(queryClient.getQueryData(propertyKeys.detail('property-123', 'anon'))).toMatchObject({
      isSaved: false,
    });
    expect(
      queryClient.getQueryData(
        propertyKeys.detail(
          'property-123',
          getViewerCacheKey({ id: 'viewer-1' }, true),
        ),
      ),
    ).toMatchObject({
      isSaved: true,
    });
  });

  it('merges client-fetched official valuation previews into only the detail cache', async () => {
    mockUser = null;
    mockGetAccessToken.mockResolvedValue(null);
    mockApi.get.mockResolvedValueOnce(buildPropertyResponse({
      officialValuation: null,
      officialValuationYear: null,
    }));
    mockFetchOfficialValuationFromSource.mockResolvedValueOnce({
      source: 'woz',
      valuation: 455000,
      valuationYear: 2024,
      referenceDate: '2024-01-01',
    });
    mockSubmitOfficialValuationHydration.mockResolvedValueOnce({
      propertyId: 'property-123',
      source: 'woz',
      status: 'accepted',
      officialValuation: 455000,
      officialValuationYear: 2024,
    });
    const { queryClient, wrapper } = createQueryClientWrapper();
    queryClient.setQueryData(propertyKeys.list({}), {
      data: [buildPropertyResponse({ officialValuation: null, officialValuationYear: null })],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const { result } = renderHook(() => useProperty('property-123'), { wrapper });

    await waitFor(() => {
      expect(mockSubmitOfficialValuationHydration).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.data?.officialValuationPreview).toBeUndefined();
    });

    expect(result.current.data?.officialValuation).toBe(455000);
    expect(result.current.data?.officialValuationYear).toBe(2024);
    expect(mockSubmitOfficialValuationHydration).toHaveBeenCalledWith(
      'property-123',
      expect.objectContaining({ valuation: 455000, valuationYear: 2024 }),
      null,
    );
    expect(queryClient.getQueryData(propertyKeys.list({}))).toMatchObject({
      data: [expect.objectContaining({ officialValuation: null, officialValuationYear: null })],
    });
  });

  it('keeps a newer in-memory preview when a stale server refetch follows hydration', async () => {
    mockUser = null;
    mockGetAccessToken.mockResolvedValue(null);
    mockApi.get
      .mockResolvedValueOnce(buildPropertyResponse({
        officialValuation: null,
        officialValuationYear: null,
      }))
      .mockResolvedValueOnce(buildPropertyResponse({
        officialValuation: null,
        officialValuationYear: null,
      }));
    mockFetchOfficialValuationFromSource.mockResolvedValueOnce({
      source: 'woz',
      valuation: 455000,
      valuationYear: 2024,
    });
    mockSubmitOfficialValuationHydration.mockResolvedValueOnce({
      propertyId: 'property-123',
      source: 'woz',
      status: 'queued',
      officialValuation: null,
      officialValuationYear: null,
    });

    const { result } = renderHook(() => useProperty('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.data?.officialValuation).toBe(455000);
    });

    expect(result.current.data?.officialValuationYear).toBe(2024);
    expect(result.current.data?.officialValuationPreview).toMatchObject({
      source: 'client_fetched',
    });
  });

  it('replaces an in-memory preview when the backend returns a current valuation', async () => {
    mockUser = null;
    mockGetAccessToken.mockResolvedValue(null);
    mockApi.get
      .mockResolvedValueOnce(buildPropertyResponse({
        officialValuation: null,
        officialValuationYear: null,
      }))
      .mockResolvedValueOnce(buildPropertyResponse({
        officialValuation: 460000,
        officialValuationYear: 2024,
      }));
    mockFetchOfficialValuationFromSource.mockResolvedValueOnce({
      source: 'woz',
      valuation: 455000,
      valuationYear: 2024,
    });
    mockSubmitOfficialValuationHydration.mockResolvedValueOnce({
      propertyId: 'property-123',
      source: 'woz',
      status: 'queued',
      officialValuation: null,
      officialValuationYear: null,
    });

    const { result } = renderHook(() => useProperty('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.officialValuation).toBe(460000);
    });

    expect(result.current.data?.officialValuationYear).toBe(2024);
    expect(result.current.data?.officialValuationPreview).toBeUndefined();
  });

  it('does not client-fetch official valuations for non-NL properties', async () => {
    mockUser = null;
    mockGetAccessToken.mockResolvedValue(null);
    mockApi.get.mockResolvedValueOnce(buildPropertyResponse({
      countryCode: 'DE',
      officialValuation: null,
      officialValuationYear: null,
      officialValuationSourceFetch: {
        source: 'woz',
        expectedValuationYear: 2024,
        supportsClientFetch: {
          web: true,
          native: true,
        },
      },
    }));

    const { result } = renderHook(() => useProperty('property-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetchOfficialValuationFromSource).not.toHaveBeenCalled();
    expect(mockSubmitOfficialValuationHydration).not.toHaveBeenCalled();
  });
});

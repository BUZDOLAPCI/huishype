import React from 'react';
import { describe, expect, it, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { CountryCode, SavedProperty } from '@huishype/shared';
import { getPropertyAerialImageFromGeometry } from '../../lib/propertyThumbnail';
import { savedPropertyKeys, transformSavedProperty, useSavedProperties } from '../useSavedProperties';

const mockFetch = jest.fn();
global.fetch = mockFetch;

let mockAuthUser: { id: string } | null = null;
let mockAccessToken: string | null = null;
const mockGetAccessToken = jest.fn();

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    accessToken: mockAccessToken,
    isAuthenticated: !!mockAuthUser,
    getAccessToken: mockGetAccessToken,
  }),
}));

function createSavedProperty(
  overrides: Partial<SavedProperty> = {},
): SavedProperty {
  return {
    id: 'a0000000-0000-4000-a000-000000000001',
    nationalId: null,
    countryCode: 'NL' as CountryCode,
    region: null,
    street: 'Teststraat',
    houseNumber: 12,
    houseNumberAddition: null,
    address: 'Teststraat 12, 5611 AA Eindhoven',
    city: 'Eindhoven',
    postalCode: '5611 AA',
    geometry: {
      type: 'Point',
      coordinates: [5.4667, 51.4416],
    },
    imageryGeometry: undefined,
    yearBuilt: 1998,
    floorAreaM2: 120,
    status: 'active',
    officialValuation: 475000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    hasListing: true,
    hasActiveListing: true,
    marketState: 'for-sale',
    latestListingStatus: 'active',
    askingPrice: 499000,
    thumbnailUrl: 'https://cdn.example.com/listing-thumb.jpg',
    socialScore: 9,
    recentSocialScore: 3,
    lastSocialAt: '2026-04-05T12:00:00.000Z',
    topLevelCommentCount: 3,
    replyCount: 5,
    propertyLikeCount: 11,
    commentLikeCount: 7,
    guessCount: 4,
    viewCount: 20,
    uniqueViewerCount: 12,
    recentTopLevelCommentCount: 1,
    recentReplyCount: 2,
    recentPropertyLikeCount: 3,
    recentCommentLikeCount: 2,
    recentGuessCount: 1,
    recentViewCount: 6,
    recentUniqueViewerCount: 4,
    savedAt: '2026-04-06T12:00:00.000Z',
    isSaved: true,
    ...overrides,
  };
}

describe('transformSavedProperty', () => {
  it('derives aerial imagery while keeping listing thumbnails separate', () => {
    const property = createSavedProperty();

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBe(property.thumbnailUrl);
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(property.geometry, property.countryCode as CountryCode)
    );
  });

  it('prefers imageryGeometry when deriving aerial imagery', () => {
    const property = createSavedProperty({
      id: 'a0000000-0000-4000-a000-000000000002',
      imageryGeometry: {
        type: 'Point',
        coordinates: [5.4675, 51.4421],
      },
      thumbnailUrl: null,
    });

    const transformed = transformSavedProperty(property);

    expect(transformed.thumbnailUrl).toBeNull();
    expect(transformed.aerialImageUrl).toBe(
      getPropertyAerialImageFromGeometry(
        property.imageryGeometry,
        property.countryCode as CountryCode
      )
    );
  });

  it('counts replies inside the saved-property comment total', () => {
    const property = createSavedProperty({
      topLevelCommentCount: 2,
      replyCount: 4,
    });

    const transformed = transformSavedProperty(property);

    expect(transformed.commentCount).toBe(6);
  });

  it('does not mark one-view recent activity as hot', () => {
    const property = createSavedProperty({
      hasActiveListing: false,
      socialScore: 0.5,
      recentSocialScore: 0.5,
    });

    const transformed = transformSavedProperty(property);

    expect(transformed.activityLevel).toBe('warm');
  });
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('useSavedProperties', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockFetch.mockReset();
    mockAuthUser = { id: 'viewer-1' };
    mockAccessToken = 'token-viewer-1';
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('token-viewer-1');
  });

  it('uses viewer-sensitive saved-property cache keys', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [createSavedProperty()],
        total: 1,
        hasMore: false,
      }),
    });

    const firstHook = renderHook(() => useSavedProperties(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(firstHook.result.current.isSuccess).toBe(true);
    });

    expect(
      queryClient.getQueryData(savedPropertyKeys.list('auth:viewer-1')),
    ).toBeDefined();

    mockAuthUser = null;
    mockAccessToken = null;

    const signedOutHook = renderHook(() => useSavedProperties(), {
      wrapper: createWrapper(queryClient),
    });

    expect(signedOutHook.result.current.data).toBeUndefined();
    expect(
      queryClient.getQueryData(savedPropertyKeys.list('anon')),
    ).toBeUndefined();

    mockAuthUser = { id: 'viewer-2' };
    mockAccessToken = 'token-viewer-2';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          createSavedProperty({
            id: 'a0000000-0000-4000-a000-000000000099',
            address: 'Otherstraat 5, 5611 AA Eindhoven',
          }),
        ],
        total: 1,
        hasMore: false,
      }),
    });

    const secondHook = renderHook(() => useSavedProperties(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(secondHook.result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData(savedPropertyKeys.list('auth:viewer-1')),
    ).not.toEqual(
      queryClient.getQueryData(savedPropertyKeys.list('auth:viewer-2')),
    );
  });

  it('uses a fresh token even when the auth snapshot token is empty', async () => {
    mockAccessToken = null;
    mockGetAccessToken.mockResolvedValueOnce('fresh-viewer-token');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [createSavedProperty()],
        total: 1,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useSavedProperties(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/saved-properties?limit=20&offset=0',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer fresh-viewer-token',
        },
      }),
    );
  });
});

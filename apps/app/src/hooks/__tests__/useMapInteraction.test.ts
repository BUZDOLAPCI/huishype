import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import {
  useMapInteraction,
  getActivityLevel,
  estimateZoomForBbox,
} from '../useMapInteraction';
import type { MapCameraCommands, PreviewGroup } from '../useMapInteraction';
import type { NearbyPropertyGroup, PropertyResolveResult } from '../../utils/api';
import { PREVIEW_CARD_VIEWPORT_ANCHOR } from '../../lib/mapCameraAnchor';
import { fetchBatchProperties } from '../../utils/api';
import {
  getPropertyAerialImageFromGeometry,
} from '../../lib/propertyThumbnail';
import { useProperty } from '../useProperties';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

jest.mock('../useProperties', () => {
  const actual = jest.requireActual('../useProperties');
  return {
    ...actual,
    useProperty: jest.fn(() => ({
      data: null,
      isLoading: false,
    })),
  };
});

// Mock the AuthProvider context
const mockUser = { id: 'user-123', email: 'test@test.com', displayName: 'Test User' };
let mockAuthUser: typeof mockUser | null = mockUser;

jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: mockAuthUser,
    isAuthenticated: !!mockAuthUser,
    accessToken: mockAuthUser ? 'mock-token' : null,
    isLoading: false,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    signOut: jest.fn(),
    getAccessToken: jest.fn(),
    refreshAuth: jest.fn(),
  }),
}));

// Mock API
jest.mock('../../utils/api', () => {
  const actual = jest.requireActual('../../utils/api');
  return {
    ...actual,
    API_URL: 'http://localhost:3100',
    api: {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    },
    apiFetch: jest.fn(),
    fetchBatchProperties: jest.fn().mockResolvedValue([]),
    fetchNearbyGroup: jest.fn().mockResolvedValue(null),
  };
});

const mockFetchBatchProperties = fetchBatchProperties as jest.Mock;

// Mock propertyThumbnail
jest.mock('../../lib/propertyThumbnail', () => ({
  getPropertyAerialImageFromGeometry: jest.fn().mockReturnValue('https://mock-aerial.com/img.jpg'),
  getPropertyThumbnailFromGeometry: jest.fn().mockReturnValue('https://mock-thumbnail.com/img.jpg'),
}));

const mockUseProperty = useProperty as jest.Mock;

type MockBottomSheetHandle = {
  expand: jest.Mock;
  collapse: jest.Mock;
  close: jest.Mock;
  snapToIndex: jest.Mock;
  openFromPreview: jest.Mock;
  scrollToComments: jest.Mock;
  scrollToGuess: jest.Mock;
  getCurrentIndex: jest.Mock;
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function createMockCamera(): MapCameraCommands {
  return {
    flyTo: jest.fn(),
    fitBounds: jest.fn(),
  };
}

async function flushPreviewFlight() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

describe('getActivityLevel', () => {
  it('returns "hot" for scores >= 50', () => {
    expect(getActivityLevel(50)).toBe('hot');
    expect(getActivityLevel(100)).toBe('hot');
  });

  it('returns "warm" for active scores below hot', () => {
    expect(getActivityLevel(0.75)).toBe('warm');
    expect(getActivityLevel(1)).toBe('warm');
    expect(getActivityLevel(49)).toBe('warm');
  });

  it('returns "cold" for scores below the active threshold', () => {
    expect(getActivityLevel(0)).toBe('cold');
    expect(getActivityLevel(0.1)).toBe('cold');
  });

  it('returns "cold" for negative scores', () => {
    expect(getActivityLevel(-5)).toBe('cold');
  });
});

describe('estimateZoomForBbox', () => {
  it('returns a reasonable zoom for a small bbox', () => {
    // Small bbox (~0.001 degree span)
    const zoom = estimateZoomForBbox(5.0, 51.0, 5.001, 51.001);
    expect(zoom).toBeGreaterThan(15);
  });

  it('returns a lower zoom for a large bbox', () => {
    // Large bbox (~1 degree span)
    const zoom = estimateZoomForBbox(4.0, 50.0, 5.0, 51.0);
    expect(zoom).toBeLessThan(10);
  });

  it('handles zero-span bbox gracefully', () => {
    const zoom = estimateZoomForBbox(5.0, 51.0, 5.0, 51.0);
    expect(Number.isFinite(zoom)).toBe(true);
  });
});

describe('useMapInteraction', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockAuthUser = mockUser;
    jest.clearAllMocks();
    mockRouterPush.mockReset();
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: false,
    });
    mockFetchBatchProperties.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('selection state', () => {
    it('initializes with no selection', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();
      expect(result.current.currentPreviewIndex).toBe(0);
    });

    it('allows setting selectedPropertyId', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setSelectedPropertyId('property-1');
      });

      expect(result.current.selectedPropertyId).toBe('property-1');
    });

    it('allows setting preview group', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const group: PreviewGroup = {
        properties: [{
          id: 'prop-1',
          address: '123 Main St',
          city: 'Amsterdam',
        }],
        coordinate: [4.9, 52.37],
      };

      act(() => {
        result.current.setPreviewGroup(group);
      });

      expect(result.current.previewGroup).toEqual(group);
    });
  });

  describe('auth modal state', () => {
    it('initializes with auth modal hidden', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.showAuthModal).toBe(false);
      expect(result.current.authCopy).toEqual({
        title: 'Welcome to HuisHype',
        subtitle: 'Sign in to continue',
      });
    });

    it('handleAuthRequired shows modal with custom contextual copy', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAuthRequired({
          title: 'Ignored title',
          subtitle: 'Save your reactions and follow homes you care about.',
        });
      });

      expect(result.current.showAuthModal).toBe(true);
      expect(result.current.authCopy).toEqual({
        title: 'Welcome to HuisHype',
        subtitle: 'Save your reactions and follow homes you care about.',
      });
    });

    it('handleAuthModalClose hides modal', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAuthRequired();
      });
      expect(result.current.showAuthModal).toBe(true);

      act(() => {
        result.current.handleAuthModalClose();
      });
      expect(result.current.showAuthModal).toBe(false);
    });

    it('handleAuthSuccess hides modal', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAuthRequired();
      });

      act(() => {
        result.current.handleAuthSuccess();
      });
      expect(result.current.showAuthModal).toBe(false);
    });

    it('handleAuthStarting preserves selection for post-login continuation', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      // Set up some state first
      act(() => {
        result.current.setSelectedPropertyId('prop-1');
        result.current.setHighlightedCoordinate([4.9, 52.37]);
        result.current.setPreviewGroup({
          properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
          coordinate: [4.9, 52.37],
        });
      });

      act(() => {
        result.current.handleAuthStarting();
      });

      expect(result.current.selectedPropertyId).toBe('prop-1');
      expect(result.current.previewGroup).toEqual({
        properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
        coordinate: [4.9, 52.37],
      });
    });

    it('keeps sheet content available after auth start when query data lingers', () => {
      mockUseProperty.mockReturnValue({
        data: {
          id: 'prop-1',
          address: 'Teststraat 1',
          city: 'Eindhoven',
          postalCode: '5611AA',
          countryCode: 'NL',
          geometry: { type: 'Point', coordinates: [5.47, 51.44] },
          officialValuation: 350000,
          askingPrice: 375000,
          fmv: null,
          aerialImageUrl: null,
          thumbnailUrl: null,
          yearBuilt: 1998,
          floorAreaM2: 120,
          likeCount: 0,
          commentCount: 0,
          guessCount: 0,
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setSelectedPropertyId('prop-1');
      });

      act(() => {
        result.current.handleAuthStarting();
      });

      expect(result.current.selectedPropertyId).toBe('prop-1');
      expect(result.current.selectedPropertyForSheet?.id).toBe('prop-1');
    });

    it('resetTransientUI clears modal, preview selection, and sheet index', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAuthRequired('Sign in to continue');
        result.current.setSelectedPropertyId('prop-1');
        result.current.setHighlightedCoordinate([4.9, 52.37]);
        result.current.setPreviewGroup({
          properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
          coordinate: [4.9, 52.37],
        });
        result.current.handleSheetIndexChange(2);
      });

      act(() => {
        result.current.resetTransientUI();
      });

      expect(result.current.showAuthModal).toBe(false);
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();
      expect(result.current.highlightedCoordinate).toBeNull();
      expect(result.current.sheetIndexRef.current).toBe(-1);
    });
  });

  describe('bottom sheet state', () => {
    it('tracks sheet index', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleSheetIndexChange(1);
      });

      expect(result.current.sheetIndexRef.current).toBe(1);
      expect(result.current.sheetIndex).toBe(1);
    });

    it('handleSheetClose does not clear preview (persistence rule)', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
          coordinate: [4.9, 52.37],
        });
      });

      act(() => {
        result.current.handleSheetClose();
      });

      // Preview should persist when sheet is dismissed
      expect(result.current.previewGroup).not.toBeNull();
    });
  });

  describe('preview card interaction', () => {
    it('handleClosePreview clears the preview group and selection', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setSelectedPropertyId('prop-1');
        result.current.setPreviewGroup({
          properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
          coordinate: [4.9, 52.37],
        });
      });

      act(() => {
        result.current.handleClosePreview();
      });

      expect(result.current.previewGroup).toBeNull();
      expect(result.current.highlightedCoordinate).toBeNull();
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.currentPreviewIndex).toBe(0);
    });

    it('handleClosePreview resets clustered preview pagination for same-property reselects', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [
            { id: 'prop-1', address: 'A', city: 'A' },
            { id: 'prop-2', address: 'B', city: 'B' },
          ],
          coordinate: [4.9, 52.37],
        });
        result.current.setCurrentPreviewIndex(1);
      });

      expect(result.current.selectedPropertyId).toBe('prop-2');

      act(() => {
        result.current.handleClosePreview();
      });

      expect(result.current.previewGroup).toBeNull();
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.currentPreviewIndex).toBe(0);
    });

    it('handlePreviewPropertyTap updates selected property and opens sheet from the top', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });
      const openFromPreview = jest.fn();
      const snapToIndex = jest.fn();

      act(() => {
        (result.current.bottomSheetRef as React.MutableRefObject<MockBottomSheetHandle | null>).current = {
          expand: jest.fn(),
          collapse: jest.fn(),
          close: jest.fn(),
          snapToIndex,
          openFromPreview,
          scrollToComments: jest.fn(),
          scrollToGuess: jest.fn(),
          getCurrentIndex: jest.fn().mockReturnValue(0),
        };
      });

      act(() => {
        result.current.handlePreviewPropertyTap({
          id: 'prop-2',
          address: '456 Oak Ave',
          city: 'Rotterdam',
        });
      });

      expect(result.current.selectedPropertyId).toBe('prop-2');
      expect(openFromPreview).toHaveBeenCalledTimes(1);
      expect(snapToIndex).not.toHaveBeenCalled();
    });

    it('syncs selectedPropertyId with currentPreviewIndex', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [
            { id: 'prop-1', address: 'A', city: 'A' },
            { id: 'prop-2', address: 'B', city: 'B' },
          ],
          coordinate: [4.9, 52.37],
        });
      });

      // Initially index 0, so selected should be prop-1
      expect(result.current.selectedPropertyId).toBe('prop-1');

      act(() => {
        result.current.setCurrentPreviewIndex(1);
      });

      // After changing index, selected should sync to prop-2
      expect(result.current.selectedPropertyId).toBe('prop-2');
    });

    it('aligns cluster selection before opening comments for a specific property', async () => {
      mockUseProperty.mockImplementation((propertyId: string | null) => ({
        data: propertyId
          ? {
              id: propertyId,
              address: propertyId === 'prop-2' ? '456 Oak Ave' : '123 Main St',
              city: 'Rotterdam',
              postalCode: '3011AA',
              countryCode: 'NL',
              geometry: { type: 'Point', coordinates: [4.48, 51.92] },
              officialValuation: 420000,
              askingPrice: 445000,
              fmv: null,
              aerialImageUrl: null,
              thumbnailUrl: null,
              yearBuilt: 1995,
              floorAreaM2: 110,
              likeCount: 4,
              commentCount: 6,
              guessCount: 2,
            }
          : null,
        isLoading: false,
      }));

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const openFromPreview = jest.fn();
      const scrollToComments = jest.fn();

      act(() => {
        (result.current.bottomSheetRef as React.MutableRefObject<MockBottomSheetHandle | null>).current = {
          expand: jest.fn(),
          collapse: jest.fn(),
          close: jest.fn(),
          snapToIndex: jest.fn(),
          openFromPreview,
          scrollToComments,
          scrollToGuess: jest.fn(),
          getCurrentIndex: jest.fn().mockReturnValue(-1),
        };
        result.current.setPreviewGroup({
          properties: [
            { id: 'prop-1', address: '123 Main St', city: 'Rotterdam', coordinate: [4.47, 51.92] },
            { id: 'prop-2', address: '456 Oak Ave', city: 'Rotterdam', coordinate: [4.48, 51.92] },
          ],
          coordinate: [4.47, 51.92],
        });
      });

      act(() => {
        result.current.handleComment({
          id: 'prop-2',
          address: '456 Oak Ave',
          city: 'Rotterdam',
          coordinate: [4.48, 51.92],
        });
      });

      expect(result.current.currentPreviewIndex).toBe(1);
      expect(result.current.selectedPropertyId).toBe('prop-2');
      expect(openFromPreview).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(scrollToComments).toHaveBeenCalledTimes(1);
      });
    });

    it('creates a single-property preview when an ambient bubble opens comments', async () => {
      mockUseProperty.mockImplementation((propertyId: string | null) => ({
        data: propertyId
          ? {
              id: propertyId,
              address: 'Stationsplein 1',
              city: 'Eindhoven',
              postalCode: '5611AB',
              countryCode: 'NL',
              geometry: { type: 'Point', coordinates: [5.48, 51.44] },
              officialValuation: 385000,
              askingPrice: 399000,
              fmv: null,
              aerialImageUrl: null,
              thumbnailUrl: null,
              yearBuilt: 2002,
              floorAreaM2: 96,
              likeCount: 3,
              commentCount: 8,
              guessCount: 1,
            }
          : null,
        isLoading: false,
      }));

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const openFromPreview = jest.fn();
      const scrollToComments = jest.fn();

      act(() => {
        (result.current.bottomSheetRef as React.MutableRefObject<MockBottomSheetHandle | null>).current = {
          expand: jest.fn(),
          collapse: jest.fn(),
          close: jest.fn(),
          snapToIndex: jest.fn(),
          openFromPreview,
          scrollToComments,
          scrollToGuess: jest.fn(),
          getCurrentIndex: jest.fn().mockReturnValue(-1),
        };
      });

      act(() => {
        result.current.handleComment({
          id: 'prop-9',
          address: 'Stationsplein 1',
          city: 'Eindhoven',
          coordinate: [5.48, 51.44],
        });
      });

      expect(result.current.previewGroup).toMatchObject({
        properties: [{
          id: 'prop-9',
          address: 'Stationsplein 1',
          city: 'Eindhoven',
          coordinate: [5.48, 51.44],
        }],
        coordinate: [5.48, 51.44],
      });
      expect(result.current.highlightedCoordinate).toEqual([5.48, 51.44]);
      expect(result.current.selectedPropertyId).toBe('prop-9');
      expect(openFromPreview).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(scrollToComments).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('empty map tap (dismissal rules)', () => {
    it('dismisses preview and clears selection when sheet is closed (index <= 0)', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setSelectedPropertyId('prop-1');
        result.current.setPreviewGroup({
          properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
          coordinate: [4.9, 52.37],
        });
      });

      // Sheet at index -1 (closed)
      act(() => {
        result.current.handleSheetIndexChange(-1);
      });

      act(() => {
        result.current.handleEmptyMapTap();
      });

      expect(result.current.previewGroup).toBeNull();
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.currentPreviewIndex).toBe(0);
    });

    it('keeps preview when sheet is expanded (index > 0)', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const group: PreviewGroup = {
        properties: [{ id: 'prop-1', address: 'Test', city: 'Test' }],
        coordinate: [4.9, 52.37],
      };

      act(() => {
        result.current.setPreviewGroup(group);
        result.current.handleSheetIndexChange(2); // expanded
      });

      act(() => {
        result.current.handleEmptyMapTap();
      });

      // Preview should persist when sheet is expanded
      expect(result.current.previewGroup).not.toBeNull();
    });
  });

  describe('handleFeaturePress', () => {
    it('handles single property feature', async () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        properties: {
          node_class: 'active',
          group_kind: 'single',
          primary_property_id: 'prop-1',
          id: 'prop-1',
          point_count: 1,
          property_ids: 'prop-1',
          preview_property_ids: 'prop-1',
          address: '123 Main St',
          city: 'Amsterdam',
          activityScore: 25,
        },
      };

      let handled = false;
      await act(async () => {
        handled = await result.current.handleFeaturePress([feature], 15, camera);
      });

      expect(handled).toBe(true);
      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 15,
        duration: 500,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });
      expect(result.current.highlightedCoordinate).toEqual([4.9, 52.37]);
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();

      await flushPreviewFlight();

      expect(result.current.selectedPropertyId).toBe('prop-1');
      expect(result.current.previewGroup).not.toBeNull();
      expect(result.current.previewGroup!.coordinate).toEqual([4.9, 52.37]);
      expect(result.current.previewGroup!.properties[0]?.nodeClass).toBe('active');
    });

    it('returns false for empty features array', async () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      let handled = false;
      await act(async () => {
        handled = await result.current.handleFeaturePress([], 15, camera);
      });

      expect(handled).toBe(false);
    });

    it('opens preview for dense clusters instead of zooming away', async () => {
      jest.useFakeTimers();
      mockFetchBatchProperties.mockResolvedValue([
        {
          id: 'p1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          yearBuilt: 1998,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 250000,
          hasListing: true,
          hasActiveListing: true,
          marketState: 'for-sale',
          askingPrice: 300000,
          socialScore: 7,
          recentSocialScore: 0,
          likeCount: 3,
          commentCount: 5,
          guessCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        properties: {
          node_class: 'active',
          group_kind: 'cluster',
          primary_property_id: 'p1',
          point_count: 50, // > LARGE_CLUSTER_THRESHOLD (30)
          property_ids: 'p1,p2,p3',
          preview_property_ids: 'p1,p2,p3',
          bbox_west: 4.8,
          bbox_south: 52.3,
          bbox_east: 5.0,
          bbox_north: 52.4,
        },
      };

      await act(async () => {
        await result.current.handleFeaturePress([feature], 10, camera);
      });

      expect(camera.fitBounds).not.toHaveBeenCalled();
      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 10,
        duration: 500,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });

      await flushPreviewFlight();

      expect(result.current.previewGroup?.properties[0]).toMatchObject({
        id: 'p1',
        nodeClass: 'active',
        askingPrice: 300000,
        officialValuation: 250000,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
        activityScore: 7,
        activityLevel: 'warm',
      });
    });

    it('defers incomplete pyramid clusters with empty previews to the nearby fallback', async () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        properties: {
          node_class: 'active',
          group_kind: 'cluster',
          primary_property_id: 'p1',
          point_count: 50,
          property_ids: 'p1,p2,p3',
          preview_property_ids: '',
          membership_complete: 'false',
          read_state_coverage: 'partial',
          pyramid_version_id: 'v1',
          pyramid_node_id: 'n1',
          bbox_west: 4.8,
          bbox_south: 52.3,
          bbox_east: 5.0,
          bbox_north: 52.4,
        },
      };

      let handled = true;
      await act(async () => {
        handled = await result.current.handleFeaturePress([feature], 10, camera);
      });

      expect(handled).toBe(false);
      expect(mockFetchBatchProperties).not.toHaveBeenCalled();
      expect(camera.flyTo).not.toHaveBeenCalled();
      expect(camera.fitBounds).not.toHaveBeenCalled();
      expect(result.current.previewGroup).toBeNull();
    });
  });

  describe('handleNearbyResult', () => {
    it('handles single property result', () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const nearby: NearbyPropertyGroup = {
        nodeClass: 'active',
        groupKind: 'single',
        primaryPropertyId: 'prop-1',
        pointCount: 1,
        propertyIds: ['prop-1'],
        previewPropertyIds: ['prop-1'],
        pyramidVersionId: null,
        pyramidNodeId: null,
        membershipComplete: true,
        readStateCoverage: 'complete',
        coordinate: [4.9, 52.37],
        bbox: null,
        activeListingCount: 1,
        socialCount: 2,
        recentSocialCount: 1,
        socialScoreTotal: 25,
        socialScoreMax: 25,
        recentSocialScoreTotal: 10,
        address: '123 Main St',
        city: 'Amsterdam',
        postalCode: '1012AB',
        countryCode: 'NL',
        hasActiveListing: true,
        marketState: 'for-sale',
        hasListing: true,
        activityScore: 25,
        activityScoreTotal: 25,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
        streetName: 'Main St',
        houseNumber: 123,
        houseNumberAddition: null,
        officialValuation: 250000,
        askingPrice: 300000,
        thumbnailUrl: null,
        distanceMeters: 10,
        yearBuilt: null,
        floorAreaM2: null,
        isRead: false,
      };

      act(() => {
        result.current.handleNearbyResult(nearby, 15, camera);
      });

      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 15,
        duration: 500,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });
      expect(result.current.highlightedCoordinate).toEqual([4.9, 52.37]);
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();

      act(() => {
        jest.runOnlyPendingTimers();
      });

      expect(result.current.selectedPropertyId).toBe('prop-1');
      expect(result.current.previewGroup).not.toBeNull();
      expect(result.current.previewGroup!.coordinate).toEqual([4.9, 52.37]);
      expect(result.current.previewGroup!.properties[0]?.nodeClass).toBe('active');
    });

    it('opens preview for dense nearby clusters', async () => {
      jest.useFakeTimers();
      mockFetchBatchProperties.mockResolvedValue([
        {
          id: 'p1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          yearBuilt: 1998,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 250000,
          hasListing: true,
          hasActiveListing: true,
          marketState: 'for-sale',
          askingPrice: 300000,
          socialScore: 7,
          recentSocialScore: 0,
          likeCount: 3,
          commentCount: 5,
          guessCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const nearby: NearbyPropertyGroup = {
        nodeClass: 'active',
        groupKind: 'cluster',
        primaryPropertyId: 'p1',
        pointCount: 50,
        propertyIds: ['p1', 'p2', 'p3'],
        previewPropertyIds: ['p1', 'p2', 'p3'],
        pyramidVersionId: null,
        pyramidNodeId: null,
        membershipComplete: true,
        readStateCoverage: 'complete',
        coordinate: [4.9, 52.37],
        bbox: { west: 4.8, south: 52.3, east: 5.0, north: 52.4 },
        activeListingCount: 2,
        socialCount: 5,
        recentSocialCount: 3,
        socialScoreTotal: 60,
        socialScoreMax: 30,
        recentSocialScoreTotal: 18,
        hasActiveListing: true,
        marketState: null,
        hasListing: true,
        activityScore: 60,
        activityScoreTotal: 60,
        likeCount: 0,
        commentCount: 0,
        guessCount: 0,
        streetName: null,
        houseNumber: null,
        houseNumberAddition: null,
        address: null,
        city: null,
        postalCode: null,
        countryCode: null,
        officialValuation: null,
        askingPrice: null,
        thumbnailUrl: null,
        distanceMeters: 10,
        yearBuilt: null,
        floorAreaM2: null,
        isRead: false,
      };

      await act(async () => {
        result.current.handleNearbyResult(nearby, 10, camera);
      });

      expect(camera.fitBounds).not.toHaveBeenCalled();
      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 10,
        duration: 500,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });

      await flushPreviewFlight();

      expect(result.current.previewGroup?.properties[0]).toMatchObject({
        id: 'p1',
        nodeClass: 'active',
        askingPrice: 300000,
        officialValuation: 250000,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
        activityScore: 7,
        activityLevel: 'warm',
      });
    });
  });

  describe('openClusterPreviewAtCoord', () => {
    it('preserves stat pills and pricing data for grouped previews', async () => {
      mockFetchBatchProperties.mockResolvedValue([
        {
          id: 'prop-1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          yearBuilt: 1998,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 250000,
          hasListing: true,
          hasActiveListing: true,
          marketState: 'for-sale',
          askingPrice: 300000,
          socialScore: 7,
          recentSocialScore: 0,
          likeCount: 3,
          commentCount: 5,
          guessCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.openClusterPreviewAtCoord(['prop-1'], [4.9, 52.37]);
      });

      expect(result.current.previewGroup?.properties[0]).toMatchObject({
        id: 'prop-1',
        nodeClass: undefined,
        askingPrice: 300000,
        officialValuation: 250000,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
        activityScore: 7,
        activityLevel: 'warm',
      });
    });

    it('preserves ghost class for grouped previews opened from ghost clusters', async () => {
      mockFetchBatchProperties.mockResolvedValue([
        {
          id: 'ghost-1',
          nationalId: null,
          countryCode: 'NL',
          address: 'Quiet Lane 1',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          yearBuilt: 1998,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 250000,
          hasListing: false,
          hasActiveListing: false,
          marketState: 'not-listed',
          socialScore: 0,
          recentSocialScore: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.openClusterPreviewAtCoord(['ghost-1'], [4.9, 52.37], 'ghost');
      });

      expect(result.current.previewGroup?.properties[0]).toMatchObject({
        id: 'ghost-1',
        nodeClass: 'ghost',
      });
    });
  });

  describe('search callbacks', () => {
    it('handlePropertyResolved flies to coordinate and sets preview', () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const property: PropertyResolveResult = {
        id: 'prop-1',
        address: '123 Main St',
        city: 'Amsterdam',
        postalCode: '1012AB',
        countryCode: 'NL',
        officialValuation: 250000,
        officialValuationYear: 2024,
        officialValuationSourceFetch: {
          source: 'woz',
          expectedValuationYear: 2024,
          supportsClientFetch: {
            web: true,
            native: true,
          },
        },
        hasActiveListing: true,
        marketState: 'for-sale',
        coordinates: { lon: 4.9, lat: 52.37 },
      };
      const resolvedAddress = {
        bagId: 'addr-1',
        formattedAddress: '123 Main St, 1012AB Amsterdam',
        lat: 52.37,
        lon: 4.9,
        details: {
          city: 'Amsterdam',
          zip: '1012AB',
          street: 'Main St',
          number: '123',
          houseNumber: '123',
          houseNumberAddition: null,
          countryCode: 'NL',
        },
      };

      act(() => {
        result.current.handlePropertyResolved(property, camera, resolvedAddress);
      });

      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 18,
        duration: 1000,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });
      expect(result.current.highlightedCoordinate).toEqual([4.9, 52.37]);
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();

      act(() => {
        jest.runOnlyPendingTimers();
      });

      expect(result.current.selectedPropertyId).toBe('prop-1');
      expect(result.current.previewGroup).not.toBeNull();
      expect(result.current.previewGroup?.properties[0]).toMatchObject({
        hasActiveListing: true,
        activityLevel: 'warm',
      });
      expect(getPropertyAerialImageFromGeometry).toHaveBeenLastCalledWith(
        { type: 'Point', coordinates: [4.9, 52.37] },
        'NL',
      );
    });

    it('ignores resolved properties that do not have coordinates', () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();

      act(() => {
        result.current.handlePropertyResolved(
          {
            id: 'prop-missing-coords',
            address: 'Unknown',
            city: 'Eindhoven',
            postalCode: '5611AA',
            coordinates: null,
            hasActiveListing: false,
            marketState: 'not-listed',
          } as PropertyResolveResult,
          camera,
        );
      });

      expect(camera.flyTo).not.toHaveBeenCalled();
      expect(result.current.highlightedCoordinate).toBeNull();
      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();
    });

    it('handleLocationResolved flies to coordinate without setting preview', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();

      act(() => {
        result.current.handleLocationResolved(
          { lon: 4.9, lat: 52.37 },
          'Amsterdam',
          camera,
        );
      });

      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 18,
        duration: 1000,
      });
      // Location resolve doesn't set preview group
      expect(result.current.previewGroup).toBeNull();
    });
  });

  describe('quick-action navigation handlers', () => {
    it('handleGuessPress navigates to the canonical guesses route', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-123',
            address: 'Routelaan 12',
            city: 'Eindhoven',
            postalCode: '5600 AA',
            countryCode: 'NL',
          }],
          coordinate: [5.4697, 51.4416],
        });
      });

      act(() => {
        result.current.handleGuessPress('prop-123');
      });

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/eindhoven/5600aa/routelaan/12/guesses?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12',
      );
    });

    it('handleCommentPress navigates to the canonical comments route', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-456',
            address: 'Routelaan 12',
            city: 'Eindhoven',
            postalCode: '5600 AA',
            countryCode: 'NL',
          }],
          coordinate: [5.4697, 51.4416],
        });
      });

      act(() => {
        result.current.handleCommentPress('prop-456');
      });

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/eindhoven/5600aa/routelaan/12/comments?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12',
      );
    });
  });

  describe('toGroupProperty', () => {
    it('converts a property-like object to GroupPreviewProperty', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const gpp = result.current.toGroupProperty({
        id: 'prop-1',
        address: '123 Main St',
        city: 'Amsterdam',
        postalCode: '1012AB',
        officialValuation: 250000,
        askingPrice: 300000,
        activityScore: 60,
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        yearBuilt: 1920,
        floorAreaM2: 85,
      });

      expect(gpp.id).toBe('prop-1');
      expect(gpp.activityLevel).toBe('hot'); // score 60 >= 50
      expect(gpp.activityScore).toBe(60);
      expect(gpp.thumbnailUrl).toBeNull();
      expect(gpp.aerialImageUrl).toBe('https://mock-aerial.com/img.jpg');
      expect(gpp.yearBuilt).toBe(1920);
      expect(gpp.floorAreaM2).toBe(85);
    });

    it('preserves listing thumbnails separately from aerial fallbacks', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const gpp = result.current.toGroupProperty({
        id: 'prop-1',
        address: '123 Main St',
        city: 'Amsterdam',
        thumbnailUrl: 'https://cdn.example.com/listing-thumb.jpg',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
      });

      expect(gpp.thumbnailUrl).toBe('https://cdn.example.com/listing-thumb.jpg');
      expect(gpp.aerialImageUrl).toBe('https://mock-aerial.com/img.jpg');
    });

    it('prefers imageryGeometry when building a thumbnail', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.toGroupProperty({
        id: 'prop-2',
        address: '123 Main St',
        city: 'Amsterdam',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        imageryGeometry: { type: 'Point', coordinates: [4.91, 52.38] },
      });

      expect(getPropertyAerialImageFromGeometry).toHaveBeenLastCalledWith(
        { type: 'Point', coordinates: [4.91, 52.38] },
        undefined,
      );
    });

    it('uses explicit activityScore parameter over property field', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const gpp = result.current.toGroupProperty(
        { id: 'prop-1', address: 'A', city: 'B', activityScore: 10 },
        75,
      );

      expect(gpp.activityScore).toBe(75);
      expect(gpp.activityLevel).toBe('hot');
    });

    it('derives warm activity for listing-backed previews even without social score', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const gpp = result.current.toGroupProperty({
        id: 'prop-2',
        address: 'Listingstraat 4',
        city: 'Eindhoven',
        hasActiveListing: true,
      });

      expect(gpp.activityLevel).toBe('warm');
      expect(gpp.hasActiveListing).toBe(true);
    });

    it('keeps a one-view-only preview quiet', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const gpp = result.current.toGroupProperty({
        id: 'prop-view-only',
        address: 'Kijklaan 5',
        city: 'Eindhoven',
        socialScore: 0.1,
        recentSocialScore: 0.1,
      });

      expect(gpp.socialScore).toBe(0.1);
      expect(gpp.recentSocialScore).toBe(0.1);
      expect(gpp.activityLevel).toBe('cold');
    });

    it('reuses the preview aerial image for the sheet property when available', async () => {
      mockUseProperty.mockReturnValue({
        data: {
          id: 'prop-1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          imageryGeometry: { type: 'Point', coordinates: [4.91, 52.38] },
          yearBuilt: 1920,
          floorAreaM2: 85,
          status: 'active',
          officialValuation: 250000,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-1',
            address: '123 Main St',
            city: 'Amsterdam',
            thumbnailUrl: null,
            aerialImageUrl: 'https://preview-cache.test/pdok.png',
          }],
          coordinate: [4.9, 52.37],
        });
      });

      await waitFor(() => {
        expect(result.current.selectedPropertyForSheet?.aerialImageUrl).toBe(
          'https://preview-cache.test/pdok.png',
        );
        expect(result.current.selectedPropertyForSheet?.thumbnailUrl).toBeNull();
      });
    });

    it('upgrades preview thumbnails from the detail query without copying aerial into thumbnailUrl', async () => {
      mockUseProperty.mockReturnValue({
        data: {
          id: 'prop-1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          imageryGeometry: { type: 'Point', coordinates: [4.91, 52.38] },
          yearBuilt: 1920,
          floorAreaM2: 85,
          status: 'active',
          officialValuation: 250000,
          thumbnailUrl: 'https://cdn.example.com/listing.jpg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-1',
            address: '123 Main St',
            city: 'Amsterdam',
            thumbnailUrl: null,
            aerialImageUrl: 'https://preview-cache.test/pdok.png',
          }],
          coordinate: [4.9, 52.37],
        });
      });

      await waitFor(() => {
        expect(result.current.selectedPropertyForSheet?.thumbnailUrl).toBe(
          'https://cdn.example.com/listing.jpg',
        );
        expect(result.current.previewGroup?.properties[0]?.thumbnailUrl).toBe(
          'https://cdn.example.com/listing.jpg',
        );
        expect(result.current.previewGroup?.properties[0]?.aerialImageUrl).toBe(
          'https://preview-cache.test/pdok.png',
        );
      });
    });

    it('hydrates preview pricing and counts from the detail query', async () => {
      mockUseProperty.mockReturnValue({
        data: {
          id: 'prop-1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          imageryGeometry: null,
          yearBuilt: 1920,
          floorAreaM2: 85,
          status: 'active',
          officialValuation: 425000,
          askingPrice: 449000,
          activityLevel: 'hot',
          fmv: {
            fmv: 431000,
            confidence: 'medium',
            guessCount: 12,
            distribution: null,
            officialValuation: 425000,
            askingPrice: 449000,
            divergence: -4,
          },
          likeCount: 7,
          commentCount: 2,
          topLevelCommentCount: 2,
          replyCount: 1,
          guessCount: 12,
          thumbnailUrl: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-1',
            address: '123 Main St',
            city: 'Amsterdam',
            postalCode: '1012AB',
            countryCode: 'NL',
            officialValuation: null,
            askingPrice: null,
            activityLevel: 'warm',
            activityScore: 7,
            fmv: null,
            likeCount: 0,
            commentCount: 0,
            guessCount: 0,
            thumbnailUrl: null,
            aerialImageUrl: 'https://preview-cache.test/pdok.png',
          }],
          coordinate: [4.9, 52.37],
        });
      });

      await waitFor(() => {
        expect(result.current.previewGroup?.properties[0]).toMatchObject({
          officialValuation: 425000,
          askingPrice: 449000,
          fmv: 431000,
          likeCount: 7,
          commentCount: 3,
          guessCount: 12,
          aerialImageUrl: 'https://preview-cache.test/pdok.png',
          activityLevel: 'hot',
          activityScore: 7,
        });
      });
    });

    it('replaces neutral bootstrap activity with hydrated server activity', async () => {
      mockUseProperty.mockReturnValue({
        data: {
          id: 'prop-1',
          nationalId: null,
          countryCode: 'NL',
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          imageryGeometry: null,
          yearBuilt: 1920,
          floorAreaM2: 85,
          status: 'active',
          officialValuation: 425000,
          askingPrice: 449000,
          socialScore: 64,
          recentSocialScore: 18,
          activityLevel: 'hot',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.setPreviewGroup({
          properties: [{
            id: 'prop-1',
            address: '123 Main St',
            city: 'Amsterdam',
          }],
          coordinate: [4.9, 52.37],
        });
      });

      await waitFor(() => {
        expect(result.current.previewGroup?.properties[0]).toMatchObject({
          socialScore: 64,
          recentSocialScore: 18,
          activityLevel: 'hot',
        });
      });
    });
  });
});

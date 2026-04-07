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
import type { NearbyClusterResult } from '../../utils/api';
import { PREVIEW_CARD_VIEWPORT_ANCHOR } from '../../lib/mapCameraAnchor';
import { fetchBatchProperties } from '../../utils/api';
import {
  getPropertyAerialImageFromGeometry,
} from '../../lib/propertyThumbnail';
import { useProperty } from '../useProperties';

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
jest.mock('../../utils/api', () => ({
  API_URL: 'http://localhost:3100',
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  apiFetch: jest.fn(),
  fetchBatchProperties: jest.fn().mockResolvedValue([]),
  fetchNearbyCluster: jest.fn().mockResolvedValue(null),
}));

const mockFetchBatchProperties = fetchBatchProperties as jest.Mock;

// Mock propertyThumbnail
jest.mock('../../lib/propertyThumbnail', () => ({
  getPropertyAerialImageFromGeometry: jest.fn().mockReturnValue('https://mock-aerial.com/img.jpg'),
  getPropertyThumbnailFromGeometry: jest.fn().mockReturnValue('https://mock-thumbnail.com/img.jpg'),
}));

const mockUseProperty = useProperty as jest.Mock;

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

  it('returns "warm" for scores > 0 and < 50', () => {
    expect(getActivityLevel(1)).toBe('warm');
    expect(getActivityLevel(49)).toBe('warm');
  });

  it('returns "cold" for score 0', () => {
    expect(getActivityLevel(0)).toBe('cold');
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
      expect(result.current.authMessage).toBe('Sign in to continue');
    });

    it('handleAuthRequired shows modal with custom message', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAuthRequired('Sign in to like this property');
      });

      expect(result.current.showAuthModal).toBe(true);
      expect(result.current.authMessage).toBe('Sign in to like this property');
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

    it('handleAuthStarting clears selection and closes sheet', () => {
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

      expect(result.current.selectedPropertyId).toBeNull();
      expect(result.current.previewGroup).toBeNull();
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

    it('handlePreviewPropertyTap updates selected property and opens sheet', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handlePreviewPropertyTap({
          id: 'prop-2',
          address: '456 Oak Ave',
          city: 'Rotterdam',
        });
      });

      expect(result.current.selectedPropertyId).toBe('prop-2');
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
          id: 'prop-1',
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

    it('zooms into large cluster bbox', async () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
        properties: {
          point_count: 50, // > LARGE_CLUSTER_THRESHOLD (30)
          bbox_west: 4.8,
          bbox_south: 52.3,
          bbox_east: 5.0,
          bbox_north: 52.4,
        },
      };

      await act(async () => {
        await result.current.handleFeaturePress([feature], 10, camera);
      });

      // Should have called camera.fitBounds or camera.flyTo
      const calledFit = (camera.fitBounds as jest.Mock).mock.calls.length > 0;
      const calledFly = (camera.flyTo as jest.Mock).mock.calls.length > 0;
      expect(calledFit || calledFly).toBe(true);
    });
  });

  describe('handleNearbyResult', () => {
    it('handles single property result', () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const nearby: NearbyClusterResult = {
        type: 'single',
        id: 'prop-1',
        address: '123 Main St',
        city: 'Amsterdam',
        postalCode: '1012AB',
        officialValuation: 250000,
        hasListing: true,
        askingPrice: 300000,
        thumbnailUrl: null,
        activityScore: 25,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
        distanceMeters: 10,
        geometry: { type: 'Point', coordinates: [4.9, 52.37] },
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
    });

    it('zooms into large cluster', () => {
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      const camera = createMockCamera();
      const nearby: NearbyClusterResult = {
        type: 'cluster',
        point_count: 50,
        property_ids: 'p1,p2,p3',
        coordinate: [4.9, 52.37],
        distanceMeters: 10,
        bbox: [4.8, 52.3, 5.0, 52.4],
      };

      act(() => {
        result.current.handleNearbyResult(nearby, 10, camera);
      });

      const calledFit = (camera.fitBounds as jest.Mock).mock.calls.length > 0;
      const calledFly = (camera.flyTo as jest.Mock).mock.calls.length > 0;
      expect(calledFit || calledFly).toBe(true);
    });
  });

  describe('openClusterPreviewAtCoord', () => {
    it('preserves stat pills and pricing data for grouped previews', async () => {
      mockFetchBatchProperties.mockResolvedValue([
        {
          id: 'prop-1',
          nationalId: null,
          address: '123 Main St',
          city: 'Amsterdam',
          postalCode: '1012AB',
          geometry: { type: 'Point', coordinates: [4.9, 52.37] },
          yearBuilt: 1998,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 250000,
          hasListing: true,
          askingPrice: 300000,
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
        askingPrice: 300000,
        officialValuation: 250000,
        likeCount: 3,
        commentCount: 5,
        guessCount: 2,
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
      const property = {
        id: 'prop-1',
        address: '123 Main St',
        city: 'Amsterdam',
        postalCode: '1012AB',
        officialValuation: 250000,
        hasListing: true,
        coordinates: { lon: 4.9, lat: 52.37 },
      };

      act(() => {
        result.current.handlePropertyResolved(property, camera);
      });

      expect(camera.flyTo).toHaveBeenCalledWith({
        center: [4.9, 52.37],
        zoom: 17,
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
        zoom: 17,
        duration: 1000,
      });
      // Location resolve doesn't set preview group
      expect(result.current.previewGroup).toBeNull();
    });
  });

  describe('quick-action navigation handlers', () => {
    it('handleGuessPress navigates to /guesses/:propertyId', () => {
      const { router } = require('expo-router');
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleGuessPress('prop-123');
      });

      expect(router.push).toHaveBeenCalledWith('/guesses/prop-123');
    });

    it('handleCommentPress navigates to /comments/:propertyId', () => {
      const { router } = require('expo-router');
      const { result } = renderHook(() => useMapInteraction(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleCommentPress('prop-456');
      });

      expect(router.push).toHaveBeenCalledWith('/comments/prop-456');
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
  });
});

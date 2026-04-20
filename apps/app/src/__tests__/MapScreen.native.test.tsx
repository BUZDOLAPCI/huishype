import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetBounds = jest.fn(async () => [4.8, 52.3, 5.0, 52.4]);
const globalWithDev = globalThis as typeof globalThis & { __DEV__?: boolean };
const originalFetch = globalThis.fetch;
const originalDev = globalWithDev.__DEV__;
globalWithDev.__DEV__ = false;
const mockNativeStyleJson: Record<string, unknown> = {
  version: 8,
  sources: {
    'properties-source': {
      type: 'vector',
      tiles: ['https://tiles.test/native'],
    },
  },
  layers: [],
};
let mockIsAuthenticated = true;
let mockFollowingViewportIsError = false;
let mockFollowingViewportData: Array<{
  id: string;
  coordinate: [number, number];
  address: string;
  city: string;
  postalCode: string | null;
  countryCode: string;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean;
  marketState: 'for-sale';
  activityTypes: ['comment'];
  actorCount: number;
  lastActivityAt: string;
}> = [];
type UseFollowingViewport = typeof import('@/src/hooks/useProperties').useFollowingViewport;
let capturedMapFilterBarProps:
  | {
      socialScope?: 'all' | 'following';
      onToggleFollowing?: () => void;
    }
  | null = null;
const mockAmbientCommentBubbles = {
  bubbles: [] as unknown[],
  clearBubbles: jest.fn(),
  refreshBubbles: jest.fn(),
};

const mockInteraction = {
  bottomSheetRef: { current: { close: jest.fn() } },
  handleAuthRequired: jest.fn(),
  handleFeaturePress: jest.fn(),
  handleFollowingOverlayPress: jest.fn(),
  handleEmptyMapTap: jest.fn(),
  resetTransientUI: jest.fn(),
  highlightedCoordinate: null,
  setHighlightedCoordinate: jest.fn(),
  setSelectedPropertyId: jest.fn(),
  selectedProperty: null,
  selectedPropertyForSheet: null,
  selectedPropertyLoading: false,
  sheetIndex: -1,
  sheetIndexRef: { current: -1 },
  handleSheetClose: jest.fn(),
  handleSheetIndexChange: jest.fn(),
  previewGroup: null,
  setPreviewGroup: jest.fn(),
  currentPreviewIndex: 0,
  setCurrentPreviewIndex: jest.fn(),
  handleClosePreview: jest.fn(),
  handlePreviewPropertyTap: jest.fn(),
  handleLike: jest.fn(),
  handleComment: jest.fn(),
  handleGuess: jest.fn(),
  isLiked: false,
  isSaved: false,
  toggleLike: jest.fn(),
  toggleSave: jest.fn(),
  handleSave: jest.fn(),
  handleShare: jest.fn(),
  handleGuessPress: jest.fn(),
  handleCommentPress: jest.fn(),
  handlePropertyResolved: jest.fn(),
  handleLocationResolved: jest.fn(),
  handleNearbyResult: jest.fn(),
  openClusterPreviewAtCoord: jest.fn(),
  showAuthModal: false,
  handleAuthModalClose: jest.fn(),
  authCopy: undefined,
  handleAuthSuccess: jest.fn(),
  handleAuthStarting: jest.fn(),
  toGroupProperty: jest.fn((property) => property),
};

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect: () => void | (() => void)) => {
    const ReactModule = require('react') as typeof import('react');
    ReactModule.useEffect(() => effect(), []);
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(() => ({
    isAuthenticated: mockIsAuthenticated,
  })),
}));

jest.mock('@/src/components', () => {
  const ReactModule = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    PropertyBottomSheet: ReactModule.forwardRef(() => null),
    AuthModal: () => null,
    SearchBar: () => null,
    BottomSheetErrorBoundary: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    GroupPreviewCard: () => ReactModule.createElement(View, null),
  };
});

jest.mock('@/src/components/AmbientCommentBubble', () => ({
  AmbientCommentBubble: () => null,
  AMBIENT_COMMENT_BUBBLE_HEIGHT: 120,
  AMBIENT_COMMENT_BUBBLE_WIDTH: 200,
  getAmbientCommentBubbleArrowLayout: jest.fn(() => ({
    anchorOffsetX: 0,
    arrowHorizontalAlign: 'center',
  })),
}));

jest.mock('@/src/components/navigation/MapHeaderRow', () => ({
  MapHeaderRow: () => null,
}));

jest.mock('@/src/components/navigation/MapGradient', () => ({
  MapGradient: () => null,
}));

jest.mock('@/src/components/navigation/LocationButton', () => ({
  LocationButton: () => null,
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => null,
}));

jest.mock('@/src/components/map/MapFilterBar', () => ({
  MapFilterBar: (props: typeof capturedMapFilterBarProps) => {
    capturedMapFilterBarProps = props;
    return null;
  },
}));

jest.mock('@/src/hooks/useMapInteraction', () => ({
  useMapInteraction: jest.fn(() => mockInteraction),
}));

jest.mock('@/src/hooks/useAmbientCommentBubbles', () => ({
  useAmbientCommentBubbles: jest.fn(() => mockAmbientCommentBubbles),
  toAmbientBubbleVisibleNode: jest.fn((node) => node),
}));

const mockUseFollowingViewport = jest.fn(
  (_bounds: unknown, _filters: unknown, _enabled: unknown) => ({
    data: mockFollowingViewportData,
    isLoading: false,
    isError: mockFollowingViewportIsError,
    error: mockFollowingViewportIsError ? new Error('Following viewport failed') : null,
    refetch: jest.fn(),
  }),
);

jest.mock('@/src/hooks/useProperties', () => {
  return {
    useFollowingViewport: jest.fn((
      bounds: Parameters<UseFollowingViewport>[0],
      filters: Parameters<UseFollowingViewport>[1],
      enabled: Parameters<UseFollowingViewport>[2],
    ) => mockUseFollowingViewport(bounds, filters, enabled)),
  };
});

jest.mock('@/src/hooks/useMapCityName', () => ({
  useMapCityName: jest.fn(() => ({
    cityName: null,
    setSearchCity: jest.fn(),
    onViewportCenterChanged: jest.fn(),
  })),
  extractCityFromAddress: jest.fn(() => null),
}));

jest.mock('@/src/hooks/useMapFilterController', () => ({
  useMapFilterController: jest.fn(() => ({
    appliedFilters: {
      salePriceFrom: null,
      salePriceTo: null,
      rentPriceFrom: null,
      rentPriceTo: null,
      marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
      activity: 'all',
    },
  })),
}));

jest.mock('@/src/utils/api', () => ({
  ...jest.requireActual('@/src/utils/api'),
  API_URL: 'http://api.test',
}));

jest.mock('@/src/lib/sharedMapFilters', () => ({
  ...jest.requireActual('@/src/lib/sharedMapFilters'),
  buildPropertyTileTemplateUrl: jest.fn(() => 'https://tiles.test/native'),
}));

jest.mock('@/src/lib/currentLocation', () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock('@maplibre/maplibre-react-native', () => {
  const ReactModule = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  type MockMapProps = {
    children?: React.ReactNode;
    onDidFinishLoadingMap?: () => void;
  };
  type MockMapRef = {
    queryRenderedFeatures: jest.Mock;
    project: jest.Mock;
    getBounds: typeof mockGetBounds;
    getCenter: jest.Mock;
  };

  const Map = ReactModule.forwardRef<MockMapRef, MockMapProps>((props, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      queryRenderedFeatures: jest.fn(),
      project: jest.fn(async () => [0, 0]),
      getBounds: mockGetBounds,
      getCenter: jest.fn(async () => [4.9, 52.37]),
    }));

    ReactModule.useEffect(() => {
      props.onDidFinishLoadingMap?.();
    }, [props]);

    return ReactModule.createElement(View, { testID: 'native-map' }, props.children);
  });

  const Camera = ReactModule.forwardRef(() => null);
  const Marker = ({ children }: { children?: React.ReactNode }) =>
    ReactModule.createElement(View, null, children);

  return {
    Map,
    Camera,
    Marker,
    UserLocation: () => null,
    LogManager: { setLogLevel: jest.fn() },
  };
});

const MapScreen = require('@/app/(tabs)/index').default as typeof import('@/app/(tabs)/index').default;

describe('MapScreen native following mode', () => {
  async function renderMapScreen() {
    const screen = render(<MapScreen />);

    await act(async () => {
      fireEvent(screen.getByTestId('map-viewport'), 'layout', {
        nativeEvent: { layout: { width: 390, height: 844 } },
      });

      await Promise.resolve();
    });

    return screen;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = true;
    mockFollowingViewportIsError = false;
    mockFollowingViewportData = [];
    capturedMapFilterBarProps = null;
    mockAmbientCommentBubbles.bubbles = [];
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({
        json: async () => mockNativeStyleJson,
      })),
    });
    (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__ = [];
    Object.defineProperty(globalThis, '__DEV__', {
      configurable: true,
      writable: true,
      value: false,
    });
  });

  afterEach(() => {
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { fetch?: typeof fetch },
        'fetch',
      );
    }
    Reflect.deleteProperty(
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      },
      '__HUISHYPE_ANALYTICS_EVENTS__',
    );
    if (typeof originalDev === 'boolean') {
      globalWithDev.__DEV__ = originalDev;
    } else {
      Reflect.deleteProperty(globalWithDev, '__DEV__');
    }
  });

  it('keeps following as app-local native state and emits enabled plus empty analytics', async () => {
    await renderMapScreen();

    await waitFor(() => {
      expect(mockGetBounds).toHaveBeenCalled();
    });

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    await waitFor(() => {
      expect(capturedMapFilterBarProps?.socialScope).toBe('following');
    });

    expect(mockUseFollowingViewport).toHaveBeenLastCalledWith(
      { west: 4.8, south: 52.3, east: 5.0, north: 52.4 },
      {
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
        activity: 'all',
      },
      true,
    );

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    expect(analyticsEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'map_following_filter_enabled' }),
        expect.objectContaining({ name: 'map_following_filter_empty_viewed' }),
      ]),
    );
  });

  it('auth-gates signed-out following toggles without switching state or emitting analytics', async () => {
    mockIsAuthenticated = false;

    const screen = await renderMapScreen();

    await waitFor(() => {
      expect(capturedMapFilterBarProps).not.toBeNull();
    });

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    expect(capturedMapFilterBarProps?.socialScope).toBe('all');
    expect(mockInteraction.handleAuthRequired).toHaveBeenCalledWith({
      subtitle: 'Sign in to see homes with activity from people you follow.',
    });
    expect(screen.queryByTestId('map-following-state-signed-out')).toBeNull();
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__,
    ).toEqual([]);
  });

  it('shows an error state instead of the empty-state path when the following overlay query fails', async () => {
    mockFollowingViewportIsError = true;

    const screen = await renderMapScreen();

    await waitFor(() => {
      expect(mockGetBounds).toHaveBeenCalled();
    });

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    await waitFor(() => {
      expect(capturedMapFilterBarProps?.socialScope).toBe('following');
    });

    expect(screen.getByTestId('map-following-state-error')).toBeTruthy();
    expect(screen.queryByTestId('map-following-state-empty')).toBeNull();
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__?.map((event) => event.name),
    ).toEqual(['map_following_filter_enabled']);
  });

  it('emits click-through analytics and opens the overlay property from native following markers', async () => {
    mockFollowingViewportData = [
      {
        id: 'property-9',
        coordinate: [5.47, 51.44],
        address: 'Stationsplein 9',
        city: 'Eindhoven',
        postalCode: '5611AA',
        countryCode: 'NL',
        askingPrice: 450000,
        thumbnailUrl: null,
        hasActiveListing: true,
        marketState: 'for-sale',
        activityTypes: ['comment'],
        actorCount: 2,
        lastActivityAt: '2026-04-19T10:00:00.000Z',
      },
    ];

    const screen = await renderMapScreen();

    await waitFor(() => {
      expect(mockGetBounds).toHaveBeenCalled();
    });

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    const marker = await screen.findByTestId('map-following-marker-property-9');
    fireEvent.press(marker);

    expect(mockInteraction.handleFollowingOverlayPress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'property-9' }),
      expect.any(Number),
      expect.any(Object),
    );

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
          name: string;
          properties: Record<string, unknown>;
        }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    expect(analyticsEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'map_property_click_through_from_following_filter',
          properties: expect.objectContaining({
            propertyId: 'property-9',
          }),
        }),
      ]),
    );
  });
});

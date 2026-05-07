import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetBounds = jest.fn(async () => [4.8, 52.3, 5.0, 52.4]);
const mockGetCenter = jest.fn(async () => [4.9, 52.37]);
const mockProject = jest.fn(async () => [0, 0]);
const mockQueryRenderedFeatures = jest.fn(async (): Promise<unknown[]> => []);
const mockNetworkManagerAddRequestHeader = jest.fn();
const mockNetworkManagerRemoveRequestHeader = jest.fn();

const globalWithDev = globalThis as typeof globalThis & { __DEV__?: boolean };
const originalFetch = globalThis.fetch;
const originalDev = globalWithDev.__DEV__;

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
let mockFollowingTileSourceIsError = false;
let mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
const mockFollowingTileRefetch = jest.fn();
let mockReadTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
let mockReadCacheBustedTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
let mockReadHeaderName: 'Authorization' | 'x-session-id' = 'x-session-id';
let mockReadHeaderValue = 'session-123';
const mockReadTileRefetch = jest.fn();
const mockRecordPropertyView = jest.fn();
const mockFetchNearbyGroup = jest.fn();
const mockFetchFollowingNearbyGroup = jest.fn();
const mockWelcomeOpen = jest.fn();
const mockWelcomeDismiss = jest.fn();
let mockWelcomeVisible = false;
let mockIsFocused = true;
let mockViewportCountryCode: string | null = 'NL';
const mockSetSearchCity = jest.fn();
const mockOnViewportCenterChanged = jest.fn();
const mockCameraFlyTo = jest.fn();
const mockCameraFitBounds = jest.fn();

let capturedMapFilterBarProps: {
  socialScope?: 'all' | 'following';
  followingActivity?: 'today' | '10d' | '30d' | 'all-time';
  onToggleFollowing?: () => void;
  onFollowingActivityChange?: (activity: 'today' | '10d' | '30d' | 'all-time') => void;
} | null = null;
let capturedSearchBarProps: {
  searchBias?: {
    lon?: number;
    lat?: number;
    countryCode?: string | null;
  };
} | null = null;

const mockAmbientCommentBubbles = {
  bubbles: [] as unknown[],
  clearBubbles: jest.fn(),
  refreshBubbles: jest.fn(),
};

const mockInteraction = {
  bottomSheetRef: { current: { close: jest.fn() } },
  handleAuthRequired: jest.fn(),
  handleFeaturePress: jest.fn(),
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
    ReactModule.useEffect(() => effect(), [effect]);
  }),
  useIsFocused: jest.fn(() => mockIsFocused),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(() => ({
    accessToken: mockIsAuthenticated ? 'viewer-token' : null,
    getAccessToken: jest.fn(async () => (mockIsAuthenticated ? 'viewer-token' : null)),
    isAuthenticated: mockIsAuthenticated,
  })),
}));

jest.mock('@/src/components', () => {
  const ReactModule = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
    PropertyBottomSheet: ReactModule.forwardRef(() => null),
    AuthModal: () => null,
    WelcomeModal: ({ visible }: { visible: boolean }) =>
      visible ? ReactModule.createElement(View, { testID: 'welcome-modal' }) : null,
    SearchBar: (props: typeof capturedSearchBarProps) => {
      capturedSearchBarProps = props;
      return null;
    },
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

jest.mock('@/src/components/map/MapWelcomeInfoButton', () => ({
  MapWelcomeInfoButton: ({ onPress }: { onPress: () => void }) => {
    const ReactModule = require('react') as typeof import('react');
    const { Pressable } = require('react-native') as typeof import('react-native');
    return ReactModule.createElement(Pressable, {
      onPress,
      testID: 'map-welcome-info-button',
    });
  },
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

jest.mock('@/src/components/map/FollowingMapStateCard', () => ({
  FollowingMapStateCard: ({ mode }: { mode: string }) => {
    const ReactModule = require('react') as typeof import('react');
    const { View } = require('react-native') as typeof import('react-native');
    return ReactModule.createElement(View, { testID: `map-following-state-${mode}` });
  },
}));

jest.mock('@/src/hooks/useMapInteraction', () => ({
  useMapInteraction: jest.fn(() => mockInteraction),
}));

jest.mock('@/src/hooks/useWelcomeModal', () => ({
  useWelcomeModal: jest.fn(() => ({
    visible: mockWelcomeVisible,
    open: mockWelcomeOpen,
    dismiss: mockWelcomeDismiss,
    isHydrated: true,
  })),
}));

jest.mock('@/src/hooks/useAmbientCommentBubbles', () => ({
  useAmbientCommentBubbles: jest.fn(() => mockAmbientCommentBubbles),
  toAmbientBubbleVisibleNode: jest.fn((node) => node),
}));

const mockUseFollowingTileSource = jest.fn(
  (_filters: unknown, _followingActivity: unknown, _enabled: unknown) => ({
    data: mockFollowingTileUrl
      ? {
          tileJsonUrl: 'http://api.test/tiles/following/properties.json',
          tileUrl: mockFollowingTileUrl,
          tileJson: { tiles: [mockFollowingTileUrl] },
        }
      : undefined,
    isLoading: false,
    isError: mockFollowingTileSourceIsError,
    error: mockFollowingTileSourceIsError ? new Error('Following tile source failed') : null,
    refetch: mockFollowingTileRefetch,
  })
);

jest.mock('@/src/hooks/useFollowingTileSource', () => ({
  useFollowingTileSource: jest.fn(
    (filters: unknown, followingActivity: unknown, enabled: unknown) =>
      mockUseFollowingTileSource(filters, followingActivity, enabled)
  ),
}));

const mockUseReadTileSource = jest.fn((_filters: unknown, _enabled: unknown) => ({
  data: mockReadTileUrl
    ? {
        tileJsonUrl: 'http://api.test/tiles/properties/read.json',
        tileUrl: mockReadTileUrl,
        cacheBustedTileUrl: mockReadCacheBustedTileUrl,
        tileJson: { tiles: [mockReadTileUrl] },
        headerName: mockReadHeaderName,
        headerValue: mockReadHeaderValue,
        version: 0,
      }
    : undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: mockReadTileRefetch,
}));

jest.mock('@/src/hooks/useReadTileSource', () => ({
  useReadTileSource: jest.fn((filters: unknown, enabled: unknown) =>
    mockUseReadTileSource(filters, enabled)
  ),
}));

jest.mock('@/src/hooks/usePropertyView', () => ({
  usePropertyView: jest.fn(() => ({
    recordPropertyView: mockRecordPropertyView,
  })),
}));

jest.mock('@/src/hooks/useMapCityName', () => ({
  useMapCityName: jest.fn(() => ({
    cityName: null,
    countryCode: mockViewportCountryCode,
    setSearchCity: mockSetSearchCity,
    onViewportCenterChanged: mockOnViewportCenterChanged,
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
  fetchNearbyGroup: jest.fn((...args: unknown[]) => mockFetchNearbyGroup(...args)),
  fetchFollowingNearbyGroup: jest.fn((...args: unknown[]) =>
    mockFetchFollowingNearbyGroup(...args)
  ),
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
  const { Pressable, View } = require('react-native') as typeof import('react-native');

  type MockMapProps = {
    children?: React.ReactNode;
    onDidFinishLoadingMap?: () => void;
    onDidFinishRenderingMapFully?: () => void;
    onPress?: (event: unknown) => void;
    onRegionDidChange?: (event: unknown) => void;
  };

  const Map = ReactModule.forwardRef<unknown, MockMapProps>((props, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      queryRenderedFeatures: mockQueryRenderedFeatures,
      project: mockProject,
      getBounds: mockGetBounds,
      getCenter: mockGetCenter,
    }));

    ReactModule.useEffect(() => {
      props.onDidFinishLoadingMap?.();
    }, [props]);

    const pressableProps = {
      testID: 'native-map',
      onDidFinishRenderingMapFully: props.onDidFinishRenderingMapFully,
      onPress: props.onPress,
      onRegionDidChange: props.onRegionDidChange,
    } as unknown as React.ComponentProps<typeof Pressable>;

    return ReactModule.createElement(Pressable, pressableProps, props.children);
  });

  const Camera = ReactModule.forwardRef((_, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      flyTo: mockCameraFlyTo,
      fitBounds: mockCameraFitBounds,
    }));
    return null;
  });
  const Marker = ({ children }: { children?: React.ReactNode }) =>
    ReactModule.createElement(View, null, children);

  return {
    Map,
    Camera,
    Marker,
    UserLocation: () => null,
    LogManager: { setLogLevel: jest.fn() },
    NetworkManager: {
      addRequestHeader: (...args: unknown[]) => mockNetworkManagerAddRequestHeader(...args),
      removeRequestHeader: (...args: unknown[]) => mockNetworkManagerRemoveRequestHeader(...args),
    },
  };
});

const MapScreen = require('@/app/(tabs)/index')
  .default as typeof import('@/app/(tabs)/index').default;
const { getCurrentLocation: mockGetCurrentLocation } = jest.requireMock('@/src/lib/currentLocation') as {
  getCurrentLocation: jest.Mock;
};

describe('MapScreen native grouped Following mode', () => {
  async function renderMapScreen() {
    const screen = render(<MapScreen />);

    await act(async () => {
      fireEvent(screen.getByTestId('map-viewport'), 'layout', {
        nativeEvent: { layout: { width: 390, height: 844 } },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    return screen;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockIsAuthenticated = true;
    mockIsFocused = true;
    mockFollowingTileSourceIsError = false;
    mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
    mockReadTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
    mockReadCacheBustedTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
    mockReadHeaderName = 'x-session-id';
    mockReadHeaderValue = 'session-123';
    mockWelcomeVisible = false;
    mockViewportCountryCode = 'NL';
    mockSetSearchCity.mockReset();
    mockOnViewportCenterChanged.mockReset();
    mockRecordPropertyView.mockReset();
    capturedMapFilterBarProps = null;
    capturedSearchBarProps = null;
    mockAmbientCommentBubbles.bubbles = [];
    Object.assign(mockInteraction, {
      previewGroup: null,
      currentPreviewIndex: 0,
      selectedPropertyForSheet: null,
      selectedProperty: null,
    });
    mockQueryRenderedFeatures.mockReset();
    mockQueryRenderedFeatures.mockResolvedValue([]);
    mockProject.mockReset();
    mockProject.mockResolvedValue([0, 0]);
    mockGetBounds.mockClear();
    mockGetCenter.mockClear();
    mockFetchNearbyGroup.mockReset();
    mockFetchFollowingNearbyGroup.mockReset();
    mockInteraction.handleFeaturePress.mockReset();
    mockInteraction.handleFeaturePress.mockResolvedValue(false);
    mockCameraFlyTo.mockReset();
    mockCameraFitBounds.mockReset();
    mockGetCurrentLocation.mockReset();
    mockGetCurrentLocation.mockResolvedValue({
      longitude: 4.9041,
      latitude: 52.3676,
    });

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
    jest.useRealTimers();
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    } else {
      Reflect.deleteProperty(globalThis as typeof globalThis & { fetch?: typeof fetch }, 'fetch');
    }

    Reflect.deleteProperty(
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      },
      '__HUISHYPE_ANALYTICS_EVENTS__'
    );

    if (typeof originalDev === 'boolean') {
      globalWithDev.__DEV__ = originalDev;
    } else {
      Reflect.deleteProperty(globalWithDev, '__DEV__');
    }
  });

  it('enables grouped Following tiles and configures native tile auth headers', async () => {
    await renderMapScreen();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(capturedMapFilterBarProps?.socialScope).toBe('following');
    expect(mockUseFollowingTileSource).toHaveBeenLastCalledWith(
      {
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
        activity: 'all',
      },
      'all-time',
      true
    );
    expect(mockNetworkManagerAddRequestHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer viewer-token',
      expect.any(RegExp)
    );
  });

  it('configures native read overlay session headers only for the read tile pattern', async () => {
    mockIsAuthenticated = false;

    await renderMapScreen();

    await waitFor(() => {
      expect(mockUseReadTileSource).toHaveBeenLastCalledWith(
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: 'all',
        },
        true
      );
    });

    expect(mockNetworkManagerAddRequestHeader).toHaveBeenCalledWith(
      'x-session-id',
      'session-123',
      expect.any(RegExp)
    );

    const addCall = mockNetworkManagerAddRequestHeader.mock.calls.find(
      ([headerName]) => headerName === 'x-session-id',
    );
    const pattern = addCall?.[2] as RegExp;
    expect(pattern.test('https://tiles.test/properties/read/12/2048/1363.pbf')).toBe(true);
    expect(pattern.test('https://tiles.test/properties/12/2048/1363.pbf')).toBe(false);
  });

  it('does not refetch the merged native style when only the cache-busted read tile URL changes', async () => {
    const screen = await renderMapScreen();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    mockReadCacheBustedTileUrl =
      'https://tiles.test/properties/read/{z}/{x}/{y}.pbf?readVersion=1';

    await act(async () => {
      screen.rerender(<MapScreen />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('records active preview properties as read', async () => {
    Object.assign(mockInteraction, {
      previewGroup: {
        properties: [{
          id: 'active-property',
          nodeClass: 'active',
          address: 'Active Street 1',
          city: 'Eindhoven',
        }],
        coordinate: [5.47, 51.44],
      },
      currentPreviewIndex: 0,
    });

    await renderMapScreen();

    expect(mockRecordPropertyView).toHaveBeenCalledWith('active-property');
  });

  it('renders the welcome info button and opens the welcome modal from it', async () => {
    const screen = await renderMapScreen();

    fireEvent.press(screen.getByTestId('map-welcome-info-button'));

    expect(mockWelcomeOpen).toHaveBeenCalledTimes(1);
  });

  it('passes settled viewport search bias to the native SearchBar', async () => {
    const screen = await renderMapScreen();

    expect(capturedSearchBarProps?.searchBias).toEqual({
      lon: 5.3574841,
      lat: 52.3626765,
      countryCode: 'NL',
    });

    fireEvent(screen.getByTestId('native-map'), 'regionDidChange', {
      nativeEvent: {
        center: [4.8952, 52.3702],
        zoom: 14,
      },
    });

    await waitFor(() => {
      expect(capturedSearchBarProps?.searchBias).toEqual({
        lon: 4.8952,
        lat: 52.3702,
        countryCode: 'NL',
      });
    });
    expect(mockOnViewportCenterChanged).toHaveBeenCalledWith(4.8952, 52.3702, 14);
  });

  it('shows the welcome modal when first-run state is visible', async () => {
    mockWelcomeVisible = true;

    const screen = await renderMapScreen();

    expect(screen.getByTestId('welcome-modal')).toBeTruthy();
  });

  it('auto-locates after the native map finishes rendering fully', async () => {
    const screen = await renderMapScreen();

    fireEvent(screen.getByTestId('native-map'), 'didFinishRenderingMapFully');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockCameraFlyTo).toHaveBeenCalledWith({
      center: [4.9041, 52.3676],
      zoom: 16,
      pitch: expect.any(Number),
      duration: 800,
    });
  });

  it('auto-locates only once on repeated native full-render events', async () => {
    const screen = await renderMapScreen();

    fireEvent(screen.getByTestId('native-map'), 'didFinishRenderingMapFully');
    fireEvent(screen.getByTestId('native-map'), 'didFinishRenderingMapFully');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockCameraFlyTo).toHaveBeenCalledTimes(1);
  });

  it('does not record ghost preview properties as read', async () => {
    Object.assign(mockInteraction, {
      previewGroup: {
        properties: [{
          id: 'ghost-property',
          nodeClass: 'ghost',
          address: 'Ghost Street 1',
          city: 'Eindhoven',
        }],
        coordinate: [5.47, 51.44],
      },
      currentPreviewIndex: 0,
    });

    await renderMapScreen();

    expect(mockRecordPropertyView).not.toHaveBeenCalled();
  });

  it('shows the empty Following state after rendered grouped feature refresh settles', async () => {
    const screen = await renderMapScreen();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockUseFollowingTileSource).toHaveBeenLastCalledWith(
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: 'all',
        },
        'all-time',
        true
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 950));
    });

    await waitFor(() => {
      expect(mockQueryRenderedFeatures).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('map-following-state-empty')).toBeTruthy();
    });
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'map_following_filter_enabled' }),
        expect.objectContaining({ name: 'map_following_filter_empty_viewed' }),
      ])
    );
  });

  it('shows the error state when the Following tile source fails', async () => {
    mockFollowingTileSourceIsError = true;

    const screen = await renderMapScreen();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('map-following-state-error')).toBeTruthy();
    expect(screen.queryByTestId('map-following-state-empty')).toBeNull();
  });

  it('passes pyramid node identity to public nearby fallback after unresolved feature taps', async () => {
    const pyramidFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.47, 51.44] },
      properties: {
        node_class: 'active',
        group_kind: 'cluster',
        primary_property_id: 'property-9',
        point_count: 40,
        property_ids: '',
        preview_property_ids: '',
        pyramid_version_id: '9007199254740993123',
        pyramid_node_id: '9007199254740993999',
        membership_complete: 'false',
        read_state_coverage: 'partial',
      },
    };

    mockQueryRenderedFeatures.mockResolvedValueOnce([pyramidFeature]);
    mockFetchNearbyGroup.mockResolvedValue({
      nodeClass: 'active',
      groupKind: 'cluster',
      primaryPropertyId: 'property-9',
      pointCount: 40,
      propertyIds: [],
      previewPropertyIds: ['property-9'],
      pyramidVersionId: '9007199254740993123',
      pyramidNodeId: '9007199254740993999',
      membershipComplete: false,
      readStateCoverage: 'partial',
      coordinate: [5.47, 51.44],
      distanceMeters: 0,
      bbox: {
        west: 5.46,
        south: 51.43,
        east: 5.48,
        north: 51.45,
      },
      activeListingCount: 1,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      commentCount: 0,
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
      yearBuilt: null,
      floorAreaM2: null,
      hasActiveListing: false,
      marketState: 'not-listed',
      hasListing: false,
      activityScore: 0,
      activityScoreTotal: 0,
      likeCount: 0,
      guessCount: 0,
    });

    const screen = await renderMapScreen();

    fireEvent(screen.getByTestId('native-map'), 'press', {
      nativeEvent: {
        point: [100, 200],
        lngLat: [5.47, 51.44],
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockInteraction.handleFeaturePress).toHaveBeenCalledWith(
      [pyramidFeature],
      expect.any(Number),
      expect.any(Object)
    );
    expect(mockFetchNearbyGroup).toHaveBeenCalledWith(
      5.47,
      51.44,
      expect.any(Number),
      expect.objectContaining({
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
      }),
      {
        pyramidVersionId: '9007199254740993123',
        pyramidNodeId: '9007199254740993999',
      }
    );
    expect(mockInteraction.handleNearbyResult).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryPropertyId: 'property-9',
        pyramidNodeId: '9007199254740993999',
      }),
      expect.any(Number),
      expect.any(Object)
    );
    expect(mockInteraction.handleEmptyMapTap).not.toHaveBeenCalled();
  });

  it('falls back to /properties/following-nearby after local Following hit-testing misses', async () => {
    mockQueryRenderedFeatures.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockFetchFollowingNearbyGroup.mockResolvedValue({
      nodeClass: 'active',
      groupKind: 'single',
      primaryPropertyId: 'property-9',
      pointCount: 1,
      propertyIds: ['property-9'],
      previewPropertyIds: ['property-9'],
      coordinate: [5.47, 51.44],
      distanceMeters: 12,
      bbox: null,
      activeListingCount: 1,
      socialCount: 2,
      recentSocialCount: 1,
      socialScoreTotal: 14,
      socialScoreMax: 14,
      recentSocialScoreTotal: 6,
      commentCount: 3,
      streetName: 'Stationsplein',
      houseNumber: 9,
      houseNumberAddition: null,
      address: 'Stationsplein 9',
      city: 'Eindhoven',
      postalCode: '5611AA',
      countryCode: 'NL',
      officialValuation: 425000,
      askingPrice: 450000,
      thumbnailUrl: null,
      yearBuilt: 1991,
      floorAreaM2: 123,
      hasActiveListing: true,
      marketState: 'for-sale',
      hasListing: true,
      activityScore: 14,
      activityScoreTotal: 14,
      likeCount: 0,
      guessCount: 0,
    });

    const screen = await renderMapScreen();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent(screen.getByTestId('native-map'), 'press', {
      nativeEvent: {
        point: [100, 200],
        lngLat: [5.47, 51.44],
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockQueryRenderedFeatures).toHaveBeenNthCalledWith(
      1,
      [100, 200],
      expect.objectContaining({ layers: expect.any(Array) })
    );
    expect(mockQueryRenderedFeatures).toHaveBeenNthCalledWith(
      2,
      [
        [72, 172],
        [128, 228],
      ],
      expect.objectContaining({ layers: expect.any(Array) })
    );
    expect(mockFetchFollowingNearbyGroup).toHaveBeenCalledWith(
      5.47,
      51.44,
      expect.any(Number),
      expect.objectContaining({
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
      }),
      'all-time'
    );
    expect(mockInteraction.handleNearbyResult).toHaveBeenCalledWith(
      expect.objectContaining({ primaryPropertyId: 'property-9' }),
      expect.any(Number),
      expect.any(Object)
    );
    expect(mockInteraction.handleEmptyMapTap).not.toHaveBeenCalled();
  });
});

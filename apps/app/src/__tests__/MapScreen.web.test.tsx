import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QUERYABLE_PROPERTY_LAYER_IDS } from '@huishype/shared/config';
import { PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT } from '@/src/lib/propertyTileRetryProtocol';

type MockMapEventHandler = (...args: unknown[]) => void;

type MockMapInstance = {
  options: {
    container: HTMLDivElement;
    center?: [number, number];
    zoom?: number;
    style: {
      sources?: Record<string, { promoteId?: string; tiles?: string[] }>;
    };
    transformRequest?: (url: string) => { url: string; headers?: Record<string, string> };
  };
  style: {
    _clearSource: jest.Mock;
    _reloadSource: jest.Mock;
    _updateSources: jest.Mock;
  };
  keyboard: {
    disableRotation: jest.Mock;
  };
  addControl: jest.Mock;
  addSource: jest.Mock;
  addLayer: jest.Mock;
  removeLayer: jest.Mock;
  removeSource: jest.Mock;
  getContainer: jest.Mock;
  getCanvas: jest.Mock;
  getCenter: jest.Mock;
  getZoom: jest.Mock;
  getBearing: jest.Mock;
  getBounds: jest.Mock;
  getStyle: jest.Mock;
  getPaintProperty: jest.Mock;
  setPaintProperty: jest.Mock;
  setFeatureState: jest.Mock;
  on: jest.Mock;
  once: jest.Mock;
  off: jest.Mock;
  getLayer: jest.Mock;
  getSource: jest.Mock;
  isStyleLoaded: jest.Mock;
  isSourceLoaded: jest.Mock;
  areTilesLoaded: jest.Mock;
  fitBounds: jest.Mock;
  flyTo: jest.Mock;
  jumpTo: jest.Mock;
  project: jest.Mock;
  querySourceFeatures: jest.Mock;
  queryRenderedFeatures: jest.Mock;
  resize: jest.Mock;
  remove: jest.Mock;
  propertySource: {
    serialize: jest.Mock;
    setTiles: jest.Mock;
  };
  trigger: (event: string, payload?: unknown, layerId?: string) => void;
};

let mockAppliedFilters = { tag: 'tile-a' };
let mockIsAuthenticated = true;
let mockAccessToken: string | null = 'viewer-token';
let mockIsFocused = true;
let mockBrowserPathname = '/';
const mockGetAccessToken = jest.fn<Promise<string | null>, []>(async () => 'viewer-token');
let mockFollowingTileSourceIsError = false;
let mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
const mockFollowingTileRefetch = jest.fn();
let mockReadTileUrl: string | null = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
let mockReadCacheBustedTileUrl: string | null = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
let mockReadHeaderName: 'Authorization' | 'x-session-id' = 'x-session-id';
let mockReadHeaderValue = 'session-123';
const mockReadTileRefetch = jest.fn();
const mockRecordPropertyView = jest.fn();
const mockWelcomeOpen = jest.fn();
const mockWelcomeDismiss = jest.fn();
let mockWelcomeVisible = false;
const mockReplaceAppliedFilters = jest.fn();
const mockSetSearchCity = jest.fn();
const mockOnViewportCenterChanged = jest.fn();
const mockReplacePassiveBrowserPath = jest.fn((pathname: string) => !!pathname);
let mockResolvedMapRouteState: {
  isLoading: boolean;
  pathname: string;
  resolvedRoute: null | {
    kind: 'root';
    canonicalPath: '/';
  } | {
    kind: 'camera';
    canonicalPath: string;
    camera: { lat: number; lng: number; zoom: number };
  };
} = {
  isLoading: true,
  pathname: '/',
  resolvedRoute: null,
};
let capturedMapFilterBarProps: {
  socialScope?: 'all' | 'following';
  followingActivity?: 'today' | '10d' | '30d' | 'all-time';
  onPanelOpenChange?: (open: boolean) => void;
  onToggleFollowing?: () => void;
  onFollowingActivityChange?: (activity: 'today' | '10d' | '30d' | 'all-time') => void;
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
  sheetIndex: -1,
  toGroupProperty: jest.fn(),
  setPreviewGroup: jest.fn(),
  setCurrentPreviewIndex: jest.fn(),
  handleLocationResolved: jest.fn(),
  previewGroup: null,
  currentPreviewIndex: 0,
  handleClosePreview: jest.fn(),
  handlePreviewPropertyTap: jest.fn(),
  handleLike: jest.fn(),
  handleComment: jest.fn(),
  handleGuess: jest.fn(),
  isLiked: false,
  selectedPropertyLoading: false,
  isSaved: false,
  handleSheetClose: jest.fn(),
  handleSheetIndexChange: jest.fn(),
  handleSave: jest.fn(),
  handleShare: jest.fn(),
  handleGuessPress: jest.fn(),
  handleCommentPress: jest.fn(),
  showAuthModal: false,
  handleAuthModalClose: jest.fn(),
  authCopy: undefined,
  handleAuthSuccess: jest.fn(),
  handleAuthStarting: jest.fn(),
};

const mockMapInstances: MockMapInstance[] = [];

jest.mock('react-native', () => {
  const ReactModule = require('react') as typeof import('react');

  const createElement = (tag: string) =>
    ReactModule.forwardRef<HTMLElement, React.PropsWithChildren<{ testID?: string }>>(
      (props, ref) => {
        const { children, testID, ...rest } = props;
        return ReactModule.createElement(tag, { ...rest, ref, 'data-testid': testID }, children);
      }
    );

  return {
    Alert: {
      alert: jest.fn(),
    },
    Platform: {
      OS: 'web',
    },
    Pressable: createElement('button'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      absoluteFillObject: {},
    },
    Text: createElement('span'),
    View: createElement('div'),
  };
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect: () => void | (() => void)) => {
    const ReactModule = require('react') as typeof import('react');
    ReactModule.useEffect(() => effect(), [effect]);
  }),
  useIsFocused: jest.fn(() => mockIsFocused),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: jest.fn(),
  },
}));

jest.mock('@/src/components', () => {
  const ReactModule = require('react');
  return {
    AuthModal: () => null,
    WelcomeModal: ({ visible }: { visible: boolean }) =>
      visible ? ReactModule.createElement('div', { 'data-testid': 'welcome-modal' }) : null,
    SearchBar: () => null,
    PropertyBottomSheet: ReactModule.forwardRef(() => null),
  };
});

jest.mock('@/src/components/map/MapFilterBar', () => ({
  MapFilterBar: (props: typeof capturedMapFilterBarProps) => {
    capturedMapFilterBarProps = props;
    return null;
  },
}));

jest.mock('@/src/components/map/FollowingMapStateCard', () => ({
  FollowingMapStateCard: ({ mode }: { mode: string }) => {
    const ReactModule = require('react') as typeof import('react');
    return ReactModule.createElement('div', {
      'data-testid': `map-following-state-${mode}`,
    });
  },
}));

jest.mock('@/src/components/WebPreviewMarkerPortal', () => ({
  WebPreviewMarkerPortal: () => null,
}));

jest.mock('@/src/components/WebAmbientCommentBubblesPortal', () => ({
  WebAmbientCommentBubblesPortal: () => null,
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
    const ReactModule = require('react');
    return ReactModule.createElement('button', {
      onClick: onPress,
      'data-testid': 'map-welcome-info-button',
    });
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
        cacheBustedTileUrl: mockReadCacheBustedTileUrl ?? mockReadTileUrl,
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
    setSearchCity: mockSetSearchCity,
    onViewportCenterChanged: mockOnViewportCenterChanged,
  })),
  extractCityFromAddress: jest.fn(() => null),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(() => ({
    accessToken: mockIsAuthenticated ? mockAccessToken : null,
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
  })),
}));

jest.mock('@/src/hooks/useMapFilterController', () => ({
  useMapFilterController: jest.fn(() => ({
    appliedFilters: mockAppliedFilters,
    replaceAppliedFilters: mockReplaceAppliedFilters,
  })),
}));

jest.mock('@/src/utils/api', () => ({
  ...jest.requireActual('@/src/utils/api'),
  API_URL: 'http://api.test',
  fetchBatchProperties: jest.fn(),
}));

jest.mock('@/src/lib/currentLocation', () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock('@/src/lib/mapRoute', () => ({
  ...jest.requireActual('@/src/lib/mapRoute'),
  clearLocalPreviewRouteCache: jest.fn(),
  extractCanonicalRouteInput: jest.fn(() => null),
  registerLocalPreviewRoute: jest.fn(),
}));

jest.mock('@/src/lib/sharedMapFilters', () => ({
  appendSearchToPath: jest.fn((pathname, search) => `${pathname}${search}`),
  buildPropertyTileTemplateUrl: jest.fn((_apiUrl, filters) => `https://tiles.test/${filters.tag}`),
  createDefaultMapFilters: jest.fn(() => ({ tag: 'default' })),
  doesMapFilterCandidateMatch: jest.fn(() => true),
  getCanonicalMapFilterSignature: jest.fn((filters) => filters.tag),
  getMapFilterSearchString: jest.fn((_filters, currentSearch) => currentSearch),
  parseMapFiltersFromSearchParams: jest.fn(() => ({ tag: 'default' })),
}));

jest.mock('@/src/lib/webMapUrlSync', () => ({
  getCurrentBrowserPathname: jest.fn(() => mockBrowserPathname),
  replacePassiveBrowserPath: jest.fn((pathname: string) => mockReplacePassiveBrowserPath(pathname)),
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: jest.fn(() => mockResolvedMapRouteState),
}));

jest.mock('maplibre-gl', () => {
  const Map = jest.fn().mockImplementation((options) => {
    const listeners = new globalThis.Map<string, MockMapEventHandler[]>();
    const onceListeners = new globalThis.Map<string, MockMapEventHandler[]>();
    let currentTiles = options.style?.sources?.['properties-source']?.tiles?.slice() ?? [];
    let currentReadTiles = options.style?.sources?.['read-properties-source']?.tiles?.slice() ?? [];

    const getKey = (event: string, layerId?: string) => (layerId ? `${event}:${layerId}` : event);

    const addListener = (
      storage: Map<string, MockMapEventHandler[]>,
      event: string,
      layerOrHandler: unknown,
      maybeHandler?: unknown
    ) => {
      const isLayerListener = typeof layerOrHandler === 'string';
      const layerId = isLayerListener ? (layerOrHandler as string) : undefined;
      const handler = (isLayerListener ? maybeHandler : layerOrHandler) as
        | MockMapEventHandler
        | undefined;
      if (!handler) {
        return;
      }

      const key = getKey(event, layerId);
      const queue = storage.get(key) ?? [];
      queue.push(handler);
      storage.set(key, queue);
    };

    const propertySource = {
      serialize: jest.fn(() => ({ tiles: currentTiles })),
      setTiles: jest.fn((tiles: string[]) => {
        currentTiles = tiles.slice();
      }),
    };
    const readPropertySource = {
      serialize: jest.fn(() => ({ tiles: currentReadTiles })),
      setTiles: jest.fn((tiles: string[]) => {
        currentReadTiles = tiles.slice();
      }),
    };

    const canvas = globalThis.document.createElement('canvas');
    canvas.style.cursor = '';
    const internalStyle = {
      _clearSource: jest.fn(),
      _reloadSource: jest.fn(),
      _updateSources: jest.fn(),
    };

    const instance = {} as MockMapInstance;
    Object.assign(instance, {
      options,
      style: internalStyle,
      keyboard: {
        disableRotation: jest.fn(),
      },
      addControl: jest.fn(),
      addSource: jest.fn((sourceId: string, source: { tiles?: string[] }) => {
        if (sourceId === 'read-properties-source') {
          currentReadTiles = source.tiles?.slice() ?? [];
        }
      }),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      removeSource: jest.fn((sourceId: string) => {
        if (sourceId === 'read-properties-source') {
          currentReadTiles = [];
        }
      }),
      getContainer: jest.fn(() => options.container),
      getCanvas: jest.fn(() => canvas),
      getCenter: jest.fn(() => ({ lng: 4.9, lat: 52.37 })),
      getZoom: jest.fn(() => 14),
      getBearing: jest.fn(() => 0),
      getBounds: jest.fn(() => ({
        getWest: () => 4.8,
        getSouth: () => 52.3,
        getEast: () => 5.0,
        getNorth: () => 52.4,
      })),
      getStyle: jest.fn(() => ({ layers: [] })),
      getPaintProperty: jest.fn(() => null),
      setPaintProperty: jest.fn(),
      setFeatureState: jest.fn(),
      on: jest.fn((event: string, layerOrHandler: unknown, maybeHandler?: unknown) => {
        addListener(listeners, event, layerOrHandler, maybeHandler);
        return instance;
      }),
      once: jest.fn((event: string, handler: MockMapEventHandler) => {
        addListener(onceListeners, event, handler);
        return instance;
      }),
      off: jest.fn((event: string, layerOrHandler?: unknown) => {
        const key =
          typeof layerOrHandler === 'string' ? getKey(event, layerOrHandler) : getKey(event);
        if (typeof layerOrHandler === 'function') {
          const currentListeners = listeners.get(key) ?? [];
          listeners.set(
            key,
            currentListeners.filter((listener) => listener !== layerOrHandler),
          );
        } else {
          listeners.delete(key);
        }
        return instance;
      }),
      getLayer: jest.fn(() => false),
      getSource: jest.fn((sourceId: string) => {
        if (sourceId === 'properties-source') {
          return propertySource;
        }
        if (sourceId === 'read-properties-source' && currentReadTiles.length > 0) {
          return readPropertySource;
        }
        return undefined;
      }),
      isStyleLoaded: jest.fn(() => true),
      isSourceLoaded: jest.fn(() => true),
      areTilesLoaded: jest.fn(() => true),
      fitBounds: jest.fn(),
      flyTo: jest.fn(),
      jumpTo: jest.fn(),
      project: jest.fn(() => ({ x: 0, y: 0 })),
      querySourceFeatures: jest.fn(() => []),
      queryRenderedFeatures: jest.fn(() => []),
      resize: jest.fn(),
      remove: jest.fn(),
      propertySource,
      trigger(event: string, payload?: unknown, layerId?: string) {
        const keyedListeners = listeners.get(getKey(event, layerId)) ?? [];
        keyedListeners.forEach((listener) => listener(payload));
        const keyedOnceListeners = onceListeners.get(getKey(event, layerId)) ?? [];
        keyedOnceListeners.forEach((listener) => listener(payload));
        onceListeners.delete(getKey(event, layerId));
      },
    });

    mockMapInstances.push(instance);
    return instance;
  });

  const NavigationControl = jest.fn();
  const Marker = jest.fn();

  return {
    Map,
    Marker,
    NavigationControl,
  };
});

import MapScreen from '@/app/(tabs)/index.web';

const { Map: mockMapConstructor } = jest.requireMock('maplibre-gl') as {
  Map: jest.Mock;
};
const { getCurrentLocation: mockGetCurrentLocation } = jest.requireMock('@/src/lib/currentLocation') as {
  getCurrentLocation: jest.Mock;
};

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MapScreen web grouped Following mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockMapInstances.length = 0;
    mockAppliedFilters = { tag: 'tile-a' };
    mockIsAuthenticated = true;
    mockAccessToken = 'viewer-token';
    mockIsFocused = true;
    mockBrowserPathname = '/';
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('viewer-token');
    mockFollowingTileSourceIsError = false;
    mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
    mockReadTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
    mockReadCacheBustedTileUrl = 'https://tiles.test/properties/read/{z}/{x}/{y}.pbf';
    mockReadHeaderName = 'x-session-id';
    mockReadHeaderValue = 'session-123';
    mockWelcomeVisible = false;
    mockResolvedMapRouteState = {
      isLoading: true,
      pathname: '/',
      resolvedRoute: null,
    };
    mockRecordPropertyView.mockReset();
    capturedMapFilterBarProps = null;
    mockAmbientCommentBubbles.bubbles = [];
    Object.assign(mockInteraction, {
      previewGroup: null,
      currentPreviewIndex: 0,
      selectedPropertyForSheet: null,
      selectedProperty: null,
    });
    mockInteraction.handleFeaturePress.mockReset();
    mockInteraction.handleFeaturePress.mockResolvedValue(false);
    mockGetCurrentLocation.mockReset();
    mockGetCurrentLocation.mockResolvedValue({
      longitude: 4.9041,
      latitude: 52.3676,
    });
    (global as { __DEV__?: boolean }).__DEV__ = false;
    (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__ = [];
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        version: 8,
        sources: {
          'properties-source': {
            type: 'vector',
            tiles: ['https://tiles.test/original'],
          },
        },
        layers: [
          {
            id: 'active-node-fill',
            type: 'circle',
            source: 'properties-source',
            'source-layer': 'properties',
            paint: {
              'circle-opacity': 0.96,
            },
          },
        ],
      }),
    }) as jest.Mock;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    jest.useRealTimers();
    act(() => {
      root.unmount();
    });
    Reflect.deleteProperty(
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      },
      '__HUISHYPE_ANALYTICS_EVENTS__'
    );
    container.remove();
    document.body.innerHTML = '';
  });

  it('constructs the web map at the camera route instead of the default viewport', async () => {
    mockBrowserPathname = '/@52.3626765,5.3574841,6.29z';

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    expect(map.options.center).toEqual([5.3574841, 52.3626765]);
    expect(map.options.zoom).toBe(6.29);
    expect(mockOnViewportCenterChanged).toHaveBeenCalledWith(
      5.3574841,
      52.3626765,
      6.29,
    );
    expect(mockOnViewportCenterChanged).not.toHaveBeenCalledWith(
      5.4697,
      51.4416,
      13,
    );
  });

  it('constructs the root web map at the Netherlands overview', async () => {
    mockBrowserPathname = '/';

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    expect(map.options.center).toEqual([5.3574841, 52.3626765]);
    expect(map.options.zoom).toBe(6.29);
    expect(mockOnViewportCenterChanged).toHaveBeenCalledWith(
      5.3574841,
      52.3626765,
      6.29,
    );
  });

  it('auto-locates once after the root web map reaches idle', async () => {
    mockResolvedMapRouteState = {
      isLoading: false,
      pathname: '/',
      resolvedRoute: {
        kind: 'root',
        canonicalPath: '/',
      },
    };
    mockGetCurrentLocation.mockResolvedValue({
      longitude: 4.9041,
      latitude: 52.3676,
    });

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('idle');
    });
    await flushMicrotasks();

    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1);
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [4.9041, 52.3676],
      zoom: 16,
      duration: 800,
      essential: true,
    });
  });

  it('does not auto-locate on an explicit camera route', async () => {
    mockBrowserPathname = '/@52.3626765,5.3574841,6.29z';
    mockResolvedMapRouteState = {
      isLoading: false,
      pathname: '/@52.3626765,5.3574841,6.29z',
      resolvedRoute: {
        kind: 'camera',
        canonicalPath: '/@52.3626765,5.3574841,6.29z',
        camera: { lat: 52.3626765, lng: 5.3574841, zoom: 6.29 },
      },
    };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('idle');
    });
    await flushMicrotasks();

    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('does not auto-locate when only the web map load timeout fires', async () => {
    jest.useFakeTimers();
    mockResolvedMapRouteState = {
      isLoading: false,
      pathname: '/',
      resolvedRoute: {
        kind: 'root',
        canonicalPath: '/',
      },
    };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    await act(async () => {
      jest.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('does not jump again when the resolved camera route matches the initial camera', async () => {
    mockBrowserPathname = '/@52.3626765,5.3574841,6.29z';
    mockResolvedMapRouteState = {
      isLoading: false,
      pathname: '/@52.3626765,5.3574841,6.29z',
      resolvedRoute: {
        kind: 'camera',
        canonicalPath: '/@52.3626765,5.3574841,6.29z',
        camera: { lat: 52.3626765, lng: 5.3574841, zoom: 6.29 },
      },
    };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.getCenter.mockReturnValue({ lng: 5.3574841, lat: 52.3626765 });
    map.getZoom.mockReturnValue(6.29);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('keeps ambient comment bubbles disabled on low-zoom camera routes', async () => {
    mockBrowserPathname = '/@52.3626765,5.3574841,6.29z';

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    expect(mockAmbientCommentBubbles.clearBubbles).toHaveBeenCalled();
    expect(mockAmbientCommentBubbles.refreshBubbles).not.toHaveBeenCalled();
  });

  it('updates public property source tiles in place when filters change', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockMapConstructor).toHaveBeenCalledTimes(1);

    const map = mockMapInstances[0] as MockMapInstance;
    expect(map.options.style.sources?.['properties-source']?.tiles).toEqual([
      'https://tiles.test/tile-a',
    ]);

    act(() => {
      map.trigger('load');
    });

    mockAppliedFilters = { tag: 'tile-b' };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(map.propertySource.setTiles).toHaveBeenCalledWith(['https://tiles.test/tile-b']);
  });

  it('reloads the public property source after exhausted timeout-empty tile retries', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    jest.useFakeTimers();
    act(() => {
      window.dispatchEvent(new CustomEvent(PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT));
    });

    expect(map.style._clearSource).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(map.style._clearSource).toHaveBeenCalledWith('properties-source');
    expect(map.style._reloadSource).toHaveBeenCalledWith('properties-source');
  });

  it('swaps to grouped Following tiles and applies auth headers only in Following mode', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    expect(capturedMapFilterBarProps?.socialScope).toBe('following');
    expect(window.location.search).toBe('');
    expect(window.history.state).toEqual({
      huishypeMapView: {
        socialScope: 'following',
      },
    });
    expect(mockUseFollowingTileSource).toHaveBeenLastCalledWith(
      mockAppliedFilters,
      'all-time',
      true
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(map.style._clearSource).toHaveBeenCalledWith('properties-source');
    expect(map.style._reloadSource).toHaveBeenCalledWith('properties-source');
    expect(map.options.transformRequest?.('https://tiles.test/following/12/2048/1363.pbf')).toEqual(
      {
        url: 'https://tiles.test/following/12/2048/1363.pbf',
        headers: {
          Authorization: 'Bearer viewer-token',
        },
      }
    );
  });

  it('adds private read overlay tiles and scopes signed-out session headers to read requests', async () => {
    mockIsAuthenticated = false;

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    expect(mockUseReadTileSource).toHaveBeenLastCalledWith(mockAppliedFilters, true);
    expect(map.options.style.sources?.['properties-source']?.tiles).toEqual([
      'https://tiles.test/tile-a',
    ]);
    expect(map.options.style.sources?.['read-properties-source']?.tiles).toEqual([
      'https://tiles.test/properties/read/{z}/{x}/{y}.pbf',
    ]);
    const activeNodeFillLayer = (map.options.style as {
      layers?: Array<{ id?: string; paint?: Record<string, unknown> }>;
    }).layers?.find((layer) => layer.id === 'active-node-fill');
    const readActiveNodeFillLayer = (map.options.style as {
      layers?: Array<{ id?: string; paint?: Record<string, unknown> }>;
    }).layers?.find((layer) => layer.id === 'read-active-node-fill');
    const readLayerIds = ((map.options.style as {
      layers?: Array<{ id?: string }>;
    }).layers ?? []).map((layer) => layer.id);
    expect(JSON.stringify(activeNodeFillLayer?.paint?.['circle-opacity'])).toContain('feature-state');
    expect(readActiveNodeFillLayer?.paint?.['circle-opacity']).toBe(0);
    expect(readLayerIds).not.toContain('read-cluster-count');
    expect(readLayerIds).not.toContain('read-ghost-cluster-count');
    expect(map.options.transformRequest?.('https://tiles.test/properties/read/12/2048/1363.pbf')).toEqual(
      {
        url: 'https://tiles.test/properties/read/12/2048/1363.pbf',
        headers: {
          'x-session-id': 'session-123',
        },
      }
    );
    expect(map.options.transformRequest?.('https://tiles.test/properties/12/2048/1363.pbf')).toEqual({
      url: 'https://tiles.test/properties/12/2048/1363.pbf',
    });
  });

  it('records active preview properties as read on web', async () => {
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

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockRecordPropertyView).toHaveBeenCalledWith('active-property');
  });

  it('refreshes read overlay source tiles from the cache-busted template without removing the source', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    const readSource = map.getSource('read-properties-source') as {
      setTiles: jest.Mock;
    };
    readSource.setTiles.mockClear();

    mockReadCacheBustedTileUrl =
      'https://tiles.test/properties/read/{z}/{x}/{y}.pbf?readVersion=1';

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(readSource.setTiles).toHaveBeenCalledWith([
      'https://tiles.test/properties/read/{z}/{x}/{y}.pbf?readVersion=1',
    ]);
    expect(map.removeSource).not.toHaveBeenCalledWith('read-properties-source');
  });

  it('waits for a resolved auth token before swapping to Following tiles', async () => {
    mockAccessToken = null;
    let resolveAccessToken: ((token: string | null) => void) | null = null;
    mockGetAccessToken.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveAccessToken = resolve;
        }),
    );

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    map.propertySource.setTiles.mockClear();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    expect(capturedMapFilterBarProps?.socialScope).toBe('following');
    expect(map.propertySource.setTiles).not.toHaveBeenCalledWith([
      'https://tiles.test/following/{z}/{x}/{y}.pbf',
    ]);

    await act(async () => {
      resolveAccessToken?.('viewer-token');
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(map.propertySource.setTiles).toHaveBeenCalledWith([
      'https://tiles.test/following/{z}/{x}/{y}.pbf',
    ]);
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

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockRecordPropertyView).not.toHaveBeenCalled();
  });

  it('auth-gates signed-out Following toggles without switching state', async () => {
    mockIsAuthenticated = false;

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    expect(capturedMapFilterBarProps?.socialScope).toBe('all');
    expect(container.querySelector('[data-testid="map-following-state-signed-out"]')).toBeNull();
    expect(mockInteraction.handleAuthRequired).toHaveBeenCalledWith(
      {
        subtitle: 'Sign in to see homes with activity from people you follow.',
      },
      expect.any(Function),
    );
  });

  it('does not passively rewrite the browser URL while a non-map tab is active', async () => {
    mockBrowserPathname = '/feed';

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockReplacePassiveBrowserPath).not.toHaveBeenCalled();
  });

  it('shows the empty Following state from rendered grouped features after the map settles', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.querySourceFeatures.mockReturnValue([
      {
        properties: {
          group_kind: 'single',
          primary_property_id: 'stale-public-property',
          point_count: 1,
        },
        geometry: { type: 'Point', coordinates: [5.47, 51.44] },
      },
    ]);
    map.queryRenderedFeatures.mockReturnValue([]);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();
    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();
    act(() => {
      map.trigger('moveend');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });

    const canvas = map.getCanvas();
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [[0, 0], [canvas.width, canvas.height]],
      { layers: QUERYABLE_PROPERTY_LAYER_IDS }
    );
    expect(container.querySelector('[data-testid="map-following-state-empty"]')).not.toBeNull();
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

  it('shows the empty Following state even when empty Following tiles never report as fully loaded', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.isSourceLoaded.mockReturnValue(false);
    map.areTilesLoaded.mockReturnValue(false);
    map.queryRenderedFeatures.mockReturnValue([]);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();
    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();
    act(() => {
      map.trigger('moveend');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });

    expect(container.querySelector('[data-testid="map-following-state-empty"]')).not.toBeNull();
  });

  it('still completes the empty Following check when repeated idle events fire before settle', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.queryRenderedFeatures.mockReturnValue([]);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();
    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    for (let iteration = 0; iteration < 3; iteration += 1) {
      act(() => {
        map.trigger('idle');
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
    }

    expect(map.queryRenderedFeatures).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="map-following-state-empty"]')).not.toBeNull();
  });

  it('does not rescan read feature states on unrelated source events before the map is idle', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.queryRenderedFeatures.mockClear();

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    const callsAfterLoad = map.queryRenderedFeatures.mock.calls.length;

    act(() => {
      map.trigger('sourcedata', { sourceId: 'properties-source', isSourceLoaded: true });
    });

    expect(map.queryRenderedFeatures.mock.calls.length).toBe(callsAfterLoad);
  });

  it('does not rebind property layer listeners on repeated source updates', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.getLayer.mockReturnValue(true);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    const onCallsBeforeSourceEvents = map.on.mock.calls.length;

    act(() => {
      map.trigger('sourcedata', { sourceId: 'properties-source', isSourceLoaded: true });
      map.trigger('sourcedata', { sourceId: 'properties-source', isSourceLoaded: true });
    });

    expect(map.on.mock.calls.length - onCallsBeforeSourceEvents).toBe(
      QUERYABLE_PROPERTY_LAYER_IDS.length * 3,
    );
  });

  it('routes Following clicks through grouped tile features and emits click-through analytics', async () => {
    mockInteraction.handleFeaturePress.mockResolvedValue(true);

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    map.getLayer.mockReturnValue(true);

    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    act(() => {
      map.trigger('sourcedata');
    });

    const groupedFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [5.47, 51.44],
      },
      properties: {
        node_class: 'active',
        group_kind: 'single',
        primary_property_id: 'property-9',
        point_count: 1,
        property_ids: 'property-9',
        preview_property_ids: 'property-9',
        address: 'Stationsplein 9',
        city: 'Eindhoven',
      },
    };

    act(() => {
      map.trigger('click', { features: [groupedFeature] }, QUERYABLE_PROPERTY_LAYER_IDS[0]);
    });
    await flushMicrotasks();

    expect(mockInteraction.handleFeaturePress).toHaveBeenCalledWith(
      [groupedFeature],
      14,
      expect.any(Object)
    );
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
            name: string;
            properties: Record<string, unknown>;
          }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'map_property_click_through_from_following_filter',
          properties: expect.objectContaining({
            propertyId: 'property-9',
          }),
        }),
      ])
    );
  });

  it('shows the error state from Following tile source failures instead of the empty state', async () => {
    mockFollowingTileSourceIsError = true;

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    await flushMicrotasks();

    act(() => {
      capturedMapFilterBarProps?.onToggleFollowing?.();
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="map-following-state-error"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-following-state-empty"]')).toBeNull();
  });

  it('renders the welcome info button and opens the welcome modal from it', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const infoButton = container.querySelector('[data-testid="map-welcome-info-button"]') as HTMLButtonElement | null;
    expect(infoButton).not.toBeNull();

    infoButton?.click();

    expect(mockWelcomeOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the welcome modal when first-run state is visible', async () => {
    mockWelcomeVisible = true;

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-testid="welcome-modal"]')).not.toBeNull();
  });
});

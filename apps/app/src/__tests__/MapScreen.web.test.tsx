import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QUERYABLE_PROPERTY_LAYER_IDS } from '@huishype/shared/config';

type MockMapEventHandler = (...args: unknown[]) => void;

type MockMapInstance = {
  options: {
    container: HTMLDivElement;
    style: {
      sources?: Record<string, { tiles?: string[] }>;
    };
    transformRequest?: (url: string) => { url: string; headers?: Record<string, string> };
  };
  keyboard: {
    disableRotation: jest.Mock;
  };
  addControl: jest.Mock;
  getContainer: jest.Mock;
  getCanvas: jest.Mock;
  getCenter: jest.Mock;
  getZoom: jest.Mock;
  getBearing: jest.Mock;
  getBounds: jest.Mock;
  getStyle: jest.Mock;
  getPaintProperty: jest.Mock;
  setPaintProperty: jest.Mock;
  on: jest.Mock;
  once: jest.Mock;
  off: jest.Mock;
  getLayer: jest.Mock;
  getSource: jest.Mock;
  isStyleLoaded: jest.Mock;
  fitBounds: jest.Mock;
  flyTo: jest.Mock;
  jumpTo: jest.Mock;
  project: jest.Mock;
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
const mockGetAccessToken = jest.fn(async () => 'viewer-token');
let mockFollowingTileSourceIsError = false;
let mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
const mockFollowingTileRefetch = jest.fn();
const mockReplaceAppliedFilters = jest.fn();
const mockSetSearchCity = jest.fn();
const mockOnViewportCenterChanged = jest.fn();
const mockReplacePassiveBrowserPath = jest.fn((pathname: string) => !!pathname);
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
      },
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

jest.mock('@/src/hooks/useMapInteraction', () => ({
  useMapInteraction: jest.fn(() => mockInteraction),
}));

jest.mock('@/src/hooks/useAmbientCommentBubbles', () => ({
  useAmbientCommentBubbles: jest.fn(() => mockAmbientCommentBubbles),
  toAmbientBubbleVisibleNode: jest.fn((node) => node),
}));

const mockUseFollowingTileSource = jest.fn(
  (_filters: unknown, _enabled: unknown) => ({
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
  }),
);

jest.mock('@/src/hooks/useFollowingTileSource', () => ({
  useFollowingTileSource: jest.fn((filters: unknown, enabled: unknown) =>
    mockUseFollowingTileSource(filters, enabled)),
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
    accessToken: mockIsAuthenticated ? 'viewer-token' : null,
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
  buildPropertyTileTemplateUrl: jest.fn(
    (_apiUrl, filters) => `https://tiles.test/${filters.tag}`,
  ),
  createDefaultMapFilters: jest.fn(() => ({ tag: 'default' })),
  getCanonicalMapFilterSignature: jest.fn((filters) => filters.tag),
  getMapFilterSearchString: jest.fn((_filters, currentSearch) => currentSearch),
  parseMapFiltersFromSearchParams: jest.fn(() => ({ tag: 'default' })),
}));

jest.mock('@/src/lib/webMapUrlSync', () => ({
  getCurrentBrowserPathname: jest.fn(() => '/'),
  replacePassiveBrowserPath: jest.fn((pathname: string) => mockReplacePassiveBrowserPath(pathname)),
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: jest.fn(() => ({
    isLoading: true,
    pathname: '/',
    resolvedRoute: null,
  })),
}));

jest.mock('maplibre-gl', () => {
  const Map = jest.fn().mockImplementation((options) => {
    const listeners = new globalThis.Map<string, MockMapEventHandler[]>();
    const onceListeners = new globalThis.Map<string, MockMapEventHandler[]>();
    let currentTiles =
      options.style?.sources?.['properties-source']?.tiles?.slice() ?? [];

    const getKey = (event: string, layerId?: string) =>
      layerId ? `${event}:${layerId}` : event;

    const addListener = (
      storage: Map<string, MockMapEventHandler[]>,
      event: string,
      layerOrHandler: unknown,
      maybeHandler?: unknown,
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

    const canvas = globalThis.document.createElement('canvas');
    canvas.style.cursor = '';

    const instance = {} as MockMapInstance;
    Object.assign(instance, {
      options,
      keyboard: {
        disableRotation: jest.fn(),
      },
      addControl: jest.fn(),
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
        listeners.delete(key);
        return instance;
      }),
      getLayer: jest.fn(() => false),
      getSource: jest.fn((sourceId: string) =>
        sourceId === 'properties-source' ? propertySource : undefined,
      ),
      isStyleLoaded: jest.fn(() => true),
      fitBounds: jest.fn(),
      flyTo: jest.fn(),
      jumpTo: jest.fn(),
      project: jest.fn(() => ({ x: 0, y: 0 })),
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
    mockFollowingTileSourceIsError = false;
    mockFollowingTileUrl = 'https://tiles.test/following/{z}/{x}/{y}.pbf';
    capturedMapFilterBarProps = null;
    mockAmbientCommentBubbles.bubbles = [];
    mockInteraction.handleFeaturePress.mockReset();
    mockInteraction.handleFeaturePress.mockResolvedValue(false);
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
      '__HUISHYPE_ANALYTICS_EVENTS__',
    );
    container.remove();
    document.body.innerHTML = '';
  });

  it('updates public property source tiles in place when filters change', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockMapConstructor).toHaveBeenCalledTimes(1);

    const map = mockMapInstances[0] as MockMapInstance;
    expect(
      map.options.style.sources?.['properties-source']?.tiles,
    ).toEqual(['https://tiles.test/tile-a']);

    act(() => {
      map.trigger('load');
    });

    mockAppliedFilters = { tag: 'tile-b' };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(map.propertySource.setTiles).toHaveBeenCalledWith([
      'https://tiles.test/tile-b',
    ]);
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
      true,
    );
    expect(
      map.options.transformRequest?.('https://tiles.test/following/12/2048/1363.pbf'),
    ).toEqual({
      url: 'https://tiles.test/following/12/2048/1363.pbf',
      headers: {
        Authorization: 'Bearer viewer-token',
      },
    });
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
    expect(mockInteraction.handleAuthRequired).toHaveBeenCalledWith({
      subtitle: 'Sign in to see homes with activity from people you follow.',
    });
  });

  it('shows the empty Following state from rendered grouped features after the map settles', async () => {
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
    act(() => {
      map.trigger('moveend');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(map.queryRenderedFeatures).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="map-following-state-empty"]')).not.toBeNull();
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'map_following_filter_enabled' }),
        expect.objectContaining({ name: 'map_following_filter_empty_viewed' }),
      ]),
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
      expect.any(Object),
    );
    expect(
      (
        globalThis as typeof globalThis & {
          __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
            name: string;
            properties: Record<string, unknown>;
          }>;
        }
      ).__HUISHYPE_ANALYTICS_EVENTS__,
    ).toEqual(
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
});

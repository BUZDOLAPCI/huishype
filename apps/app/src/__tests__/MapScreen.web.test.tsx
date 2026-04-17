import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type MockMapInstance = {
  options: {
    container: HTMLDivElement;
    style: {
      sources?: Record<string, { tiles?: string[] }>;
    };
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
  trigger: (event: string, payload?: unknown) => void;
};

type MockMarkerInstance = {
  setLngLat: jest.Mock;
  addTo: jest.Mock;
  remove: jest.Mock;
};

type MockMapEventHandler = (...args: unknown[]) => void;

let mockAppliedFilters = { tag: 'tile-a' };
const mockReplaceAppliedFilters = jest.fn();
const mockSetSearchCity = jest.fn();
const mockOnViewportCenterChanged = jest.fn();
const mockAmbientCommentBubbles = {
  bubbles: [] as Array<{
    nodeKey?: string;
    property: { id: string; address: string; city: string; coordinate?: [number, number] };
    coordinate: [number, number];
    screenPoint: [number, number] | null;
    preview: {
      text: string;
      likeCount: number;
      authorName: string;
      authorPhotoUrl: string | null;
    };
  }>,
  clearBubbles: jest.fn(),
  refreshBubbles: jest.fn(),
};
let capturedAmbientBubblePortalProps:
  | {
      onBubblePress: (bubble: {
        nodeKey?: string;
        property: {
          id: string;
          address: string;
          city: string;
          coordinate?: [number, number];
        };
        coordinate: [number, number];
      }) => void;
    }
  | null = null;
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

const mockMapInstances: Array<{
  getSource: jest.Mock;
  getStyle: jest.Mock;
  options: {
    container: HTMLDivElement;
    style: {
      sources?: Record<string, { tiles?: string[] }>;
    };
  };
  propertySource: {
    serialize: jest.Mock;
    setTiles: jest.Mock;
  };
  remove: jest.Mock;
  trigger: (event: string, payload?: unknown) => void;
}> = [];

jest.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const createElement = (tag: string) =>
    React.forwardRef<HTMLElement, React.PropsWithChildren<{ testID?: string }>>(
      (props, ref) => {
      const { children, testID, ...rest } = props;
      return React.createElement(tag, { ...rest, ref, 'data-testid': testID }, children);
      },
    );

  return {
    Alert: {
      alert: jest.fn(),
    },
    Platform: {
      OS: 'web',
    },
    Text: createElement('span'),
    View: createElement('div'),
  };
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect: () => void | (() => void)) => {
    const React = require('react') as typeof import('react');
    React.useEffect(() => effect(), [effect]);
  }),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: jest.fn(),
  },
}));

jest.mock('@/src/components', () => {
  const React = require('react');
  return {
    AuthModal: () => null,
    SearchBar: () => null,
    PropertyBottomSheet: React.forwardRef(() => null),
  };
});

jest.mock('@/src/components/map/MapFilterBar', () => ({
  MapFilterBar: () => null,
}));

jest.mock('@/src/components/WebPreviewMarkerPortal', () => ({
  WebPreviewMarkerPortal: () => null,
}));

jest.mock('@/src/components/WebAmbientCommentBubblesPortal', () => ({
  WebAmbientCommentBubblesPortal: (props: typeof capturedAmbientBubblePortalProps) => {
    capturedAmbientBubblePortalProps = props;
    return null;
  },
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

jest.mock('@/src/hooks/useMapCityName', () => ({
  useMapCityName: jest.fn(() => ({
    cityName: null,
    setSearchCity: mockSetSearchCity,
    onViewportCenterChanged: mockOnViewportCenterChanged,
  })),
  extractCityFromAddress: jest.fn(() => null),
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
  replacePassiveBrowserPath: jest.fn(() => true),
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
    const listeners = new globalThis.Map<string, Array<(arg?: unknown) => void>>();
    const onceListeners = new globalThis.Map<string, Array<(arg?: unknown) => void>>();
    let currentTiles =
      options.style?.sources?.['properties-source']?.tiles?.slice() ?? [];

    const propertySource = {
      serialize: jest.fn(() => ({ tiles: currentTiles })),
      setTiles: jest.fn((tiles: string[]) => {
        currentTiles = tiles.slice();
      }),
    };

    const canvas = globalThis.document.createElement('canvas');

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
      getStyle: jest.fn(() => ({ layers: [] })),
      getPaintProperty: jest.fn(() => null),
      setPaintProperty: jest.fn(),
      on: jest.fn((event: string, layerOrHandler: unknown, maybeHandler?: unknown) => {
        const handler = (
          typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler
        ) as MockMapEventHandler | undefined;
        if (!handler) {
          return instance;
        }
        const queue = listeners.get(event) ?? [];
        queue.push(handler);
        listeners.set(event, queue);
        return instance;
      }),
      once: jest.fn((event: string, handler: (arg?: unknown) => void) => {
        const queue = onceListeners.get(event) ?? [];
        queue.push(handler);
        onceListeners.set(event, queue);
        return instance;
      }),
      off: jest.fn(),
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
      trigger(event: string, payload?: unknown) {
        (listeners.get(event) ?? []).forEach((listener: (arg?: unknown) => void) => listener(payload));
        const oneTimeListeners = onceListeners.get(event) ?? [];
        oneTimeListeners.forEach((listener: (arg?: unknown) => void) => listener(payload));
        onceListeners.delete(event);
      },
    });

    mockMapInstances.push(instance);
    return instance;
  });

  const NavigationControl = jest.fn();
  const Marker = jest.fn().mockImplementation(() => {
    const instance = {} as MockMarkerInstance;
    Object.assign(instance, {
      setLngLat: jest.fn(() => instance),
      addTo: jest.fn(() => instance),
      remove: jest.fn(),
    });
    return instance;
  });

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

describe('MapScreen web filter updates', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockMapInstances.length = 0;
    mockAppliedFilters = { tag: 'tile-a' };
    mockAmbientCommentBubbles.bubbles = [];
    capturedAmbientBubblePortalProps = null;
    (global as { __DEV__?: boolean }).__DEV__ = false;

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
    container.remove();
    document.body.innerHTML = '';
  });

  it('updates property source tiles in place when filters change', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockMapConstructor).toHaveBeenCalledTimes(1);

    const map = mockMapInstances[0];
    expect(map).toBeDefined();
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

    expect(mockMapConstructor).toHaveBeenCalledTimes(1);
    expect(map.remove).not.toHaveBeenCalled();
    expect(map.propertySource.setTiles).toHaveBeenCalledTimes(1);
    expect(map.propertySource.setTiles).toHaveBeenCalledWith([
      'https://tiles.test/tile-b',
    ]);
  });

  it('opens comments for the tapped ambient bubble property', async () => {
    mockAmbientCommentBubbles.bubbles = [
      {
        nodeKey: 'cluster:prop-9',
        property: {
          id: 'prop-9',
          address: 'Stationsplein 1',
          city: 'Eindhoven',
          coordinate: [5.481, 51.441],
        },
        coordinate: [5.48, 51.44],
        screenPoint: [120, 180],
        preview: {
          text: 'Why is this still unsold?',
          likeCount: 2,
          authorName: 'Robin',
          authorPhotoUrl: null,
        },
      },
    ];

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(capturedAmbientBubblePortalProps).not.toBeNull();

    act(() => {
      capturedAmbientBubblePortalProps?.onBubblePress({
        coordinate: [5.48, 51.44],
        property: {
          id: 'prop-9',
          address: 'Stationsplein 1',
          city: 'Eindhoven',
          coordinate: [5.481, 51.441],
        },
      });
    });

    expect(mockInteraction.setHighlightedCoordinate).toHaveBeenCalledWith([5.481, 51.441]);
    expect(mockInteraction.setPreviewGroup).toHaveBeenCalledWith({
      properties: [
        {
          id: 'prop-9',
          address: 'Stationsplein 1',
          city: 'Eindhoven',
          coordinate: [5.481, 51.441],
        },
      ],
      coordinate: [5.481, 51.441],
    });
    expect(mockInteraction.setCurrentPreviewIndex).toHaveBeenCalledWith(0);
    expect(mockInteraction.setSelectedPropertyId).toHaveBeenCalledWith('prop-9');
    expect(mockInteraction.handleComment).toHaveBeenCalledWith({
      id: 'prop-9',
      address: 'Stationsplein 1',
      city: 'Eindhoven',
      coordinate: [5.481, 51.441],
    });
  });

  it('does not clear ambient bubbles when a map gesture starts', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    act(() => {
      map.trigger('load');
    });
    mockAmbientCommentBubbles.clearBubbles.mockClear();

    act(() => {
      map.trigger('dragstart');
      map.trigger('zoomstart');
      map.trigger('rotatestart');
    });

    expect(mockAmbientCommentBubbles.clearBubbles).not.toHaveBeenCalled();
  });

  it('does not reset preview state on a normal rerender while focused', async () => {
    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    mockAppliedFilters = { tag: 'tile-b' };

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    expect(mockInteraction.resetTransientUI).not.toHaveBeenCalled();
  });

  it('passes grouped-node member property candidates into ambient bubble refresh during initial seeding', async () => {
    jest.useFakeTimers();

    mockInteraction.toGroupProperty.mockImplementation((property: {
      id: string;
      address: string;
      city: string;
      geometry?: { coordinates: [number, number] };
    }) => ({
      id: property.id,
      address: property.address,
      city: property.city,
      coordinate: property.geometry?.coordinates,
    }));

    await act(async () => {
      root.render(<MapScreen />);
    });
    await flushMicrotasks();

    const map = mockMapInstances[0] as MockMapInstance;
    Object.defineProperty(map.options.container, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(map.options.container, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    map.project.mockReturnValue({ x: 44, y: 66 });
    map.queryRenderedFeatures.mockReturnValue([
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [5.48, 51.44],
        },
        properties: {
          node_class: 'active',
          group_kind: 'cluster',
          primary_property_id: 'cluster-primary',
          point_count: 3,
          property_ids: 'member-1,member-2,member-3',
          preview_property_ids: 'member-2,member-1',
          commentCount: 6,
          likeCount: 4,
          activityScore: 18,
          guessCount: 1,
          hasListing: true,
        },
      },
    ]);

    act(() => {
      map.trigger('load');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });

    expect(mockAmbientCommentBubbles.refreshBubbles).toHaveBeenCalledWith([
      expect.objectContaining({
        nodeKey: 'cluster:cluster-primary:5.48:51.44',
        coordinate: [5.48, 51.44],
        screenPoint: [44, 66],
        candidatePropertyIds: ['member-2', 'member-1'],
        commentCount: 6,
        likeCount: 4,
        activityScore: 18,
      }),
    ]);
  });
});

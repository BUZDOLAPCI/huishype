import {
  getCurrentBrowserPathname,
  replacePassiveBrowserPath,
} from '../webMapUrlSync';

const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    replace: mockRouterReplace,
  },
  useGlobalSearchParams: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

jest.mock('maplibre-gl', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../../app/comments/[propertyId]', () => ({
  CommentsRouteScreen: () => null,
}));

jest.mock('../../../app/guesses/[propertyId]', () => ({
  GuessesRouteScreen: () => null,
}));

jest.mock('../../../app/property/[id]', () => ({
  PropertyDetailRouteScreen: () => null,
}));

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
  SearchBar: () => null,
  PropertyBottomSheet: () => null,
}));

jest.mock('@/src/components/WebPreviewMarkerPortal', () => ({
  WebPreviewMarkerPortal: () => null,
}));

jest.mock('@/src/hooks/useMapInteraction', () => ({
  useMapInteraction: () => ({
    bottomSheetRef: { current: null },
    handleAuthRequired: jest.fn(),
    handleFeaturePress: jest.fn(),
    handleEmptyMapTap: jest.fn(),
    handlePropertyResolved: jest.fn(),
    resetTransientUI: jest.fn(),
    highlightedCoordinate: null,
    selectedProperty: null,
    handleLocationResolved: jest.fn(),
    previewGroup: null,
    currentPreviewIndex: 0,
    selectedPropertyForSheet: null,
    handleClosePreview: jest.fn(),
  }),
}));

jest.mock('@/src/hooks/useMapCityName', () => ({
  useMapCityName: () => ({
    cityName: null,
    onViewportCenterChanged: jest.fn(),
    setSearchCity: jest.fn(),
  }),
  extractCityFromAddress: jest.fn(),
}));

jest.mock('@/src/utils/api', () => ({
  API_URL: 'http://localhost:3100',
  fetchBatchProperties: jest.fn(),
}));

jest.mock('@/src/lib/currentLocation', () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock('@/src/lib/mapCameraAnchor', () => ({
  PREVIEW_CARD_VIEWPORT_ANCHOR: 'bottom',
  viewportAnchorToOffset: jest.fn(() => [0, 0]),
}));

jest.mock('@/src/lib/mapRoute', () => ({
  extractCanonicalRouteInput: jest.fn(),
}));

jest.mock('@/src/lib/mapCompass', () => ({
  isMapFacingNorth: jest.fn(() => true),
}));

jest.mock('@/src/lib/mapPitch', () => ({
  getPitchForZoom: jest.fn(() => 0),
}));

jest.mock('@/src/lib/mapClick', () => ({
  queryPrioritizedRenderedPropertyFeatures: jest.fn(() => []),
}));

jest.mock('@/src/lib/propertyThumbnail', () => ({
  getPropertyThumbnailFromGeometry: jest.fn(() => null),
}));

jest.mock('@/src/lib/mapDefaults', () => ({
  DEFAULT_CENTER: [5.4697, 51.4416],
  DEFAULT_ZOOM: 13,
  DEFAULT_BEARING: 0,
  DEBUG_CAMERA: false,
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: () => ({
    pathname: '/',
    parsedRoute: { kind: 'root' },
    resolvedRoute: { kind: 'root', canonicalPath: '/' },
    isLoading: false,
  }),
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

jest.mock('@/src/utils/property-route', () => ({
  buildCanonicalRouteHref: (path: string, returnTo?: string | string[] | null) => {
    if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
      return path;
    }

    return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
  },
  buildPropertyMapRoute: jest.fn(),
  buildPropertyRoute: jest.fn(),
  isStaticAppRoutePath: jest.fn(() => false),
}));

jest.mock('@huishype/shared/config', () => ({
  PROPERTY_GHOST_REVEAL_ZOOM: 14,
  QUERYABLE_PROPERTY_LAYER_IDS: ['property-points'],
}));

jest.mock('@huishype/shared', () => ({
  buildCanonicalMapPreviewPath: jest.fn(),
  serializeCanonicalCameraPath: jest.fn(),
}));

const {
  getExplicitCanonicalReplaceHref,
  syncPassiveCameraPathOnMoveEnd,
} = require('../../../app/(tabs)/index.web') as typeof import('../../../app/(tabs)/index.web');

describe('webMapUrlSync', () => {
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    mockRouterReplace.mockReset();
  });

  afterEach(() => {
    window.history.replaceState(window.history.state, '', originalPathname);
    jest.restoreAllMocks();
  });

  it('replaces the browser pathname for passive camera sync without routing', () => {
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    expect(replacePassiveBrowserPath('/@51.4516,5.4897,15.25z')).toBe(true);

    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      '',
      '/@51.4516,5.4897,15.25z',
    );
    expect(window.location.pathname).toBe('/@51.4516,5.4897,15.25z');
  });

  it('returns the current browser pathname and no-ops when the path is already synced', () => {
    window.history.replaceState(window.history.state, '', '/@51.4416,5.4697,13z');
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    expect(getCurrentBrowserPathname('/')).toBe('/@51.4416,5.4697,13z');
    expect(replacePassiveBrowserPath('/@51.4416,5.4697,13z')).toBe(false);
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('keeps passive move-end camera sync off the routed replace path', () => {
    const replaceBrowserPath = jest.fn(() => true);

    const result = syncPassiveCameraPathOnMoveEnd({
      browserPathname: '/@51.4416,5.4697,13z',
      nextCameraPath: '/@51.4416,5.4482423,13z',
      previousCameraPath: '/@51.4416,5.4697,13z',
      lockedAreaPath: '/eindhoven/5611aa/tile-group-street/2',
      canReplaceLockedAreaPath: true,
      previewOpen: false,
      skipNextPassiveUrlSync: false,
      replaceBrowserPath,
    });

    expect(replaceBrowserPath).toHaveBeenCalledWith('/@51.4416,5.4482423,13z');
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(result).toEqual({
      browserPathname: '/@51.4416,5.4482423,13z',
      lockedAreaPath: null,
      skipNextPassiveUrlSync: false,
    });
  });

  it('keeps explicit canonical navigation on the routed replace path', () => {
    expect(
      getExplicitCanonicalReplaceHref(
        '/map/eindhoven/5651ha/beeldbuisring/2',
        {
          kind: 'property',
          canonicalPath: '/eindhoven/5651ha/beeldbuisring/2',
          property: {
            id: 'property-1',
            address: 'Beeldbuisring 2',
            city: 'Eindhoven',
            postalCode: '5651HA',
            countryCode: 'NL',
            coordinates: { lon: 5.45, lat: 51.43 },
            hasListing: true,
            officialValuation: 500000,
          },
          resolvedAddress: {
            bagId: 'property-1',
            formattedAddress: 'Beeldbuisring 2',
            lat: 51.43,
            lon: 5.45,
            details: {
              city: 'Eindhoven',
              zip: '5651HA',
              street: 'Beeldbuisring',
              number: '2',
              houseNumber: '2',
              houseNumberAddition: null,
              countryCode: 'NL',
            },
          },
          routeInput: {
            city: 'Eindhoven',
            postalCode: '5651HA',
            streetName: 'Beeldbuisring',
            houseNumber: '2',
            houseNumberAddition: null,
            countryCode: 'NL',
          },
        },
        '/feed',
      ),
    ).toBe('/eindhoven/5651ha/beeldbuisring/2?returnTo=%2Ffeed');
  });
});

import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import {
  Alert,
  Text,
  View,
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Map,
  Camera,
  Marker,
  UserLocation,
  LogManager,
  NetworkManager,
  type CameraRef,
  type MapRef,
  type PixelPointBounds,
  type ViewStateChangeEvent,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Suppress MapLibre native error toasts in dev (e.g. RenderThread errors in emulator)
LogManager.setLogLevel('warn');
import {
  PropertyBottomSheet,
  AuthModal,
  WelcomeModal,
  SearchBar,
  BottomSheetErrorBoundary,
  GroupPreviewCard,
} from '@/src/components';
import {
  AmbientCommentBubble,
  AMBIENT_COMMENT_BUBBLE_HEIGHT,
  AMBIENT_COMMENT_BUBBLE_WIDTH,
  getAmbientCommentBubbleArrowLayout,
} from '@/src/components/AmbientCommentBubble';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import { MapFilterBar } from '@/src/components/map/MapFilterBar';
import { FollowingMapStateCard } from '@/src/components/map/FollowingMapStateCard';
import { emitMapFollowingAnalyticsEvent } from '@/src/components/map/followingMapAnalytics';
import { useMapInteraction, type MapCameraCommands } from '@/src/hooks/useMapInteraction';
import {
  useAmbientCommentBubbles,
  toAmbientBubbleVisibleNode,
  type AmbientCommentBubble as AmbientCommentBubbleData,
  type RefreshAmbientCommentBubblesOptions,
} from '@/src/hooks/useAmbientCommentBubbles';
import { useMapCityName, extractCityFromAddress } from '@/src/hooks/useMapCityName';
import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import { useFollowingTileSource } from '@/src/hooks/useFollowingTileSource';
import { useReadTileSource } from '@/src/hooks/useReadTileSource';
import { usePropertyView } from '@/src/hooks/usePropertyView';
import { useWelcomeModal } from '@/src/hooks/useWelcomeModal';
import {
  fetchNearbyGroup,
  fetchFollowingNearbyGroup,
  normalizeRenderedPropertyGroup,
  API_URL,
} from '@/src/utils/api';
import { viewportAnchorToPadding } from '@/src/lib/mapCameraAnchor';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEBUG_CAMERA } from '@/src/lib/mapDefaults';
import { doesMapSelectionMatchFilters } from '@/src/lib/mapFilterSelection';
import { getNativePreviewOverlayLayout } from '@/src/lib/nativePreviewOverlay';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import {
  buildFollowingTileRequestMatchPattern,
  buildReadTileRequestMatchPattern,
  injectReadPropertyOverlay,
  replacePropertySourceTiles,
} from '@/src/lib/mapPropertySource';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import {
  buildPropertyTileTemplateUrl,
  getCanonicalMapFilterSignature,
  type MapActivityTimeFilter,
} from '@/src/lib/sharedMapFilters';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import { MapWelcomeInfoButton } from '@/src/components/map/MapWelcomeInfoButton';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import type { MapSocialScope } from '@/src/lib/mapRoute';
import { useAuthContext } from '@/src/providers/AuthProvider';
import type { AddressSearchBias, ResolvedAddress } from '@/src/services/address-resolver';
import { QUERYABLE_PROPERTY_LAYER_IDS } from '@huishype/shared/config';

// Semantic color constants for inline styles (warm palette)
const COLORS = {
  white: '#FFFFFF',
  whiteOverlay: 'rgba(255, 255, 255, 0.92)',
  gray100: '#FFF8F0', // warm-100
  gray200: '#F5F0E8', // warm-200
  gray600: '#736C62', // warm-600
  gray700: '#504A42', // warm-700
  gray800: '#3D3832', // warm-800
  blue500: '#F5A623', // primary-500 (gold)
} as const;

// Fallback timeout for the touch guard ref. If the map's onPress doesn't fire
// after a card touch (e.g. user lifts finger outside the map gesture area),
// the ref resets so the next map tap isn't blocked.
const TOUCH_GUARD_RESET_MS = 500;
const NATIVE_PREVIEW_FALLBACK_WIDTH = 280;
const NATIVE_PREVIEW_TOP_CHROME_CLEARANCE = 148;
const AMBIENT_BUBBLE_SETTLE_DELAY_MS = 900;
const FOLLOWING_FEATURE_HIT_SLOP_PX = 28;

type InlineMapStyle = Exclude<Parameters<typeof Map>[0]['mapStyle'], string>;

function countRenderedGroupedFeatures(features: GeoJSON.Feature[]): number {
  const dedupedKeys = new Set<string>();

  for (const feature of features) {
    const group = normalizeRenderedPropertyGroup(feature);
    if (!group) {
      continue;
    }

    dedupedKeys.add(
      [group.groupKind, group.primaryPropertyId, group.coordinate[0], group.coordinate[1]].join(':')
    );
  }

  return dedupedKeys.size;
}

function emitFollowingFeatureClickAnalytics(features: GeoJSON.Feature[], platform: string): void {
  const group = normalizeRenderedPropertyGroup(features[0]);
  if (!group) {
    return;
  }

  emitMapFollowingAnalyticsEvent('map_property_click_through_from_following_filter', {
    groupKind: group.groupKind,
    platform,
    pointCount: group.pointCount,
    propertyId: group.primaryPropertyId,
  });
}

// Style URL — served by our API, single source of truth for all map layers.
// Native needs ?platform=native so the API can flatten expressions that don't
// work on MapLibre Native (e.g. data-driven fill-extrusion-color).
const STYLE_URL = `${API_URL}/tiles/style.json?platform=native`;

/**
 * Hook to fetch the merged MapLibre style from the API.
 * The API's /tiles/style.json already contains:
 *   - OpenFreeMap base style
 *   - Property vector tile source + layers (with activity-score styling)
 *   - 3D buildings layer
 *   - Self-hosted font glyphs
 *
 * We fetch it as a JS object (not URL string) because maplibre-react-native
 * alpha on Android only reliably renders custom vector sources when passed
 * as inline style objects.
 */
function useMergedMapStyle(
  propertyTiles: string[],
  readPropertyTiles: string[]
): InlineMapStyle | null {
  const [mergedStyle, setMergedStyle] = useState<InlineMapStyle | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(STYLE_URL)
      .then((r) => r.json())
      .then((styleJson: Record<string, unknown>) => {
        if (cancelled) return;
        if (__DEV__)
          console.log(
            '[HuisHype] Fetched merged style from API, layers=',
            (styleJson.layers as Array<unknown>)?.length
          );
        const propertyStyle = replacePropertySourceTiles(
          styleJson as InlineMapStyle,
          propertyTiles
        );
        setMergedStyle(injectReadPropertyOverlay(propertyStyle, readPropertyTiles));
      })
      .catch((e) => {
        console.error('[HuisHype] Failed to fetch merged style:', e.message);
        // Fallback: minimal style with just our tiles (no base map)
        setMergedStyle(
          injectReadPropertyOverlay(
            {
              version: 8,
              sources: {
                'properties-source': {
                  type: 'vector',
                  tiles: propertyTiles,
                  minzoom: 0,
                  maxzoom: 22,
                },
              },
              layers: [
                { id: 'background', type: 'background', paint: { 'background-color': '#E0E0E0' } },
                {
                  id: 'property-circles',
                  type: 'circle',
                  source: 'properties-source',
                  'source-layer': 'properties',
                  paint: { 'circle-radius': 10, 'circle-color': '#FF5A5F', 'circle-opacity': 0.9 },
                },
              ],
            } as InlineMapStyle,
            readPropertyTiles
          )
        );
      });
    return () => {
      cancelled = true;
    };
  }, [propertyTiles, readPropertyTiles]);

  useEffect(() => {
    setMergedStyle((current) =>
      injectReadPropertyOverlay(
        replacePropertySourceTiles(current, propertyTiles),
        readPropertyTiles
      )
    );
  }, [propertyTiles, readPropertyTiles]);

  return mergedStyle;
}

// Property layer IDs to query for features (matching server's /tiles/style.json)
const PROPERTY_LAYER_IDS = [...QUERYABLE_PROPERTY_LAYER_IDS];

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const welcomeModal = useWelcomeModal();
  const { accessToken, getAccessToken, isAuthenticated } = useAuthContext();
  const [hasLayout, setHasLayout] = useState(false);
  const [mapViewportSize, setMapViewportSize] = useState({ width: 0, height: 0 });
  const filterController = useMapFilterController();
  const [socialScope, setSocialScope] = useState<MapSocialScope>('all');
  const [followingActivity, setFollowingActivity] = useState<MapActivityTimeFilter>('all-time');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFullyRendered, setMapFullyRendered] = useState(false);
  const publicPropertyTileUrl = useMemo(
    () => buildPropertyTileTemplateUrl(API_URL, filterController.appliedFilters),
    [filterController.appliedFilters]
  );
  const appliedFilterSignature = useMemo(
    () => getCanonicalMapFilterSignature(filterController.appliedFilters),
    [filterController.appliedFilters]
  );
  const followingTileSource = useFollowingTileSource(
    filterController.appliedFilters,
    followingActivity,
    socialScope === 'following' && mapLoaded
  );
  const readTileSource = useReadTileSource(
    filterController.appliedFilters,
    socialScope !== 'following' && mapLoaded
  );
  const activePropertyTiles = useMemo(
    () =>
      socialScope === 'following'
        ? followingTileSource.data?.tileUrl
          ? [followingTileSource.data.tileUrl]
          : []
        : [publicPropertyTileUrl],
    [followingTileSource.data?.tileUrl, publicPropertyTileUrl, socialScope]
  );
  const activeReadPropertyTiles = useMemo(
    () =>
      socialScope === 'following' || !readTileSource.data?.tileUrl
        ? []
        : [readTileSource.data.tileUrl],
    [readTileSource.data?.tileUrl, socialScope]
  );
  // Merged style as JS object (base map + property vector tiles)
  const mergedStyle = useMergedMapStyle(activePropertyTiles, activeReadPropertyTiles);
  const shouldRenderMap = isFocused && hasLayout && mergedStyle;
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [followingTileAuthToken, setFollowingTileAuthToken] = useState<string | null>(null);
  const [followingRenderedFeatureCount, setFollowingRenderedFeatureCount] = useState<number | null>(
    null
  );
  const [followingRenderCheckComplete, setFollowingRenderCheckComplete] = useState(false);
  const [nativePreviewPoint, setNativePreviewPoint] = useState<[number, number] | null>(null);
  const [nativePreviewSize, setNativePreviewSize] = useState({
    width: NATIVE_PREVIEW_FALLBACK_WIDTH,
    height: 0,
  });
  const appliedPitchRef = useRef(getPitchForZoom(DEFAULT_ZOOM));
  const ambientBubbleRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followingRenderRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedFollowingEmptyViewRef = useRef(false);
  const rootAutoLocationRequestedRef = useRef(false);

  // Shared map interaction state and logic
  const interaction = useMapInteraction();
  const {
    handleNearbyResult,
    handleEmptyMapTap,
    handlePropertyResolved: handleMapPropertyResolved,
    handleLocationResolved: handleMapLocationResolved,
    resetTransientUI,
    toGroupProperty,
  } = interaction;
  const [searchResetToken, setSearchResetToken] = useState(0);
  const maxVisibleAmbientCommentBubbles = mapViewportSize.width < 560 ? 1 : 2;
  const ambientBubblesEnabled =
    mapLoaded &&
    interaction.previewGroup === null &&
    interaction.sheetIndex < 0 &&
    mapViewportSize.width > 0 &&
    mapViewportSize.height > 0;
  const ambientCommentBubbles = useAmbientCommentBubbles({
    enabled: ambientBubblesEnabled,
    maxVisibleBubbles: maxVisibleAmbientCommentBubbles,
    toGroupProperty,
  });
  const {
    bubbles: ambientCommentBubbleItems,
    clearBubbles: clearAmbientCommentBubbles,
    refreshBubbles: refreshAmbientCommentBubbleItems,
  } = ambientCommentBubbles;
  const [positionedAmbientCommentBubbleItems, setPositionedAmbientCommentBubbleItems] = useState<
    AmbientCommentBubbleData[]
  >([]);
  const ambientCommentBubbleItemsRef = useRef(ambientCommentBubbleItems);
  ambientCommentBubbleItemsRef.current = ambientCommentBubbleItems;
  const handleAmbientBubblePress = useCallback(
    (bubble: { property: GroupPreviewProperty; coordinate: [number, number] }) => {
      const bubbleCoordinate = bubble.property.coordinate ?? bubble.coordinate;
      const anchoredProperty = {
        ...bubble.property,
        coordinate: bubbleCoordinate,
      };

      interaction.setHighlightedCoordinate(bubbleCoordinate);
      interaction.setPreviewGroup({
        properties: [anchoredProperty],
        coordinate: bubbleCoordinate,
      });
      interaction.setCurrentPreviewIndex(0);
      interaction.setSelectedPropertyId(anchoredProperty.id);
      interaction.handleComment(anchoredProperty);
    },
    [interaction]
  );

  const clearFollowingRenderedFeatureRefresh = useCallback(() => {
    if (followingRenderRefreshTimeoutRef.current) {
      clearTimeout(followingRenderRefreshTimeoutRef.current);
      followingRenderRefreshTimeoutRef.current = null;
    }
  }, []);

  const refreshFollowingRenderedFeatureCount = useCallback(async () => {
    if (
      socialScope !== 'following' ||
      !isAuthenticated ||
      !followingTileSource.data?.tileUrl ||
      !mapRef.current
    ) {
      setFollowingRenderedFeatureCount(null);
      setFollowingRenderCheckComplete(false);
      return;
    }

    try {
      const features = await mapRef.current.queryRenderedFeatures({
        layers: PROPERTY_LAYER_IDS,
      });
      setFollowingRenderedFeatureCount(countRenderedGroupedFeatures(features));
      setFollowingRenderCheckComplete(true);
    } catch (error) {
      console.warn('[HuisHype] Failed to query rendered following features:', error);
    }
  }, [followingTileSource.data?.tileUrl, isAuthenticated, socialScope]);

  const scheduleFollowingRenderedFeatureRefresh = useCallback(() => {
    clearFollowingRenderedFeatureRefresh();

    if (socialScope !== 'following' || !isAuthenticated || !followingTileSource.data?.tileUrl) {
      setFollowingRenderedFeatureCount(null);
      setFollowingRenderCheckComplete(false);
      return;
    }

    setFollowingRenderCheckComplete(false);
    followingRenderRefreshTimeoutRef.current = setTimeout(() => {
      followingRenderRefreshTimeoutRef.current = null;
      void refreshFollowingRenderedFeatureCount();
    }, AMBIENT_BUBBLE_SETTLE_DELAY_MS);
  }, [
    clearFollowingRenderedFeatureRefresh,
    followingTileSource.data?.tileUrl,
    isAuthenticated,
    refreshFollowingRenderedFeatureCount,
    socialScope,
  ]);

  const handleToggleFollowing = useCallback(() => {
    setSocialScope((currentScope) => {
      if (currentScope === 'following') {
        return 'all';
      }

      if (!isAuthenticated) {
        interaction.handleAuthRequired(
          {
            subtitle: 'Sign in to see homes with activity from people you follow.',
          },
          () => {
            setSocialScope('following');
            emitMapFollowingAnalyticsEvent('map_following_filter_enabled', {
              authenticated: true,
              platform: Platform.OS,
            });
          }
        );
        return currentScope;
      }

      emitMapFollowingAnalyticsEvent('map_following_filter_enabled', {
        authenticated: isAuthenticated,
        platform: Platform.OS,
      });

      return 'following';
    });
  }, [interaction, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated && socialScope === 'following') {
      setSocialScope('all');
    }
  }, [isAuthenticated, socialScope]);

  useEffect(() => {
    let cancelled = false;

    if (socialScope !== 'following' || !isAuthenticated || !followingTileSource.data?.tileUrl) {
      setFollowingTileAuthToken(null);
      return () => {
        cancelled = true;
      };
    }

    void getAccessToken().then((token) => {
      if (!cancelled) {
        setFollowingTileAuthToken(token);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    followingTileSource.data?.tileUrl,
    getAccessToken,
    isAuthenticated,
    socialScope,
  ]);

  useEffect(() => {
    NetworkManager.removeRequestHeader('Authorization');
    NetworkManager.removeRequestHeader('x-session-id');

    if (
      socialScope === 'following' &&
      followingTileAuthToken &&
      followingTileSource.data?.tileUrl
    ) {
      NetworkManager.addRequestHeader(
        'Authorization',
        `Bearer ${followingTileAuthToken}`,
        buildFollowingTileRequestMatchPattern(followingTileSource.data.tileUrl)
      );
    }

    if (
      socialScope !== 'following' &&
      readTileSource.data?.tileUrl &&
      readTileSource.data.headerValue
    ) {
      NetworkManager.addRequestHeader(
        readTileSource.data.headerName,
        readTileSource.data.headerValue,
        buildReadTileRequestMatchPattern(readTileSource.data.tileUrl)
      );
    }

    return () => {
      NetworkManager.removeRequestHeader('Authorization');
      NetworkManager.removeRequestHeader('x-session-id');
    };
  }, [
    followingTileAuthToken,
    followingTileSource.data?.tileUrl,
    readTileSource.data?.headerName,
    readTileSource.data?.headerValue,
    readTileSource.data?.tileUrl,
    socialScope,
  ]);

  // Dynamic city name for the map header
  const {
    cityName,
    countryCode: viewportCountryCode,
    setSearchCity,
    onViewportCenterChanged,
  } = useMapCityName();
  const [searchBiasCenter, setSearchBiasCenter] = useState<Pick<AddressSearchBias, 'lon' | 'lat'>>({
    lon: DEFAULT_CENTER[0],
    lat: DEFAULT_CENTER[1],
  });
  const searchBias = useMemo<AddressSearchBias>(
    () => ({
      ...searchBiasCenter,
      ...(viewportCountryCode ? { countryCode: viewportCountryCode } : {}),
    }),
    [searchBiasCenter, viewportCountryCode]
  );
  const currentPreviewProperty = useMemo(
    () => interaction.previewGroup?.properties[interaction.currentPreviewIndex] ?? null,
    [interaction.currentPreviewIndex, interaction.previewGroup]
  );
  const { recordPropertyView: recordPreviewPropertyView } = usePropertyView();
  useEffect(() => {
    if (currentPreviewProperty?.id && currentPreviewProperty.nodeClass !== 'ghost') {
      recordPreviewPropertyView(currentPreviewProperty.id);
    }
  }, [currentPreviewProperty?.id, currentPreviewProperty?.nodeClass, recordPreviewPropertyView]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        resetTransientUI();
        clearAmbientCommentBubbles();
        setSearchResetToken((value) => value + 1);
      };
    }, [clearAmbientCommentBubbles, resetTransientUI])
  );

  // Trigger initial reverse geocode for the default center
  useEffect(() => {
    onViewportCenterChanged(DEFAULT_CENTER[0], DEFAULT_CENTER[1], DEFAULT_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timeout fallback: dismiss loading overlay after 10s even if onDidFinishLoadingMap doesn't fire
  useEffect(() => {
    if (mapLoaded) return;
    const timeout = setTimeout(() => {
      console.warn('Map loading timeout - dismissing overlay');
      setMapLoaded(true);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [mapLoaded]);

  // Touch guard: when preview card is touched, suppress handleMapPress so the
  // tap doesn't fall through to the map's onPress handler.
  const previewCardTouchedRef = useRef(false);
  const nativePreviewGroup = useMemo(() => {
    if (Platform.OS === 'web') {
      return null;
    }

    const previewGroup = interaction.previewGroup;
    if (!previewGroup || previewGroup.properties.length === 0) {
      return null;
    }

    return previewGroup;
  }, [interaction.previewGroup]);
  const shouldRenderNativePreviewOverlay = nativePreviewGroup !== null;

  const refreshNativePreviewPoint = useCallback(async () => {
    if (!nativePreviewGroup || !mapLoaded || !mapRef.current) {
      setNativePreviewPoint(null);
      return;
    }

    try {
      const point = await mapRef.current.project(nativePreviewGroup.coordinate);
      setNativePreviewPoint([point[0], point[1]]);
    } catch (error) {
      if (__DEV__) {
        console.warn('[HuisHype] Failed to project preview card anchor:', error);
      }
    }
  }, [mapLoaded, nativePreviewGroup]);

  useEffect(() => {
    setPositionedAmbientCommentBubbleItems(ambientCommentBubbleItems);
  }, [ambientCommentBubbleItems]);

  const syncAmbientCommentBubbleScreenPoints = useCallback(async () => {
    const map = mapRef.current;
    const currentBubbles = ambientCommentBubbleItemsRef.current;

    if (!map || currentBubbles.length === 0) {
      setPositionedAmbientCommentBubbleItems(currentBubbles);
      return;
    }

    const nextBubbles = await Promise.all(
      currentBubbles.map(async (bubble) => {
        const anchorCoordinate = bubble.property.coordinate ?? bubble.coordinate;

        try {
          const point = await map.project(anchorCoordinate);
          return {
            ...bubble,
            screenPoint: [point[0], point[1]] as [number, number],
          };
        } catch {
          return {
            ...bubble,
            screenPoint: null,
          };
        }
      })
    );

    if (ambientCommentBubbleItemsRef.current !== currentBubbles) {
      return;
    }

    setPositionedAmbientCommentBubbleItems(nextBubbles);
  }, []);

  // Build a camera adapter for the shared hook
  const cameraCommands: MapCameraCommands = useMemo(
    () => ({
      flyTo: (opts) => {
        const padding = opts.anchor
          ? viewportAnchorToPadding(mapViewportSize, opts.anchor)
          : undefined;

        cameraRef.current?.flyTo({
          center: opts.center,
          zoom: opts.zoom,
          pitch: getPitchForZoom(opts.zoom),
          padding,
          duration: opts.duration,
        });
      },
      fitBounds: (bounds, opts) => {
        cameraRef.current?.fitBounds([bounds[0], bounds[1], bounds[2], bounds[3]], {
          padding: {
            top: opts.padding,
            right: opts.padding,
            bottom: opts.padding,
            left: opts.padding,
          },
          duration: opts.duration,
        });
      },
    }),
    [mapViewportSize]
  );

  const syncPitchForZoom = useCallback((zoom?: number) => {
    if (zoom === undefined || !Number.isFinite(zoom)) return;

    const targetPitch = getPitchForZoom(zoom);
    if (Math.abs(targetPitch - appliedPitchRef.current) < 0.1) return;

    appliedPitchRef.current = targetPitch;
    cameraRef.current?.setStop({ pitch: targetPitch, duration: 0, easing: undefined });
  }, []);

  const handleRegionIsChanging = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      syncPitchForZoom(event.nativeEvent.zoom);
      void refreshNativePreviewPoint();
      void syncAmbientCommentBubbleScreenPoints();
    },
    [refreshNativePreviewPoint, syncAmbientCommentBubbleScreenPoints, syncPitchForZoom]
  );

  // Handle map region change to track zoom level and update city name
  useEffect(() => {
    if (!shouldRenderNativePreviewOverlay) {
      setNativePreviewPoint(null);
      setNativePreviewSize({
        width: NATIVE_PREVIEW_FALLBACK_WIDTH,
        height: 0,
      });
      return;
    }

    void refreshNativePreviewPoint();
  }, [
    interaction.currentPreviewIndex,
    mapViewportSize.height,
    mapViewportSize.width,
    refreshNativePreviewPoint,
    shouldRenderNativePreviewOverlay,
  ]);

  const nativePreviewLayout = useMemo(() => {
    if (!nativePreviewPoint) {
      return null;
    }

    return getNativePreviewOverlayLayout({
      anchorPoint: nativePreviewPoint,
      cardSize: nativePreviewSize,
      topBoundary: insets.top + NATIVE_PREVIEW_TOP_CHROME_CLEARANCE,
      viewportSize: mapViewportSize,
    });
  }, [insets.top, mapViewportSize, nativePreviewPoint, nativePreviewSize]);

  const clearAmbientBubbleRefreshTimeout = useCallback(() => {
    if (ambientBubbleRefreshTimeoutRef.current) {
      clearTimeout(ambientBubbleRefreshTimeoutRef.current);
      ambientBubbleRefreshTimeoutRef.current = null;
    }
  }, []);

  const collectVisibleAmbientBubbleNodes = useCallback(async () => {
    if (!mapRef.current || mapViewportSize.width <= 0 || mapViewportSize.height <= 0) {
      return [];
    }

    let features: GeoJSON.Feature[] = [];
    try {
      features = await mapRef.current.queryRenderedFeatures(
        [
          [0, 0],
          [mapViewportSize.width, mapViewportSize.height],
        ],
        { layers: PROPERTY_LAYER_IDS }
      );
    } catch (error) {
      if (__DEV__) {
        console.warn('[AmbientCommentBubbles] Failed to query viewport features:', error);
      }
      return [];
    }

    const visibleNodes = new globalThis.Map<
      string,
      ReturnType<typeof toAmbientBubbleVisibleNode>
    >();

    for (const feature of features) {
      const group = normalizeRenderedPropertyGroup(feature);
      if (!group || group.commentCount <= 0) {
        continue;
      }

      const candidatePropertyIds = Array.from(
        new Set(
          (group.groupKind === 'cluster'
            ? group.previewPropertyIds.length > 0 ||
              group.membershipComplete === false ||
              group.readStateCoverage === 'partial'
              ? group.previewPropertyIds
              : group.propertyIds
            : [group.primaryPropertyId]
          ).filter(Boolean)
        )
      );
      if (candidatePropertyIds.length === 0) {
        continue;
      }

      let projectedPoint: [number, number] | null = null;
      try {
        const point = await mapRef.current.project(group.coordinate);
        projectedPoint = [point[0], point[1]];
      } catch {
        projectedPoint = null;
      }

      const property = toGroupProperty(
        {
          id: group.primaryPropertyId,
          address: group.address ?? '',
          streetName: group.streetName ?? null,
          houseNumber: group.houseNumber ?? null,
          houseNumberAddition: group.houseNumberAddition ?? null,
          city: group.city ?? '',
          postalCode: group.postalCode ?? null,
          countryCode: group.countryCode ?? undefined,
          officialValuation: group.officialValuation ?? null,
          askingPrice: group.askingPrice ?? null,
          activityScore: group.activityScore,
          geometry: { type: 'Point', coordinates: group.coordinate },
          thumbnailUrl: group.thumbnailUrl ?? null,
          yearBuilt: group.yearBuilt ?? null,
          floorAreaM2: group.floorAreaM2 ?? null,
          likeCount: group.likeCount ?? 0,
          commentCount: group.commentCount ?? 0,
          guessCount: group.guessCount ?? 0,
        },
        group.activityScore
      );

      const nodeKey =
        group.groupKind === 'cluster'
          ? `cluster:${group.primaryPropertyId}:${group.coordinate[0]}:${group.coordinate[1]}`
          : `property:${group.primaryPropertyId}`;

      visibleNodes.set(
        nodeKey,
        toAmbientBubbleVisibleNode({
          nodeKey,
          property,
          coordinate: group.coordinate,
          screenPoint: projectedPoint,
          commentCount: group.commentCount,
          likeCount: group.likeCount,
          activityScore: group.activityScore,
          hasListing: group.hasListing,
          nodeClass: group.nodeClass,
          candidatePropertyIds,
        })
      );
    }

    return Array.from(visibleNodes.values());
  }, [mapViewportSize.height, mapViewportSize.width, toGroupProperty]);

  const refreshAmbientCommentBubbles = useCallback(
    async (options?: RefreshAmbientCommentBubblesOptions) => {
      if (!ambientBubblesEnabled) {
        clearAmbientCommentBubbles();
        return;
      }

      const visibleNodes = await collectVisibleAmbientBubbleNodes();
      await refreshAmbientCommentBubbleItems(visibleNodes, {
        ...options,
        placementContext: {
          ...(options?.placementContext ?? {}),
          viewportSize: mapViewportSize,
          topBoundary: insets.top + NATIVE_PREVIEW_TOP_CHROME_CLEARANCE,
        },
      });
    },
    [
      ambientBubblesEnabled,
      clearAmbientCommentBubbles,
      collectVisibleAmbientBubbleNodes,
      insets.top,
      mapViewportSize,
      refreshAmbientCommentBubbleItems,
    ]
  );

  const scheduleAmbientCommentBubbleRefresh = useCallback(
    (options?: RefreshAmbientCommentBubblesOptions) => {
      clearAmbientBubbleRefreshTimeout();

      if (!ambientBubblesEnabled) {
        clearAmbientCommentBubbles();
        return;
      }

      ambientBubbleRefreshTimeoutRef.current = setTimeout(() => {
        ambientBubbleRefreshTimeoutRef.current = null;
        void refreshAmbientCommentBubbles(options);
      }, AMBIENT_BUBBLE_SETTLE_DELAY_MS);
    },
    [
      ambientBubblesEnabled,
      clearAmbientCommentBubbles,
      clearAmbientBubbleRefreshTimeout,
      refreshAmbientCommentBubbles,
    ]
  );

  // Handle map region change to track zoom level and update city name
  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { zoom, center } = event.nativeEvent;
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
        syncPitchForZoom(zoom);
      }
      // Update city name via reverse geocoding of the viewport center
      if (center) {
        setSearchBiasCenter({ lon: center[0], lat: center[1] });
        onViewportCenterChanged(center[0], center[1], zoom);
      }
      void refreshNativePreviewPoint();
      scheduleFollowingRenderedFeatureRefresh();
      if (ambientCommentBubbleItems.length < maxVisibleAmbientCommentBubbles) {
        scheduleAmbientCommentBubbleRefresh({
          appendToExisting: true,
          minimumVisibleCount: maxVisibleAmbientCommentBubbles,
          preserveRotation: true,
        });
      }
    },
    [
      ambientCommentBubbleItems.length,
      maxVisibleAmbientCommentBubbles,
      onViewportCenterChanged,
      refreshNativePreviewPoint,
      scheduleFollowingRenderedFeatureRefresh,
      scheduleAmbientCommentBubbleRefresh,
      syncPitchForZoom,
    ]
  );

  useEffect(() => {
    scheduleFollowingRenderedFeatureRefresh();
  }, [
    activePropertyTiles,
    appliedFilterSignature,
    mapLoaded,
    scheduleFollowingRenderedFeatureRefresh,
    socialScope,
  ]);

  useEffect(() => {
    if (
      socialScope === 'following' &&
      isAuthenticated &&
      mapLoaded &&
      !followingTileSource.isLoading &&
      !followingTileSource.isError &&
      followingTileSource.data?.tileUrl
    ) {
      return;
    }

    clearFollowingRenderedFeatureRefresh();
    setFollowingRenderedFeatureCount(null);
    setFollowingRenderCheckComplete(false);
  }, [
    clearFollowingRenderedFeatureRefresh,
    followingTileSource.data?.tileUrl,
    followingTileSource.isError,
    followingTileSource.isLoading,
    isAuthenticated,
    mapLoaded,
    socialScope,
  ]);

  useEffect(() => {
    const shouldTrackEmpty =
      socialScope === 'following' &&
      isAuthenticated &&
      mapLoaded &&
      !followingTileSource.isError &&
      !followingTileSource.isLoading &&
      followingRenderCheckComplete &&
      followingRenderedFeatureCount === 0;

    if (!shouldTrackEmpty) {
      trackedFollowingEmptyViewRef.current = false;
      return;
    }

    if (trackedFollowingEmptyViewRef.current) {
      return;
    }

    trackedFollowingEmptyViewRef.current = true;
    emitMapFollowingAnalyticsEvent('map_following_filter_empty_viewed', {
      platform: Platform.OS,
    });
  }, [
    followingRenderCheckComplete,
    followingRenderedFeatureCount,
    followingTileSource.isError,
    followingTileSource.isLoading,
    isAuthenticated,
    mapLoaded,
    socialScope,
  ]);

  useEffect(() => {
    scheduleAmbientCommentBubbleRefresh();
  }, [
    ambientBubblesEnabled,
    filterController.appliedFilters,
    mapLoaded,
    mapViewportSize.height,
    mapViewportSize.width,
    scheduleAmbientCommentBubbleRefresh,
  ]);

  useEffect(
    () => () => {
      clearAmbientBubbleRefreshTimeout();
      clearFollowingRenderedFeatureRefresh();
    },
    [clearAmbientBubbleRefreshTimeout, clearFollowingRenderedFeatureRefresh]
  );

  // Handle map press - query features at tap point, or close preview if tapping empty area
  const handleMapPress = useCallback(
    async (event: NativeSyntheticEvent<PressEvent>) => {
      // If the preview card was just touched, suppress this map press event.
      if (previewCardTouchedRef.current) {
        previewCardTouchedRef.current = false;
        return;
      }

      const { point, lngLat } = event.nativeEvent;
      const pixelPoint: [number, number] = [point[0], point[1]];
      let featurePyramidNode: { pyramidVersionId: string; pyramidNodeId: string } | undefined;

      // Query rendered features at the tap point.
      // NOTE: On native Android, queryRenderedFeatures is unreliable with style-based
      // vector sources — we still try it first since it's free (no API call).
      if (mapRef.current) {
        try {
          const features = await mapRef.current.queryRenderedFeatures(pixelPoint, {
            layers: PROPERTY_LAYER_IDS,
          });

          if (features && features.length > 0) {
            const group = normalizeRenderedPropertyGroup(features[0]);
            if (group?.pyramidVersionId && group.pyramidNodeId) {
              featurePyramidNode = {
                pyramidVersionId: group.pyramidVersionId,
                pyramidNodeId: group.pyramidNodeId,
              };
            }
            if (socialScope === 'following') {
              emitFollowingFeatureClickAnalytics(features, Platform.OS);
            }
            const handled = await interaction.handleFeaturePress(
              features,
              currentZoom,
              cameraCommands
            );
            if (handled) return;
          }

          if (socialScope === 'following') {
            const hitSlop = FOLLOWING_FEATURE_HIT_SLOP_PX;
            const hitSlopBounds: PixelPointBounds = [
              [pixelPoint[0] - hitSlop, pixelPoint[1] - hitSlop],
              [pixelPoint[0] + hitSlop, pixelPoint[1] + hitSlop],
            ];
            const nearbyFeatures = await mapRef.current.queryRenderedFeatures(hitSlopBounds, {
              layers: PROPERTY_LAYER_IDS,
            });

            if (nearbyFeatures.length > 0) {
              emitFollowingFeatureClickAnalytics(nearbyFeatures, Platform.OS);
              const handled = await interaction.handleFeaturePress(
                nearbyFeatures,
                currentZoom,
                cameraCommands
              );
              if (handled) {
                return;
              }
            }
          }
        } catch (error) {
          console.warn('[HuisHype] Error querying features:', error);
        }
      }

      if (socialScope === 'following') {
        const [lon, lat] = lngLat;
        try {
          const nearby = await fetchFollowingNearbyGroup(
            lon,
            lat,
            currentZoom,
            filterController.appliedFilters,
            followingActivity
          );
          if (nearby) {
            handleNearbyResult(nearby, currentZoom, cameraCommands);
            return;
          }
        } catch (error) {
          console.warn('[HuisHype] Following nearby fallback failed:', error);
        }

        handleEmptyMapTap();
        return;
      }

      // Server-side fallback: use the nearby API with reliable lngLat coordinates.
      // This runs at all zoom levels so dense groups can still resolve into previews
      // instead of becoming a zoom-only dead end on native taps.
      const [lon, lat] = lngLat;
      try {
        const nearby = await fetchNearbyGroup(
          lon,
          lat,
          currentZoom,
          filterController.appliedFilters,
          featurePyramidNode
        );
        if (nearby) {
          handleNearbyResult(nearby, currentZoom, cameraCommands);
          return;
        }
      } catch (error) {
        console.warn('[HuisHype] Nearby fallback failed:', error);
      }

      // No features at tap point — check if we should close preview
      handleEmptyMapTap();
    },
    [
      interaction,
      handleNearbyResult,
      handleEmptyMapTap,
      currentZoom,
      cameraCommands,
      filterController.appliedFilters,
      followingActivity,
      socialScope,
    ]
  );

  // Search bar callbacks
  const handlePropertyResolved = useCallback(
    (
      property: Parameters<typeof handleMapPropertyResolved>[0],
      resolvedAddress?: ResolvedAddress
    ) => {
      if (!property.coordinates) {
        return;
      }

      handleMapPropertyResolved(property, cameraCommands, resolvedAddress);
      // Set the search city from the resolved property
      const city = property.city || resolvedAddress?.details.city;
      if (city) {
        setSearchCity(city, [property.coordinates.lon, property.coordinates.lat]);
      }
    },
    [handleMapPropertyResolved, cameraCommands, setSearchCity]
  );

  const handleLocationResolved = useCallback(
    (
      coordinates: { lon: number; lat: number },
      address: string,
      resolvedAddress?: ResolvedAddress
    ) => {
      handleMapLocationResolved(coordinates, address, cameraCommands);
      const cityFromAddress = resolvedAddress?.details.city || extractCityFromAddress(address);
      if (cityFromAddress) {
        setSearchCity(cityFromAddress, [coordinates.lon, coordinates.lat]);
      }
    },
    [handleMapLocationResolved, cameraCommands, setSearchCity]
  );

  // Zoom control handlers
  const handleZoomIn = useCallback(async () => {
    const newZoom = Math.min(currentZoom + 1, 20);
    const center = await mapRef.current?.getCenter();
    if (center) {
      cameraRef.current?.flyTo({
        center,
        zoom: newZoom,
        pitch: getPitchForZoom(newZoom),
        duration: 300,
      });
    }
  }, [currentZoom]);

  const handleZoomOut = useCallback(async () => {
    const newZoom = Math.max(currentZoom - 1, 0);
    const center = await mapRef.current?.getCenter();
    if (center) {
      cameraRef.current?.flyTo({
        center,
        zoom: newZoom,
        pitch: getPitchForZoom(newZoom),
        duration: 300,
      });
    }
  }, [currentZoom]);

  const flyToCurrentLocation = useCallback(async () => {
    try {
      const { longitude, latitude } = await getCurrentLocation();
      setShowUserLocation(true);

      cameraRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: Math.max(currentZoom, 16),
        pitch: getPitchForZoom(Math.max(currentZoom, 16)),
        duration: 800,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get current location';
      console.warn('[MapScreen] Current location failed:', message);
      Alert.alert('Location unavailable', message);
    }
  }, [currentZoom]);

  const handleCurrentLocationPress = useCallback(() => {
    void flyToCurrentLocation();
  }, [flyToCurrentLocation]);

  useEffect(() => {
    if (!isFocused) {
      setMapLoaded(false);
      setMapFullyRendered(false);
    }
  }, [isFocused]);

  useEffect(() => {
    if (
      DEBUG_CAMERA ||
      rootAutoLocationRequestedRef.current ||
      !isFocused ||
      !mapFullyRendered ||
      !cameraRef.current
    ) {
      return;
    }

    rootAutoLocationRequestedRef.current = true;
    void flyToCurrentLocation();
  }, [flyToCurrentLocation, isFocused, mapFullyRendered]);

  const [copiedFlash, setCopiedFlash] = useState(false);
  const handleCopyCamera = useCallback(async () => {
    const center = await mapRef.current?.getCenter();
    if (!center) return;
    const snippet = `{ center: [${center[0].toFixed(5)}, ${center[1].toFixed(5)}] as [number, number], zoom: ${currentZoom.toFixed(1)} }`;
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(snippet);
    setCopiedFlash(true);
    setTimeout(() => setCopiedFlash(false), 1500);
  }, [currentZoom]);

  useEffect(() => {
    if (!interaction.previewGroup && !interaction.selectedPropertyForSheet) {
      return;
    }

    const matchesFilters = doesMapSelectionMatchFilters({
      previewProperty: currentPreviewProperty,
      selectedProperty: interaction.selectedPropertyForSheet ?? null,
      filters: filterController.appliedFilters,
    });

    if (matchesFilters) {
      return;
    }

    interaction.bottomSheetRef.current?.close();
    interaction.handleClosePreview();
  }, [currentPreviewProperty, filterController.appliedFilters, interaction]);

  return (
    <ScreenBackground>
      {/* Map View */}
      <View
        testID="map-viewport"
        style={{ flex: 1 }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setMapViewportSize((current) =>
            current.width === width && current.height === height ? current : { width, height }
          );
          if (!hasLayout) setHasLayout(true);
        }}
      >
        {shouldRenderMap && (
          <Map
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            mapStyle={mergedStyle}
            compass
            compassPosition={{ top: 160, right: 16 }}
            compassHiddenFacingNorth
            touchPitch={false}
            onPress={handleMapPress}
            onRegionIsChanging={handleRegionIsChanging}
            onRegionDidChange={handleRegionDidChange}
            onDidFinishLoadingMap={() => setMapLoaded(true)}
            onDidFinishRenderingMapFully={() => setMapFullyRendered(true)}
            onDidFailLoadingMap={() => {
              console.error('Map failed to load');
              setMapLoaded(true); // Dismiss overlay so user can still see error state
            }}
            testID="map-view"
          >
            <Camera
              ref={cameraRef}
              initialViewState={{
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                pitch: getPitchForZoom(DEFAULT_ZOOM),
              }}
            />

            {showUserLocation && <UserLocation heading />}

            {/* Paper Mario trees come from the server-side style.json as the shared
              paper-trees symbol layer. Both web and native render the tree sprites
              directly from the sprite sheet. */}

            {interaction.highlightedCoordinate && (
              <Marker lngLat={interaction.highlightedCoordinate} anchor="center">
                <View
                  pointerEvents="none"
                  testID="selected-marker"
                  style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      position: 'absolute',
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: 'rgba(245, 166, 35, 0.28)',
                    }}
                  />
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: COLORS.blue500,
                      borderWidth: 3,
                      borderColor: COLORS.white,
                    }}
                  />
                </View>
              </Marker>
            )}

            {/* Geo-anchored GroupPreviewCard via native Marker.
              On Android, Marker renders real native Views (not GL textures),
              so it's accessible to Maestro/uiautomator. The native map engine
              handles projection at 60fps — no async JS roundtrip needed. */}
            {Platform.OS === 'web' &&
              interaction.previewGroup &&
              interaction.previewGroup.properties.length > 0 && (
                <Marker lngLat={interaction.previewGroup.coordinate} anchor="bottom">
                  <GroupPreviewCard
                    properties={interaction.previewGroup.properties}
                    currentIndex={interaction.currentPreviewIndex}
                    onIndexChange={interaction.setCurrentPreviewIndex}
                    onClose={interaction.handleClosePreview}
                    onPropertyTap={interaction.handlePreviewPropertyTap}
                    onLike={interaction.handleLike}
                    onComment={interaction.handleComment}
                    onGuess={interaction.handleGuess}
                    isLiked={interaction.isLiked}
                    showArrow
                    arrowDirection="down"
                    onTouchStart={() => {
                      previewCardTouchedRef.current = true;
                      // Auto-reset in case handleMapPress doesn't fire
                      setTimeout(() => {
                        previewCardTouchedRef.current = false;
                      }, TOUCH_GUARD_RESET_MS);
                    }}
                  />
                </Marker>
              )}
          </Map>
        )}

        {shouldRenderNativePreviewOverlay &&
          nativePreviewPoint &&
          nativePreviewGroup &&
          nativePreviewLayout && (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
              <View style={[styles.nativePreviewOverlay, nativePreviewLayout]}>
                <View
                  onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    setNativePreviewSize((current) =>
                      current.width === width && current.height === height
                        ? current
                        : { width, height }
                    );
                  }}
                >
                  <GroupPreviewCard
                    properties={nativePreviewGroup.properties}
                    currentIndex={interaction.currentPreviewIndex}
                    onIndexChange={interaction.setCurrentPreviewIndex}
                    onClose={interaction.handleClosePreview}
                    onPropertyTap={interaction.handlePreviewPropertyTap}
                    onLike={interaction.handleLike}
                    onComment={interaction.handleComment}
                    onGuess={interaction.handleGuess}
                    isLiked={interaction.isLiked}
                    showArrow
                    arrowDirection={nativePreviewLayout.arrowDirection}
                    onTouchStart={() => {
                      previewCardTouchedRef.current = true;
                      setTimeout(() => {
                        previewCardTouchedRef.current = false;
                      }, TOUCH_GUARD_RESET_MS);
                    }}
                  />
                </View>
              </View>
            </View>
          )}

        {positionedAmbientCommentBubbleItems.length > 0 && (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
            {positionedAmbientCommentBubbleItems.map((bubble) => {
              if (!bubble.screenPoint) {
                return null;
              }

              const bubbleArrowLayout = getAmbientCommentBubbleArrowLayout({
                anchorX: bubble.screenPoint[0],
                viewportWidth: mapViewportSize.width,
              });
              const bubbleLayout = getNativePreviewOverlayLayout({
                anchorPoint: bubble.screenPoint,
                anchorOffsetX: bubbleArrowLayout.anchorOffsetX,
                cardSize: {
                  width: AMBIENT_COMMENT_BUBBLE_WIDTH,
                  height: AMBIENT_COMMENT_BUBBLE_HEIGHT,
                },
                topBoundary: insets.top + NATIVE_PREVIEW_TOP_CHROME_CLEARANCE,
                viewportSize: mapViewportSize,
              });

              if (!bubbleLayout) {
                return null;
              }

              return (
                <View
                  key={bubble.nodeKey}
                  style={[styles.nativeAmbientBubbleOverlay, bubbleLayout]}
                >
                  <AmbientCommentBubble
                    text={bubble.preview.text}
                    likeCount={bubble.preview.likeCount}
                    authorName={bubble.preview.authorName}
                    authorPhotoUrl={bubble.preview.authorPhotoUrl}
                    arrowDirection={bubbleLayout.arrowDirection}
                    arrowHorizontalAlign={bubbleArrowLayout.arrowHorizontalAlign}
                    onPress={() => handleAmbientBubblePress(bubble)}
                    testID={`ambient-comment-bubble-${bubble.property.id}`}
                  />
                </View>
              );
            })}
          </View>
        )}

        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <View style={{ flex: 1, backgroundColor: 'rgba(255, 248, 240, 0.08)' }} />
        </View>

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View style={styles.mapLoadingIndicator} testID="map-loading-indicator">
            <ActivityIndicator size="large" color={COLORS.blue500} />
            <Text style={{ color: COLORS.gray600, marginTop: 12, fontSize: 16 }}>
              Loading map...
            </Text>
          </View>
        )}

        {/* Top gradient — fades behind header/search */}
        <MapGradient position="top" testID="map-gradient-top" />

        {/* Bottom gradient — fades behind tab bar */}
        <MapGradient position="bottom" testID="map-gradient-bottom" />

        {/* Map Header Row — brand mark + city name */}
        <MapHeaderRow cityName={cityName ?? undefined} />

        {/* Search Bar */}
        <SearchBar
          onPropertyResolved={handlePropertyResolved}
          onLocationResolved={handleLocationResolved}
          transientResetKey={searchResetToken}
          searchBias={searchBias}
        />

        <MapFilterBar
          controller={filterController}
          followingActivity={followingActivity}
          onFollowingActivityChange={setFollowingActivity}
          onToggleFollowing={handleToggleFollowing}
          socialScope={socialScope}
        />

        {socialScope === 'following' && !isAuthenticated ? (
          <FollowingMapStateCard
            mode="signed-out"
            onPrimaryPress={() =>
              interaction.handleAuthRequired(
                {
                  subtitle: 'Sign in to see homes with activity from people you follow.',
                },
                () => {
                  setSocialScope('following');
                  emitMapFollowingAnalyticsEvent('map_following_filter_enabled', {
                    authenticated: true,
                    platform: Platform.OS,
                  });
                }
              )
            }
          />
        ) : null}

        {socialScope === 'following' &&
        isAuthenticated &&
        mapLoaded &&
        followingTileSource.isError ? (
          <FollowingMapStateCard
            mode="error"
            onPrimaryPress={() => {
              void followingTileSource.refetch();
            }}
          />
        ) : null}

        {socialScope === 'following' &&
        isAuthenticated &&
        mapLoaded &&
        !followingTileSource.isError &&
        !followingTileSource.isLoading &&
        followingRenderCheckComplete &&
        followingRenderedFeatureCount === 0 ? (
          <FollowingMapStateCard mode="empty" onPrimaryPress={() => setSocialScope('all')} />
        ) : null}

        {/* Zoom level indicator (debug camera only) */}
        {DEBUG_CAMERA && (
          <View
            style={{
              position: 'absolute',
              top: 120,
              left: 16,
              backgroundColor: 'rgba(255,255,255,0.9)',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 20,
              zIndex: 50,
            }}
          >
            <Text style={{ fontSize: 12, color: COLORS.gray700 }}>
              Zoom: {currentZoom.toFixed(1)}
            </Text>
          </View>
        )}

        {/* Floating controls — lighter circular treatment to match the pen */}
        <MapWelcomeInfoButton onPress={welcomeModal.open} style={styles.welcomeInfoButton} />

        <View style={styles.controlRail}>
          <Pressable
            testID="zoom-in-button"
            onPress={handleZoomIn}
            style={({ pressed }) => [styles.roundControl, pressed && styles.roundControlPressed]}
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
          >
            <Text style={styles.roundControlText}>+</Text>
          </Pressable>
          <Pressable
            testID="zoom-out-button"
            onPress={handleZoomOut}
            style={({ pressed }) => [styles.roundControl, pressed && styles.roundControlPressed]}
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
          >
            <Text style={styles.roundControlText}>{'\u2212'}</Text>
          </Pressable>
          <LocationButton testID="location-button" onPress={handleCurrentLocationPress} />
          {DEBUG_CAMERA && (
            <Pressable
              onPress={handleCopyCamera}
              style={({ pressed }) => [
                styles.roundControl,
                pressed && styles.roundControlPressed,
                copiedFlash && styles.roundControlCopied,
              ]}
              accessibilityLabel="Copy camera position"
              accessibilityRole="button"
            >
              <Text style={[styles.copyControlText, copiedFlash && styles.copyControlTextCopied]}>
                {copiedFlash ? '\u2713' : '\u{1F4CB}'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Property details bottom sheet */}
      <BottomSheetErrorBoundary>
        <PropertyBottomSheet
          ref={interaction.bottomSheetRef}
          property={interaction.selectedPropertyForSheet ?? null}
          isLiked={interaction.isLiked}
          isSaved={interaction.isSaved}
          isPreviewCardVisible={!!interaction.previewGroup}
          onClose={interaction.handleSheetClose}
          onSheetChange={interaction.handleSheetIndexChange}
          onSave={interaction.handleSave}
          onShare={interaction.handleShare}
          onLike={interaction.handleLike}
          onGuessPress={interaction.handleGuessPress}
          onCommentPress={interaction.handleCommentPress}
          onAuthRequired={interaction.handleAuthRequired}
        />
      </BottomSheetErrorBoundary>

      {/* Auth Modal */}
      <AuthModal
        visible={interaction.showAuthModal}
        onClose={interaction.handleAuthModalClose}
        copy={interaction.authCopy}
        onSuccess={interaction.handleAuthSuccess}
        onAuthStarting={interaction.handleAuthStarting}
      />

      <WelcomeModal
        visible={welcomeModal.visible && !interaction.showAuthModal}
        onClose={welcomeModal.dismiss}
      />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  mapLoadingIndicator: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlRail: {
    position: 'absolute',
    right: 16,
    bottom: 108,
    zIndex: 10,
    alignItems: 'center',
    gap: 10,
  },
  welcomeInfoButton: {
    position: 'absolute',
    left: 16,
    bottom: 108,
    zIndex: 10,
  },
  nativePreviewOverlay: {
    position: 'absolute',
    zIndex: 8,
  },
  nativeAmbientBubbleOverlay: {
    position: 'absolute',
    zIndex: 7,
  },
  roundControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.whiteOverlay,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  roundControlPressed: {
    backgroundColor: COLORS.gray100,
  },
  roundControlCopied: {
    backgroundColor: '#D1FAE5',
  },
  roundControlText: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '400',
    color: COLORS.gray800,
  },
  copyControlText: {
    fontSize: 16,
    color: COLORS.gray800,
  },
  copyControlTextCopied: {
    color: '#059669',
  },
});

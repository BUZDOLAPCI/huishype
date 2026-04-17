import { useRef, useCallback, useState, useEffect, useMemo, startTransition } from 'react';
import { Alert, Text, View, type ViewStyle } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router, type Href } from 'expo-router';
import * as maplibregl from 'maplibre-gl';

import {
  AuthModal,
  SearchBar,
  PropertyBottomSheet,
} from '@/src/components';
import { MapFilterBar } from '@/src/components/map/MapFilterBar';
import { WebAmbientCommentBubblesPortal } from '@/src/components/WebAmbientCommentBubblesPortal';
import { WebPreviewMarkerPortal } from '@/src/components/WebPreviewMarkerPortal';
import { useMapInteraction, type MapCameraCommands } from '@/src/hooks/useMapInteraction';
import {
  useAmbientCommentBubbles,
  toAmbientBubbleVisibleNode,
  type RefreshAmbientCommentBubblesOptions,
} from '@/src/hooks/useAmbientCommentBubbles';
import { useMapCityName, extractCityFromAddress } from '@/src/hooks/useMapCityName';
import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import type { AuthModalCopyInput } from '@/src/lib/authModalCopy';
import {
  API_URL,
  normalizeRenderedPropertyGroup,
  type PropertyResolveResult,
} from '@/src/utils/api';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import { viewportAnchorToOffset } from '@/src/lib/mapCameraAnchor';
import {
  clearLocalPreviewRouteCache,
  extractCanonicalRouteInput,
  registerLocalPreviewRoute,
  type ResolvedMapRoute,
} from '@/src/lib/mapRoute';
import { isMapFacingNorth } from '@/src/lib/mapCompass';
import { doesMapSelectionMatchFilters } from '@/src/lib/mapFilterSelection';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import { replacePropertySourceTiles, PROPERTY_VECTOR_SOURCE_ID } from '@/src/lib/mapPropertySource';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import {
  appendSearchToPath,
  buildPropertyTileTemplateUrl,
  createDefaultMapFilters,
  getCanonicalMapFilterSignature,
  getMapFilterSearchString,
  parseMapFiltersFromSearchParams,
} from '@/src/lib/sharedMapFilters';
import {
  getCurrentBrowserPathname,
  replacePassiveBrowserPath,
} from '@/src/lib/webMapUrlSync';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEFAULT_BEARING, DEBUG_CAMERA } from '@/src/lib/mapDefaults';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { buildCanonicalRouteHref, toInternalAppHref } from '@/src/utils/property-route';
import {
  PROPERTY_GHOST_REVEAL_ZOOM,
  QUERYABLE_PROPERTY_LAYER_IDS,
} from '@huishype/shared/config';
import {
  buildCanonicalMapPreviewPath,
  serializeCanonicalCameraPath,
} from '@huishype/shared';

// Style URL — served by our API, merging OpenFreeMap base + property layers + 3D buildings + self-hosted fonts
const STYLE_URL = `${API_URL}/tiles/style.json`;
const FLOATING_ZOOM_CONTROL_RIGHT = 18;
const FLOATING_ZOOM_CONTROL_TOP = 118;
const FLOATING_ZOOM_CONTROL_SIZE = 40;
const SELECTED_MARKER_CONTAINER_SIZE_PX = 24;
const SELECTED_MARKER_PULSE_SIZE_PX = 32;
const SELECTED_MARKER_DOT_SIZE_PX = 18;
const PREVIEW_ARROW_SIZE_PX = 10;
const PREVIEW_ARROW_MARKER_GAP_PX = 6;
const PREVIEW_CARD_MARKER_OFFSET_PX =
  SELECTED_MARKER_CONTAINER_SIZE_PX + PREVIEW_ARROW_SIZE_PX + PREVIEW_ARROW_MARKER_GAP_PX;
const SEARCH_TARGET_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM + 1;

type WebViewStyle = ViewStyle & {
  animation?: string;
  boxShadow?: string;
  filter?: string;
  transition?: string;
};

const MAP_OVERLAY_STYLE: WebViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(255, 248, 240, 0.08)',
};

const MAP_LOADING_STYLE: WebViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10,
  transition: 'opacity 0.3s ease-out',
};

const MAP_LOADING_SPINNER_STYLE: WebViewStyle = {
  animation: 'spin 1s linear infinite',
};

const MAP_DEBUG_ZOOM_STYLE: WebViewStyle = {
  position: 'absolute',
  top: 120,
  left: 16,
  zIndex: 50,
};

const MAP_LOCATION_BUTTON_STYLE: WebViewStyle = {
  position: 'absolute',
  bottom: 108,
  right: 18,
  zIndex: 10,
};

export interface MapScreenProps {
  pathnameOverride?: string | null;
}

interface PassiveCameraPathSyncArgs {
  browserPathname: string;
  nextCameraPath: string;
  previousCameraPath: string;
  lockedAreaPath: string | null;
  canReplaceLockedAreaPath: boolean;
  previewOpen: boolean;
  skipNextPassiveUrlSync: boolean;
  replaceBrowserPath: (pathname: string) => boolean;
}

interface PassiveCameraPathSyncResult {
  browserPathname: string;
  lockedAreaPath: string | null;
  skipNextPassiveUrlSync: boolean;
}

export function syncPassiveCameraPathOnMoveEnd({
  browserPathname,
  nextCameraPath,
  previousCameraPath,
  lockedAreaPath,
  canReplaceLockedAreaPath,
  previewOpen,
  skipNextPassiveUrlSync,
  replaceBrowserPath,
}: PassiveCameraPathSyncArgs): PassiveCameraPathSyncResult {
  if (skipNextPassiveUrlSync && nextCameraPath === previousCameraPath) {
    return {
      browserPathname,
      lockedAreaPath,
      skipNextPassiveUrlSync: false,
    };
  }

  if (previewOpen) {
    return {
      browserPathname,
      lockedAreaPath,
      skipNextPassiveUrlSync: false,
    };
  }

  if (
    lockedAreaPath &&
    browserPathname === lockedAreaPath &&
    !canReplaceLockedAreaPath
  ) {
    return {
      browserPathname,
      lockedAreaPath,
      skipNextPassiveUrlSync: false,
    };
  }

  if (browserPathname === nextCameraPath) {
    return {
      browserPathname,
      lockedAreaPath,
      skipNextPassiveUrlSync: false,
    };
  }

  const nextLockedAreaPath = null;
  if (!replaceBrowserPath(nextCameraPath)) {
    return {
      browserPathname,
      lockedAreaPath: nextLockedAreaPath,
      skipNextPassiveUrlSync: false,
    };
  }

  return {
    browserPathname: nextCameraPath,
    lockedAreaPath: nextLockedAreaPath,
    skipNextPassiveUrlSync: false,
  };
}

function getExplicitCanonicalReplaceHref(
  pathname: string,
  resolvedRoute: ResolvedMapRoute,
  returnTo?: string | string[] | null,
): string | null {
  if (
    resolvedRoute.canonicalPath === pathname ||
    resolvedRoute.kind === 'root' ||
    resolvedRoute.kind === 'camera'
  ) {
    return null;
  }

  return buildCanonicalRouteHref(resolvedRoute.canonicalPath, returnTo);
}

const ENHANCED_GREEN_COLORS = {
  park: '#D4F5D4',
  grass: '#E2F5E2',
  forest: '#A8D8A8',
};

const ENHANCED_BASE_COLORS = {
  ground: '#F5F3EF',
  road: '#FFFFFF',
  water: '#B8D4E8',
};

/**
 * Enhance vegetation colors
 */
function enhanceVegetationColors(map: maplibregl.Map) {
  const existingLayers = map.getStyle()?.layers || [];

  existingLayers.forEach((layer: maplibregl.LayerSpecification) => {
    if (layer.type === 'fill') {
      if (layer.id === 'park' || layer.id.includes('park')) {
        try {
          map.setPaintProperty(layer.id, 'fill-color', ENHANCED_GREEN_COLORS.park);
        } catch {
          // Ignore
        }
      }
      if (layer.id.includes('grass') || layer.id === 'landcover-grass') {
        try {
          map.setPaintProperty(layer.id, 'fill-color', ENHANCED_GREEN_COLORS.grass);
        } catch {
          // Ignore
        }
      }
      if (layer.id.includes('wood') || layer.id.includes('forest')) {
        try {
          map.setPaintProperty(layer.id, 'fill-color', ENHANCED_GREEN_COLORS.forest);
        } catch {
          // Ignore
        }
      }
    }
  });
}

/**
 * Enhance base map colors
 */
function enhanceBaseMapColors(map: maplibregl.Map) {
  const existingLayers = map.getStyle()?.layers || [];

  existingLayers.forEach((layer: maplibregl.LayerSpecification) => {
    try {
      if (layer.id === 'background' || layer.id.includes('background')) {
        if (layer.type === 'background') {
          map.setPaintProperty(layer.id, 'background-color', ENHANCED_BASE_COLORS.ground);
        }
      }

      if (layer.id.includes('landuse') && layer.type === 'fill') {
        if (layer.id.includes('residential')) {
          map.setPaintProperty(layer.id, 'fill-color', '#F8F6F2');
        }
      }

      if (layer.type === 'line' && (layer.id.includes('road') || layer.id.includes('street'))) {
        if (layer.id.includes('casing')) {
          map.setPaintProperty(layer.id, 'line-color', '#E8E6E2');
        }
      }

      // Water layers use fill-pattern (wave texture) from server-side style.
      // Only override fill-color as fallback when no fill-pattern is set.
      if (layer.id.includes('water') && layer.type === 'fill') {
        const currentPattern = map.getPaintProperty(layer.id, 'fill-pattern');
        if (!currentPattern) {
          map.setPaintProperty(layer.id, 'fill-color', ENHANCED_BASE_COLORS.water);
        }
      }
    } catch {
      // Ignore
    }
  });
}

// Inject CSS for pulsing animation on selected node and preview card
const PULSING_CSS_ID = 'pulsing-node-css';
if (typeof document !== 'undefined') {
  let style = document.getElementById(PULSING_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PULSING_CSS_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }
    @keyframes pulse-ring {
      0% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0.8;
      }
      50% {
        transform: translate(-50%, -50%) scale(1.4);
        opacity: 0.4;
      }
      100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0.8;
      }
    }
    @keyframes popIn {
      0% {
        transform: scale(0.8) translateY(10px);
        opacity: 0;
      }
      100% {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
    }
    .selected-marker-container {
      position: relative;
      width: ${SELECTED_MARKER_CONTAINER_SIZE_PX}px;
      height: ${SELECTED_MARKER_CONTAINER_SIZE_PX}px;
    }
    .selected-marker-pulse {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${SELECTED_MARKER_PULSE_SIZE_PX}px;
      height: ${SELECTED_MARKER_PULSE_SIZE_PX}px;
      border-radius: 50%;
      background-color: #F5A623;
      opacity: 0.4;
      animation: pulse-ring 1.5s ease-in-out infinite;
    }
    .selected-marker-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${SELECTED_MARKER_DOT_SIZE_PX}px;
      height: ${SELECTED_MARKER_DOT_SIZE_PX}px;
      border-radius: 50%;
      background-color: #F5A623;
      border: 3px solid #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
  `;
}

const STANDALONE_COMPASS_CSS_ID = 'standalone-compass-css';
if (typeof document !== 'undefined' && !document.getElementById(STANDALONE_COMPASS_CSS_ID)) {
  const style = document.createElement('style');
  style.id = STANDALONE_COMPASS_CSS_ID;
  style.textContent = `
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass {
      position: absolute;
      right: 16px;
      bottom: 156px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.87);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09), 0 1px 3px rgba(0, 0, 0, 0.06);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      overflow: hidden;
      margin: 0 !important;
      z-index: 3;
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 0s;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass.maplibregl-ctrl-standalone-compass--hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 180ms;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass:not(:empty) {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09), 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass button {
      width: 44px;
      height: 44px;
      border-radius: 999px;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass .maplibregl-ctrl-icon {
      background-size: 75% 75%;
      filter: invert(24%) sepia(10%) saturate(515%) hue-rotate(355deg) brightness(92%) contrast(88%);
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass button + button {
      border-top: 0;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass button:not(:disabled):hover,
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass button:not(:disabled):active {
      background-color: rgba(80, 74, 66, 0.06);
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-standalone-compass button:not(:disabled):active {
      background-color: rgba(80, 74, 66, 0.08);
    }
  `;
  document.head.appendChild(style);
}

const FLOATING_ZOOM_CONTROL_CSS_ID = 'floating-zoom-control-css';
if (typeof document !== 'undefined' && !document.getElementById(FLOATING_ZOOM_CONTROL_CSS_ID)) {
  const style = document.createElement('style');
  style.id = FLOATING_ZOOM_CONTROL_CSS_ID;
  style.textContent = `
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom {
      position: absolute;
      right: ${FLOATING_ZOOM_CONTROL_RIGHT}px;
      top: ${FLOATING_ZOOM_CONTROL_TOP}px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.87);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09), 0 1px 3px rgba(0, 0, 0, 0.06);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      overflow: hidden;
      margin: 0 !important;
      z-index: 3;
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 0s;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom.maplibregl-ctrl-floating-zoom--hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 180ms;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom button {
      width: ${FLOATING_ZOOM_CONTROL_SIZE}px;
      height: ${FLOATING_ZOOM_CONTROL_SIZE}px;
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom .maplibregl-ctrl-icon {
      background-size: 75% 75%;
      filter: invert(24%) sepia(10%) saturate(515%) hue-rotate(355deg) brightness(92%) contrast(88%);
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom button:not(:disabled):hover,
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom button:not(:disabled):active {
      background-color: rgba(80, 74, 66, 0.06);
    }
    .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom button:not(:disabled):active {
      background-color: rgba(80, 74, 66, 0.08);
    }
    @media (orientation: portrait) {
      .maplibregl-ctrl-group.maplibregl-ctrl-floating-zoom {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(4px);
        transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 180ms;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Create a custom marker element for the selected property
 */
function createSelectedMarkerElement(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'selected-marker-container';
  container.setAttribute('data-testid', 'selected-marker');

  const pulse = document.createElement('div');
  pulse.className = 'selected-marker-pulse';

  const dot = document.createElement('div');
  dot.className = 'selected-marker-dot';

  container.appendChild(pulse);
  container.appendChild(dot);

  return container;
}

// Property layer IDs for click handling
const PROPERTY_LAYER_IDS = [...QUERYABLE_PROPERTY_LAYER_IDS];
const AMBIENT_BUBBLE_SETTLE_DELAY_MS = 900;
const AMBIENT_BUBBLE_RESET_ZOOM_OUT_DELTA = 0.75;

export default function MapScreen({ pathnameOverride }: MapScreenProps = {}) {
  const initialAppliedFilters = useMemo(
    () =>
      typeof window === 'undefined'
        ? createDefaultMapFilters()
        : parseMapFiltersFromSearchParams(
            new URLSearchParams(window.location.search),
          ),
    [],
  );
  const filterController = useMapFilterController({
    initialAppliedFilters,
  });
  const { replaceAppliedFilters } = filterController;
  const propertyTileUrl = useMemo(
    () => buildPropertyTileTemplateUrl(API_URL, filterController.appliedFilters),
    [filterController.appliedFilters],
  );
  // Keep map construction stable; later filter changes should update the
  // vector source tiles in place instead of remounting the whole map.
  const propertyTileUrlRef = useRef(propertyTileUrl);
  propertyTileUrlRef.current = propertyTileUrl;
  const appliedFilterSignature = useMemo(
    () => getCanonicalMapFilterSignature(filterController.appliedFilters),
    [filterController.appliedFilters],
  );
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const currentZoomRef = useRef(DEFAULT_ZOOM);
  const lastSettledAmbientBubbleZoomRef = useRef<number | null>(null);
  const [visibleZoom, setVisibleZoom] = useState(DEFAULT_ZOOM);
  const [searchResetToken, setSearchResetToken] = useState(0);
  const initialRoutePathname = pathnameOverride ?? getCurrentBrowserPathname('/');
  const [routePathname, setRoutePathname] = useState(initialRoutePathname);
  const routeState = useResolvedMapRoute(routePathname);
  const appliedRoutePathRef = useRef<string | null>(null);
  const skipNextPassiveUrlSyncRef = useRef(true);
  const lastCameraPathRef = useRef<string>('/');
  const previousPreviewPathRef = useRef<string | null>(null);
  const lockedAreaPathRef = useRef<string | null>(null);
  const canReplaceLockedAreaPathRef = useRef(true);
  const browserPathRef = useRef(getCurrentBrowserPathname(initialRoutePathname));
  const browserSearchRef = useRef(
    typeof window === 'undefined' ? '' : window.location.search || '',
  );
  const ambientBubbleRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gesture tracking refs to prevent preview card from closing during map gestures
  const isDragging = useRef(false);
  const isZooming = useRef(false);
  const isRotating = useRef(false);

  // Flag to prevent general click handler from overriding layer-specific click handler
  const propertyClickHandled = useRef(false);
  const propertyClickResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared map interaction state and logic
  const interaction = useMapInteraction();
  const {
    bottomSheetRef,
    handleAuthRequired,
    handleFeaturePress,
    handleEmptyMapTap,
    resetTransientUI,
    highlightedCoordinate,
    setHighlightedCoordinate,
    setSelectedPropertyId,
    selectedProperty,
    selectedPropertyForSheet,
    toGroupProperty,
    setPreviewGroup,
    setCurrentPreviewIndex,
    handleLocationResolved: handleMapLocationResolved,
  } = interaction;
  const handleEmptyMapTapRef = useRef(handleEmptyMapTap);
  handleEmptyMapTapRef.current = handleEmptyMapTap;
  const webViewportSize = {
    width:
      mapRef.current?.getContainer().clientWidth ??
      (typeof window === 'undefined' ? 0 : window.innerWidth),
    height:
      mapRef.current?.getContainer().clientHeight ??
      (typeof window === 'undefined' ? 0 : window.innerHeight),
  };
  const maxVisibleAmbientCommentBubbles = webViewportSize.width < 560 ? 2 : 3;
  const ambientBubblesEnabled =
    mapLoaded &&
    !interaction.previewGroup &&
    interaction.sheetIndex < 0;
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
  const scheduleAmbientCommentBubbleRefreshRef =
    useRef<(options?: RefreshAmbientCommentBubblesOptions) => void>(() => {});
  const ambientBubbleVisibleCountRef = useRef(ambientCommentBubbleItems.length);
  ambientBubbleVisibleCountRef.current = ambientCommentBubbleItems.length;
  const maxVisibleAmbientCommentBubblesRef = useRef(maxVisibleAmbientCommentBubbles);
  maxVisibleAmbientCommentBubblesRef.current = maxVisibleAmbientCommentBubbles;
  const handleAmbientBubblePress = useCallback((bubble: {
    property: GroupPreviewProperty;
    coordinate: [number, number];
  }) => {
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
  }, [interaction]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        clearLocalPreviewRouteCache();
        resetTransientUI();
        clearAmbientCommentBubbles();
        setSearchResetToken((value) => value + 1);
      };
    }, [clearAmbientCommentBubbles, resetTransientUI]),
  );

  const selectedMarkerCoordinate = useMemo<[number, number] | null>(() => {
    if (highlightedCoordinate) {
      return highlightedCoordinate;
    }

    const selectedGeometry = selectedProperty?.geometry;
    if (selectedGeometry?.type === 'Point') {
      return selectedGeometry.coordinates;
    }

    return interaction.previewGroup?.coordinate ?? null;
  }, [highlightedCoordinate, interaction.previewGroup, selectedProperty?.geometry]);
  const currentPreviewProperty = useMemo(() => {
    if (!interaction.previewGroup) {
      return null;
    }

    return interaction.previewGroup.properties[interaction.currentPreviewIndex] ?? null;
  }, [interaction.currentPreviewIndex, interaction.previewGroup]);
  const previewRouteInput = useMemo(
    () =>
      extractCanonicalRouteInput(
        (selectedPropertyForSheet as
          | (typeof selectedPropertyForSheet & {
              streetName?: string | null;
              houseNumber?: string | number | null;
              houseNumberAddition?: string | null;
            })
          | null) ?? null,
      ) ?? extractCanonicalRouteInput(currentPreviewProperty),
    [currentPreviewProperty, selectedPropertyForSheet],
  );
  const previewCanonicalPath = useMemo(
    () => (previewRouteInput ? buildCanonicalMapPreviewPath(previewRouteInput) : null),
    [previewRouteInput],
  );
  const previewOpenRef = useRef(false);
  previewOpenRef.current = !!interaction.previewGroup || !!interaction.highlightedCoordinate;
  const replaceMapBrowserPath = useCallback(
    (pathname: string) => {
      const nextHref = appendSearchToPath(pathname, browserSearchRef.current);
      return replacePassiveBrowserPath(nextHref);
    },
    [],
  );

  const syncVisibleZoom = useCallback((zoom: number) => {
    currentZoomRef.current = zoom;

    if (__DEV__) {
      setVisibleZoom((prev) => (Math.abs(prev - zoom) < 0.05 ? prev : zoom));
    }
  }, []);

  // Dynamic city name for the map header
  const { cityName, setSearchCity, onViewportCenterChanged } = useMapCityName();
  // Ref bridge so the map init effect (which runs once) can call the latest onViewportCenterChanged
  const onViewportCenterChangedRef = useRef(onViewportCenterChanged);
  onViewportCenterChangedRef.current = onViewportCenterChanged;

  // Refs for building single-property preview when useProperty data arrives (web deferred pattern)
  const pendingSinglePreview = useRef(false);
  const clickCoordRef = useRef<[number, number] | null>(null);
  const clickActivityRef = useRef(0);
  const pendingSinglePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSinglePreviewSelection = useCallback(() => {
    if (pendingSinglePreviewTimerRef.current) {
      clearTimeout(pendingSinglePreviewTimerRef.current);
      pendingSinglePreviewTimerRef.current = null;
    }
    pendingSinglePreview.current = false;
    clickCoordRef.current = null;
  }, []);

  const scheduleSinglePreviewSelection = useCallback(
    (propertyId: string, coord: [number, number], activityScore: number, duration: number) => {
      cancelPendingSinglePreviewSelection();
      pendingSinglePreview.current = true;
      clickCoordRef.current = coord;
      clickActivityRef.current = activityScore;
      setHighlightedCoordinate(coord);

      pendingSinglePreviewTimerRef.current = setTimeout(() => {
        pendingSinglePreviewTimerRef.current = null;
        startTransition(() => {
          setSelectedPropertyId(propertyId);
        });
      }, duration);
    },
    [cancelPendingSinglePreviewSelection, setHighlightedCoordinate, setSelectedPropertyId],
  );

  // Build a camera adapter for the shared hook (wraps maplibregl.Map)
  const cameraCommands: MapCameraCommands = useMemo(() => ({
    flyTo: (opts) => {
      const map = mapRef.current;
      const offset = map && opts.anchor
        ? (() => {
          const container = map.getContainer();
          const { x, y } = viewportAnchorToOffset(
            {
              width: container.clientWidth,
              height: container.clientHeight,
            },
            opts.anchor,
          );
          return [x, y] as [number, number];
        })()
        : undefined;

      map?.flyTo({
        center: opts.center,
        zoom: opts.zoom,
        duration: opts.duration,
        essential: true,
        ...(offset ? { offset } : {}),
      });
    },
    fitBounds: (bounds, opts) => {
      mapRef.current?.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: opts.padding, maxZoom: 18 },
      );
    },
  }), []);

  const handleCurrentLocationPress = useCallback(async () => {
    try {
      const { longitude, latitude } = await getCurrentLocation();
      const targetZoom = Math.max(currentZoomRef.current, 16);
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: targetZoom,
        duration: 800,
        essential: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get current location';
      console.warn('[MapScreen] Current location failed:', message);
      Alert.alert('Location unavailable', message);
    }
  }, []);

  const clearAmbientBubbleRefreshTimeout = useCallback(() => {
    if (ambientBubbleRefreshTimeoutRef.current) {
      clearTimeout(ambientBubbleRefreshTimeoutRef.current);
      ambientBubbleRefreshTimeoutRef.current = null;
    }
  }, []);

  const collectVisibleAmbientBubbleNodes = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return [];
    }

    const container = map.getContainer();
    if (container.clientWidth <= 0 || container.clientHeight <= 0) {
      return [];
    }

    const features = map.queryRenderedFeatures(
      [[0, 0], [container.clientWidth, container.clientHeight]],
      { layers: PROPERTY_LAYER_IDS },
    ) as unknown as GeoJSON.Feature[];
    const visibleNodes = new Map<string, ReturnType<typeof toAmbientBubbleVisibleNode>>();

    for (const feature of features) {
      const group = normalizeRenderedPropertyGroup(feature);
      if (!group || group.commentCount <= 0) {
        continue;
      }

      const candidatePropertyIds = Array.from(
        new Set(
          (group.groupKind === 'cluster'
            ? (group.previewPropertyIds.length > 0 ? group.previewPropertyIds : group.propertyIds)
            : [group.primaryPropertyId]
          ).filter(Boolean),
        ),
      );
      if (candidatePropertyIds.length === 0) {
        continue;
      }

      const projectedPoint = map.project(group.coordinate);
      const property = toGroupProperty({
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
      }, group.activityScore);

      const nodeKey = group.groupKind === 'cluster'
        ? `cluster:${group.primaryPropertyId}:${group.coordinate[0]}:${group.coordinate[1]}`
        : `property:${group.primaryPropertyId}`;

      visibleNodes.set(nodeKey, toAmbientBubbleVisibleNode({
        nodeKey,
        property,
        coordinate: group.coordinate,
        screenPoint: [projectedPoint.x, projectedPoint.y],
        commentCount: group.commentCount,
        likeCount: group.likeCount,
        activityScore: group.activityScore,
        hasListing: group.hasListing,
        nodeClass: group.nodeClass,
        candidatePropertyIds,
      }));
    }

    return Array.from(visibleNodes.values());
  }, [toGroupProperty]);

  const refreshAmbientCommentBubbles = useCallback(async (
    options?: RefreshAmbientCommentBubblesOptions,
  ) => {
    if (!ambientBubblesEnabled) {
      clearAmbientCommentBubbles();
      return;
    }

    const visibleNodes = await collectVisibleAmbientBubbleNodes();
    const placementViewportSize = (() => {
      const map = mapRef.current;
      if (map) {
        const container = map.getContainer();
        return {
          width: container.clientWidth,
          height: container.clientHeight,
        };
      }

      return {
        width: typeof window === 'undefined' ? 0 : window.innerWidth,
        height: typeof window === 'undefined' ? 0 : window.innerHeight,
      };
    })();

    await refreshAmbientCommentBubbleItems(visibleNodes, {
      ...options,
      placementContext: {
        ...(options?.placementContext ?? {}),
        viewportSize: placementViewportSize,
      },
    });
  }, [
    ambientBubblesEnabled,
    clearAmbientCommentBubbles,
    collectVisibleAmbientBubbleNodes,
    refreshAmbientCommentBubbleItems,
  ]);

  const scheduleAmbientCommentBubbleRefresh = useCallback((
    options?: RefreshAmbientCommentBubblesOptions,
  ) => {
    clearAmbientBubbleRefreshTimeout();

    if (!ambientBubblesEnabled) {
      clearAmbientCommentBubbles();
      return;
    }

    ambientBubbleRefreshTimeoutRef.current = setTimeout(() => {
      ambientBubbleRefreshTimeoutRef.current = null;
      void refreshAmbientCommentBubbles(options);
    }, AMBIENT_BUBBLE_SETTLE_DELAY_MS);
  }, [
    ambientBubblesEnabled,
    clearAmbientCommentBubbles,
    clearAmbientBubbleRefreshTimeout,
    refreshAmbientCommentBubbles,
  ]);
  scheduleAmbientCommentBubbleRefreshRef.current = scheduleAmbientCommentBubbleRefresh;

  useEffect(() => {
    scheduleAmbientCommentBubbleRefresh();
  }, [
    ambientBubblesEnabled,
    filterController.appliedFilters,
    mapLoaded,
    scheduleAmbientCommentBubbleRefresh,
    webViewportSize.height,
    webViewportSize.width,
  ]);

  useEffect(() => () => {
    clearAmbientBubbleRefreshTimeout();
  }, [clearAmbientBubbleRefreshTimeout]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;

    async function initMap() {
      let style: maplibregl.StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        style = replacePropertySourceTiles(
          await res.json(),
          propertyTileUrlRef.current,
        );
      } catch {
        style = STYLE_URL;
      }

      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: getPitchForZoom(DEFAULT_ZOOM),
        bearing: DEFAULT_BEARING,
        maxPitch: 70,
        touchPitch: false,
        pitchWithRotate: false,
        transformCameraUpdate: ({ zoom }) => ({
          pitch: getPitchForZoom(Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM),
        }),
      });
      lastSettledAmbientBubbleZoomRef.current = map.getZoom();

      map.keyboard.disableRotation();

      const zoomControl = new maplibregl.NavigationControl({
        showZoom: true,
        showCompass: false,
      });
      const compassControl = new maplibregl.NavigationControl({
        showZoom: false,
        showCompass: true,
      });

      map.addControl(zoomControl, 'top-right');
      map.addControl(compassControl, 'bottom-right');

      const controlGroups = Array.from(
        map.getContainer().querySelectorAll('.maplibregl-ctrl-group')
      ) as HTMLDivElement[];
      const zoomContainer = controlGroups.find(
        (container) =>
          !!container.querySelector('.maplibregl-ctrl-zoom-in') &&
          !!container.querySelector('.maplibregl-ctrl-zoom-out')
      );
      if (zoomContainer) {
        zoomContainer.classList.add('maplibregl-ctrl-floating-zoom');
        zoomContainer.dataset.testid = 'map-zoom-control';
      }

      const compassContainer = controlGroups.find(
        (container) =>
          !!container.querySelector('.maplibregl-ctrl-compass') &&
          !container.querySelector('.maplibregl-ctrl-zoom-in')
      );
      const compassButton = compassContainer?.querySelector('.maplibregl-ctrl-compass') as HTMLButtonElement | null;
      if (compassContainer && compassButton) {
        compassContainer.classList.add('maplibregl-ctrl-standalone-compass');
        compassContainer.classList.add('maplibregl-ctrl-standalone-compass--hidden');
        compassContainer.dataset.testid = 'map-standalone-compass-control';
        compassButton.dataset.testid = 'map-compass-button';
      }

      const syncCompassVisibility = () => {
        if (!compassContainer) return;
        const isHidden = isMapFacingNorth(map.getBearing());
        compassContainer.classList.toggle('maplibregl-ctrl-standalone-compass--hidden', isHidden);
        compassContainer.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
      };
      map.on('rotate', syncCompassVisibility);
      syncCompassVisibility();

      // Debug: copy camera button
      if (DEBUG_CAMERA) {
        const btn = document.createElement('button');
        btn.textContent = '\u{1F4CB}';
        btn.title = 'Copy camera position';
        Object.assign(btn.style, {
          position: 'absolute', bottom: '120px', right: '10px', zIndex: '2',
          width: '30px', height: '30px', borderRadius: '4px',
          border: '1px solid #ccc', background: '#fff', cursor: 'pointer',
          fontSize: '16px', lineHeight: '1',
        });
        btn.addEventListener('click', () => {
          const c = map.getCenter();
          const z = map.getZoom();
          const snippet = `{ center: [${c.lng.toFixed(5)}, ${c.lat.toFixed(5)}] as [number, number], zoom: ${z.toFixed(1)} }`;
          navigator.clipboard.writeText(snippet);
          btn.textContent = '\u2713';
          btn.style.background = '#D1FAE5';
          setTimeout(() => { btn.textContent = '\u{1F4CB}'; btn.style.background = '#fff'; }, 1500);
        });
        map.getContainer().appendChild(btn);
      }

      // Expose map instance for testing
      if (typeof window !== 'undefined') {
        (window as unknown as { __mapInstance: maplibregl.Map }).__mapInstance = map;
      }

      // Expose bottom sheet ref for testing
      if (typeof window !== 'undefined') {
        (window as unknown as { __bottomSheetRef: typeof bottomSheetRef }).__bottomSheetRef =
          bottomSheetRef;
      }

      // Expose auth modal trigger for testing
      if (typeof window !== 'undefined') {
        (
          window as unknown as { __triggerAuthModal: (copy?: AuthModalCopyInput) => void }
        ).__triggerAuthModal = (copy?: AuthModalCopyInput) => {
          handleAuthRequired(copy);
        };
      }

      // Ensure the map canvas matches its container once the flex layout settles.
      // Without this early resize, tiles load but nothing paints (canvas stays
      // transparent), so the 'load' event never fires and the map appears blank.
      // We call resize() on 'style.load' (fires before 'load') and also after a
      // short delay as a belt-and-suspenders measure for static-export/nginx setups
      // where the container dimensions may not be final at Map construction time.
      map.once('style.load', () => {
        map.resize();
      });
      setTimeout(() => {
        if (!cancelled && map.getCanvas()) {
          map.resize();
        }
      }, 200);

      const markMapLoaded = () => {
        clearTimeout(loadTimeout);
        setMapLoaded(true);
        syncVisibleZoom(map.getZoom());
      };

      // Timeout fallback: dismiss loading overlay after 15s even if 'load' doesn't fire
      loadTimeout = setTimeout(() => {
        if (!cancelled) {
          map.resize();
          markMapLoaded();
          console.warn('[MapScreen] Map load timed out after 15s');
        }
      }, 15000);

      map.on('load', () => {
        markMapLoaded();

        // Enhance base map colors (imperative overrides on top of server-provided style)
        enhanceBaseMapColors(map);
        enhanceVegetationColors(map);

        setTimeout(() => {
          map.resize();
        }, 100);
      });

      // Some static-export runs paint and become interactive without reliably
      // delivering the one-shot `load` event. Once the map reaches `idle`, the
      // first complete render has happened and the loading overlay can go away.
      map.on('idle', () => {
        if (!cancelled) {
          markMapLoaded();
        }
      });

      map.on('error', (e: maplibregl.ErrorEvent) => {
        console.warn('[MapScreen] MapLibre error:', e.error?.message || e);
      });

      // Keep the current zoom in a ref for imperative consumers without forcing
      // a React re-render on every wheel/touch zoom frame.
      map.on('zoom', () => {
        const zoom = map.getZoom();
        currentZoomRef.current = zoom;
      });
      map.on('zoomend', () => {
        const zoom = map.getZoom();
        currentZoomRef.current = zoom;
        syncVisibleZoom(zoom);
      });

      // Track viewport center for dynamic city name (reverse geocoding)
      // Fire on 'moveend' — covers pan, zoom, fly, programmatic camera moves.
      map.on('moveend', () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        const previousSettledBubbleZoom = lastSettledAmbientBubbleZoomRef.current;
        lastSettledAmbientBubbleZoomRef.current = zoom;
        const previousCameraPath = lastCameraPathRef.current;
        const nextCameraPath = serializeCanonicalCameraPath({
          lat: center.lat,
          lng: center.lng,
          zoom,
        });
        lastCameraPathRef.current = nextCameraPath;
        onViewportCenterChangedRef.current(center.lng, center.lat, zoom);
        const passiveSyncResult = syncPassiveCameraPathOnMoveEnd({
          browserPathname: browserPathRef.current,
          nextCameraPath,
          previousCameraPath,
          lockedAreaPath: lockedAreaPathRef.current,
          canReplaceLockedAreaPath: canReplaceLockedAreaPathRef.current,
          previewOpen: previewOpenRef.current,
          skipNextPassiveUrlSync: skipNextPassiveUrlSyncRef.current,
          replaceBrowserPath: replaceMapBrowserPath,
        });
        browserPathRef.current = passiveSyncResult.browserPathname;
        lockedAreaPathRef.current = passiveSyncResult.lockedAreaPath;
        skipNextPassiveUrlSyncRef.current =
          passiveSyncResult.skipNextPassiveUrlSync;

        const didConsiderablyZoomOut =
          previousSettledBubbleZoom !== null &&
          previousSettledBubbleZoom - zoom >= AMBIENT_BUBBLE_RESET_ZOOM_OUT_DELTA;

        if (didConsiderablyZoomOut) {
          clearAmbientCommentBubbles();
          scheduleAmbientCommentBubbleRefreshRef.current();
          return;
        }

        if (
          ambientBubbleVisibleCountRef.current < maxVisibleAmbientCommentBubblesRef.current
        ) {
          scheduleAmbientCommentBubbleRefreshRef.current({
            appendToExisting: true,
            minimumVisibleCount: maxVisibleAmbientCommentBubblesRef.current,
            preserveRotation: true,
          });
        }
      });

      // Trigger initial reverse geocode for the default camera position
      onViewportCenterChangedRef.current(DEFAULT_CENTER[0], DEFAULT_CENTER[1], DEFAULT_ZOOM);
      lastCameraPathRef.current = serializeCanonicalCameraPath({
        lat: DEFAULT_CENTER[1],
        lng: DEFAULT_CENTER[0],
        zoom: DEFAULT_ZOOM,
      });

      // Track map gestures to prevent preview card from closing during pan/zoom/rotate
      map.on('dragstart', () => {
        isDragging.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('dragend', () => { setTimeout(() => { isDragging.current = false; }, 100); });
      map.on('zoomstart', () => {
        isZooming.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('zoomend', () => { setTimeout(() => { isZooming.current = false; }, 100); });
      map.on('rotatestart', () => {
        isRotating.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('rotateend', () => { setTimeout(() => { isRotating.current = false; }, 100); });

      // Handle click on property points
      const handlePropertyClick = async (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
      ) => {
        if (!e.features?.length) return;

        propertyClickHandled.current = true;
        if (propertyClickResetTimer.current) {
          clearTimeout(propertyClickResetTimer.current);
        }
        propertyClickResetTimer.current = setTimeout(() => {
          propertyClickHandled.current = false;
          propertyClickResetTimer.current = null;
        }, 0);

        await handleFeaturePress(
          e.features as unknown as GeoJSON.Feature[],
          map.getZoom(),
          cameraCommands,
        );
      };

      // Handle any unhandled map click as a background tap.
      // Layer-specific property handlers set `propertyClickHandled`, so
      // re-querying rendered features here only creates false negatives
      // when dense tiles overlap the clicked background point.
      map.on('click', (_e: maplibregl.MapMouseEvent) => {
        if (propertyClickHandled.current) {
          return;
        }

        if (isDragging.current || isZooming.current || isRotating.current) {
          return;
        }

        cancelPendingSinglePreviewSelection();
        handleEmptyMapTapRef.current();
      });

      // Named cursor handlers so they can be properly removed/re-added
      const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
      const handleMouseLeave = () => { map.getCanvas().style.cursor = ''; };

      // Wait for layers to be added
      const layerHandlersAttached = new Set<string>();
      map.on('sourcedata', () => {
        PROPERTY_LAYER_IDS.forEach((layerId) => {
          if (map.getLayer(layerId)) {
            if (!layerHandlersAttached.has(layerId)) {
              layerHandlersAttached.add(layerId);
            }
            map.off('click', layerId, handlePropertyClick);
            map.off('mouseenter', layerId, handleMouseEnter);
            map.off('mouseleave', layerId, handleMouseLeave);
            map.on('click', layerId, handlePropertyClick);
            map.on('mouseenter', layerId, handleMouseEnter);
            map.on('mouseleave', layerId, handleMouseLeave);
          }
        });
      });

      mapRef.current = map;
    }

    initMap();

    return () => {
      cancelled = true;
      clearTimeout(loadTimeout);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (propertyClickResetTimer.current) {
        clearTimeout(propertyClickResetTimer.current);
        propertyClickResetTimer.current = null;
      }
      cancelPendingSinglePreviewSelection();
    };
  }, [
    bottomSheetRef,
    cameraCommands,
    cancelPendingSinglePreviewSelection,
    clearAmbientCommentBubbles,
    handleAuthRequired,
    handleFeaturePress,
    replaceMapBrowserPath,
    scheduleSinglePreviewSelection,
    syncVisibleZoom,
  ]);

  // Build previewGroup from selectedProperty when single-property click data arrives (web deferred pattern)
  useEffect(() => {
    if (selectedProperty && pendingSinglePreview.current && clickCoordRef.current) {
      const gpp = toGroupProperty(
        selectedProperty,
        clickActivityRef.current,
      );
      setPreviewGroup({ properties: [gpp], coordinate: clickCoordRef.current });
      setCurrentPreviewIndex(0);
      pendingSinglePreview.current = false;
    }
  }, [selectedProperty, setPreviewGroup, setCurrentPreviewIndex, toGroupProperty]);

  // Search bar callbacks (adapting shared hook to local camera commands)
  const handlePropertyResolved = useCallback(
    (property: PropertyResolveResult, resolvedAddress?: ResolvedAddress) => {
      // On web, single-property search also uses the deferred pattern
      const { lon, lat } = property.coordinates;
      const coord: [number, number] = [lon, lat];

      cameraCommands.flyTo({ center: coord, zoom: SEARCH_TARGET_ZOOM, duration: 1000 });
      scheduleSinglePreviewSelection(property.id, coord, 0, 1000);

      // Set the search city from the resolved property
      const city = property.city || resolvedAddress?.details.city;
      if (city) {
        setSearchCity(city, coord);
      }
    },
    [cameraCommands, scheduleSinglePreviewSelection, setSearchCity],
  );

  const handleLocationResolved = useCallback(
    (
      coordinates: { lon: number; lat: number },
      address: string,
      resolvedAddress?: ResolvedAddress,
    ) => {
      handleMapLocationResolved(coordinates, address, cameraCommands);
      const cityFromAddress =
        resolvedAddress?.details.city || extractCityFromAddress(address);
      if (cityFromAddress) {
        setSearchCity(cityFromAddress, [coordinates.lon, coordinates.lat]);
      }
    },
    [handleMapLocationResolved, cameraCommands, setSearchCity],
  );

  useEffect(() => {
    const nextRoutePathname = pathnameOverride ?? getCurrentBrowserPathname('/');
    setRoutePathname((currentPathname) =>
      currentPathname === nextRoutePathname ? currentPathname : nextRoutePathname,
    );
    browserPathRef.current = nextRoutePathname;
  }, [pathnameOverride]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handlePopState = () => {
      const nextPathname = getCurrentBrowserPathname('/');
      browserSearchRef.current = window.location.search || '';
      replaceAppliedFilters(
        parseMapFiltersFromSearchParams(
          new URLSearchParams(browserSearchRef.current),
        ),
      );
      browserPathRef.current = nextPathname;
      setRoutePathname(nextPathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [replaceAppliedFilters]);

  useEffect(() => {
    browserSearchRef.current = getMapFilterSearchString(
      filterController.appliedFilters,
      browserSearchRef.current,
    );
    replaceMapBrowserPath(browserPathRef.current);
  }, [appliedFilterSignature, filterController.appliedFilters, replaceMapBrowserPath]);

  useEffect(() => {
    if (!interaction.previewGroup || !previewCanonicalPath || !previewRouteInput) {
      return;
    }

    const previewSource = interaction.selectedPropertyForSheet ?? currentPreviewProperty;
    if (!previewSource?.id || !previewSource.address || !previewSource.city) {
      return;
    }

    registerLocalPreviewRoute(
      previewCanonicalPath,
      {
        id: previewSource.id,
        address: previewSource.address,
        city: previewSource.city,
        postalCode: previewSource.postalCode ?? null,
        countryCode: previewSource.countryCode ?? undefined,
        coordinates: {
          lon: interaction.previewGroup.coordinate[0],
          lat: interaction.previewGroup.coordinate[1],
        },
        hasListing: false,
        officialValuation: previewSource.officialValuation ?? null,
        askingPrice: previewSource.askingPrice ?? null,
        thumbnailUrl: previewSource.thumbnailUrl ?? null,
        aerialImageUrl: previewSource.aerialImageUrl ?? null,
      } as PropertyResolveResult,
      previewRouteInput,
    );
  }, [
    currentPreviewProperty,
    interaction.previewGroup,
    interaction.selectedPropertyForSheet,
    previewCanonicalPath,
    previewRouteInput,
  ]);

  useEffect(() => {
    const resolvedRoute = routeState.resolvedRoute;
    const map = mapRef.current;
    if (!resolvedRoute || !map || !mapLoaded || routeState.isLoading) {
      return;
    }

    if (resolvedRoute.kind === 'invalid') {
      interaction.handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      appliedRoutePathRef.current = routeState.pathname;
      replaceMapBrowserPath('/');
      browserPathRef.current = '/';
      setRoutePathname('/');
      return;
    }

    const explicitCanonicalHref = getExplicitCanonicalReplaceHref(
      routeState.pathname,
      resolvedRoute,
    );
    if (explicitCanonicalHref) {
      if (
        resolvedRoute.kind === 'property' ||
        resolvedRoute.kind === 'comments' ||
        resolvedRoute.kind === 'guesses'
      ) {
        router.navigate(toInternalAppHref(explicitCanonicalHref));
        return;
      }

      if (replaceMapBrowserPath(explicitCanonicalHref)) {
        browserPathRef.current = explicitCanonicalHref;
        setRoutePathname((currentPathname) =>
          currentPathname === explicitCanonicalHref ? currentPathname : explicitCanonicalHref,
        );
      }
      return;
    }

    if (
      resolvedRoute.kind === 'property' ||
      resolvedRoute.kind === 'comments' ||
      resolvedRoute.kind === 'guesses'
    ) {
      router.navigate(routeState.pathname as Href);
      return;
    }

    if (appliedRoutePathRef.current === routeState.pathname) {
      return;
    }

    if (resolvedRoute.kind === 'root') {
      interaction.handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'camera') {
      interaction.handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      map.jumpTo({
        center: [resolvedRoute.camera.lng, resolvedRoute.camera.lat],
        zoom: resolvedRoute.camera.zoom,
      });
      lastCameraPathRef.current = resolvedRoute.canonicalPath;
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'city' || resolvedRoute.kind === 'postcode') {
      interaction.handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = resolvedRoute.canonicalPath;
      canReplaceLockedAreaPathRef.current = false;
      map.jumpTo({
        center: resolvedRoute.center,
        zoom: resolvedRoute.zoom,
      });
      lastCameraPathRef.current = serializeCanonicalCameraPath({
        lat: resolvedRoute.center[1],
        lng: resolvedRoute.center[0],
        zoom: resolvedRoute.zoom,
      });
      setSearchCity(resolvedRoute.cityName, resolvedRoute.center);
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'preview') {
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      if (previewCanonicalPath === resolvedRoute.canonicalPath && interaction.previewGroup) {
        appliedRoutePathRef.current = routeState.pathname;
        return;
      }

      skipNextPassiveUrlSyncRef.current = true;
      if (lastCameraPathRef.current === '/') {
        lastCameraPathRef.current = serializeCanonicalCameraPath({
          lat: resolvedRoute.property.coordinates.lat,
          lng: resolvedRoute.property.coordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
      }
      handlePropertyResolved(resolvedRoute.property, resolvedRoute.resolvedAddress);
      setSearchCity(resolvedRoute.property.city, [
        resolvedRoute.property.coordinates.lon,
        resolvedRoute.property.coordinates.lat,
      ]);
      appliedRoutePathRef.current = routeState.pathname;
    }
  }, [
    currentPreviewProperty,
    handlePropertyResolved,
    interaction,
    mapLoaded,
    previewCanonicalPath,
    routeState.isLoading,
    routeState.pathname,
    routeState.resolvedRoute,
    replaceMapBrowserPath,
    setSearchCity,
  ]);

  useEffect(() => {
    if (routeState.isLoading || !mapRef.current) {
      return;
    }

    if (interaction.previewGroup && previewCanonicalPath) {
      previousPreviewPathRef.current = previewCanonicalPath;
      if (browserPathRef.current !== previewCanonicalPath) {
        replaceMapBrowserPath(previewCanonicalPath);
        browserPathRef.current = previewCanonicalPath;
      }
      return;
    }

    if (!previousPreviewPathRef.current) {
      return;
    }

    previousPreviewPathRef.current = null;

    if (
      lastCameraPathRef.current &&
      browserPathRef.current !== lastCameraPathRef.current
    ) {
      replaceMapBrowserPath(lastCameraPathRef.current);
      browserPathRef.current = lastCameraPathRef.current;
    }
  }, [
    interaction.previewGroup,
    previewCanonicalPath,
    replaceMapBrowserPath,
    routeState.isLoading,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) {
      return;
    }

    const source = map.getSource(PROPERTY_VECTOR_SOURCE_ID) as
      | (maplibregl.Source & {
          setTiles?: (tiles: string[]) => void;
          serialize?: () => { tiles?: string[] };
        })
      | undefined;

    if (!source?.setTiles) {
      return;
    }

    const currentTiles = source.serialize?.().tiles ?? [];
    if (currentTiles[0] === propertyTileUrl) {
      return;
    }

    source.setTiles([propertyTileUrl]);
  }, [appliedFilterSignature, mapLoaded, propertyTileUrl]);

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
  }, [
    currentPreviewProperty,
    filterController.appliedFilters,
    interaction,
  ]);

  // Manage selected marker with pulsing animation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.remove();
      selectedMarkerRef.current = null;
    }

    if (selectedMarkerCoordinate) {
      const markerElement = createSelectedMarkerElement();
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat(selectedMarkerCoordinate)
        .addTo(map);

      selectedMarkerRef.current = marker;
    }

    return () => {
      if (selectedMarkerRef.current) {
        selectedMarkerRef.current.remove();
        selectedMarkerRef.current = null;
      }
    };
  }, [selectedMarkerCoordinate]);

  return (
    <View className="flex-1 bg-warm-100">
      {/* Map View */}
      <View className="flex-1" style={{ position: 'relative' }}>
        <div
          ref={mapContainerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
          }}
          data-testid="map-view"
        />

        <View
          pointerEvents="none"
          style={MAP_OVERLAY_STYLE}
        />

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View
            className="absolute inset-0 items-center justify-center bg-warm-100"
            style={MAP_LOADING_STYLE}
            testID="map-loading-indicator"
          >
            <View className="items-center">
              <View
                className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full"
                style={MAP_LOADING_SPINNER_STYLE}
              />
              <Text className="text-warm-600 mt-3 text-base">Loading map...</Text>
            </View>
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
        />

        <MapFilterBar controller={filterController} />

        {/* Zoom level indicator (debug camera only) */}
        {DEBUG_CAMERA && (
          <View
            className="bg-surface-card/90 px-3 py-2 rounded-full shadow-md"
            style={MAP_DEBUG_ZOOM_STYLE}
          >
            <Text className="text-sm text-warm-700">Zoom: {visibleZoom.toFixed(1)}</Text>
          </View>
        )}

        {/* Location button — bottom-right of map, above tab bar */}
        <View
          style={MAP_LOCATION_BUTTON_STYLE}
        >
          <LocationButton testID="location-button" onPress={handleCurrentLocationPress} />
        </View>

        <WebPreviewMarkerPortal
          map={mapRef.current}
          previewGroup={interaction.previewGroup}
          currentIndex={interaction.currentPreviewIndex}
          markerOffsetPx={PREVIEW_CARD_MARKER_OFFSET_PX}
          onIndexChange={interaction.setCurrentPreviewIndex}
          onClose={interaction.handleClosePreview}
          onPropertyTap={interaction.handlePreviewPropertyTap}
          onLike={interaction.handleLike}
          onComment={interaction.handleComment}
          onGuess={interaction.handleGuess}
          isLiked={interaction.isLiked}
        />

        <WebAmbientCommentBubblesPortal
          map={mapRef.current}
          bubbles={ambientCommentBubbleItems}
          onBubblePress={handleAmbientBubblePress}
        />

      </View>

      {/* Property details side panel (unified PropertyBottomSheet resolves to .web.tsx) */}
      <PropertyBottomSheet
        ref={interaction.bottomSheetRef}
        property={interaction.selectedPropertyForSheet ?? null}
        isLoading={interaction.selectedPropertyLoading}
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

      {/* Auth Modal */}
      <AuthModal
        visible={interaction.showAuthModal}
        onClose={interaction.handleAuthModalClose}
        copy={interaction.authCopy}
        onSuccess={interaction.handleAuthSuccess}
        onAuthStarting={interaction.handleAuthStarting}
      />
    </View>
  );
}

import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, type Href, usePathname } from 'expo-router';
import maplibregl from 'maplibre-gl';

import { CommentsRouteScreen } from '@/app/comments/[propertyId]';
import { GuessesRouteScreen } from '@/app/guesses/[propertyId]';
import { PropertyDetailRouteScreen } from '@/app/property/[id]';
import {
  AuthModal,
  SearchBar,
  PropertyBottomSheet,
} from '@/src/components';
import { WebPreviewMarkerPortal } from '@/src/components/WebPreviewMarkerPortal';
import { useMapInteraction, type MapCameraCommands } from '@/src/hooks/useMapInteraction';
import { useMapCityName, extractCityFromAddress } from '@/src/hooks/useMapCityName';
import type { AuthModalCopyInput } from '@/src/lib/authModalCopy';
import { API_URL, fetchBatchProperties, type PropertyResolveResult } from '@/src/utils/api';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import {
  PREVIEW_CARD_VIEWPORT_ANCHOR,
  viewportAnchorToOffset,
} from '@/src/lib/mapCameraAnchor';
import {
  extractCanonicalRouteInput,
  type ResolvedMapRoute,
} from '@/src/lib/mapRoute';
import { isMapFacingNorth } from '@/src/lib/mapCompass';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import { queryPrioritizedRenderedPropertyFeatures } from '@/src/lib/mapClick';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';
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
import {
  buildCanonicalRouteHref,
  buildPropertyMapRoute,
  buildPropertyRoute,
  isStaticAppRoutePath,
} from '@/src/utils/property-route';
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
const PREVIEW_FLY_DURATION_MS = 500;
const SELECTED_MARKER_CONTAINER_SIZE_PX = 24;
const SELECTED_MARKER_PULSE_SIZE_PX = 32;
const SELECTED_MARKER_DOT_SIZE_PX = 18;
const PREVIEW_ARROW_SIZE_PX = 10;
const PREVIEW_ARROW_MARKER_GAP_PX = 6;
const PREVIEW_CARD_MARKER_OFFSET_PX =
  SELECTED_MARKER_CONTAINER_SIZE_PX + PREVIEW_ARROW_SIZE_PX + PREVIEW_ARROW_MARKER_GAP_PX;
const SEARCH_TARGET_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM + 1;

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
  if (skipNextPassiveUrlSync) {
    if (nextCameraPath === previousCameraPath) {
      return {
        browserPathname,
        lockedAreaPath,
        skipNextPassiveUrlSync: false,
      };
    }
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

export function getExplicitCanonicalReplaceHref(
  pathname: string,
  resolvedRoute: ResolvedMapRoute,
  returnTo?: string | string[] | null,
): Href | null {
  if (
    resolvedRoute.canonicalPath === pathname ||
    resolvedRoute.kind === 'root' ||
    resolvedRoute.kind === 'camera'
  ) {
    return null;
  }

  return buildCanonicalRouteHref(resolvedRoute.canonicalPath, returnTo) as Href;
}

// Vegetation configuration
const VEGETATION_CONFIG = {
  minZoom: 14,
  colors: {
    forest: '#4CAF50',
    park: '#66BB6A',
    grass: '#C8E6C9',
    tree: '#43A047',
    treeTrunk: '#8D6E63',
  },
};

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

export default function PersistentWebMapScreen({ pathnameOverride }: MapScreenProps = {}) {
  const routedPathname = usePathname();
  const returnTo = undefined;
  const initialRoutePathname = pathnameOverride ?? routedPathname;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const currentZoomRef = useRef(DEFAULT_ZOOM);
  const [visibleZoom, setVisibleZoom] = useState(DEFAULT_ZOOM);
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [routePathname, setRoutePathname] = useState(initialRoutePathname);
  const routeState = useResolvedMapRoute(routePathname);
  const isStaticAppRoute = isStaticAppRoutePath(routeState.pathname);
  const shouldManageMapRoute = !isStaticAppRoute;
  const appliedRoutePathRef = useRef<string | null>(null);
  const skipNextPassiveUrlSyncRef = useRef(true);
  const lastCameraPathRef = useRef<string>('/');
  const lastReplacedUrlRef = useRef<string | null>(null);
  const previousPreviewPathRef = useRef<string | null>(null);
  const lockedAreaPathRef = useRef<string | null>(null);
  const canReplaceLockedAreaPathRef = useRef(true);
  const browserPathRef = useRef(getCurrentBrowserPathname(initialRoutePathname));

  // Gesture tracking refs to prevent preview card from closing during map gestures
  const isDragging = useRef(false);
  const isZooming = useRef(false);
  const isRotating = useRef(false);

  // Shared map interaction state and logic
  const interaction = useMapInteraction();
  const {
    bottomSheetRef,
    handleAuthRequired,
    handleFeaturePress,
    handleEmptyMapTap,
    handlePropertyResolved: handleMapPropertyResolved,
    resetTransientUI,
    highlightedCoordinate,
    selectedProperty,
    handleLocationResolved: handleMapLocationResolved,
  } = interaction;
  const previewGroup = interaction.previewGroup;
  const currentPreviewIndex = interaction.currentPreviewIndex;
  const selectedPropertyForSheet = interaction.selectedPropertyForSheet;
  const handleClosePreview = interaction.handleClosePreview;
  const handleAuthRequiredRef = useRef(handleAuthRequired);
  handleAuthRequiredRef.current = handleAuthRequired;
  const handleFeaturePressRef = useRef(handleFeaturePress);
  handleFeaturePressRef.current = handleFeaturePress;
  const handleEmptyMapTapRef = useRef(handleEmptyMapTap);
  handleEmptyMapTapRef.current = handleEmptyMapTap;
  const routeLoadingRef = useRef(routeState.isLoading);
  routeLoadingRef.current = routeState.isLoading;
  const shouldManageMapRouteRef = useRef(shouldManageMapRoute);
  shouldManageMapRouteRef.current = shouldManageMapRoute;

  const replaceManagedMapRoute = useCallback(
    (nextPathname: string, href?: Href) => {
      setRoutePathname((currentPathname) =>
        currentPathname === nextPathname ? currentPathname : nextPathname,
      );
      browserPathRef.current = nextPathname;
      router.replace((href ?? nextPathname) as Href);
    },
    [],
  );

  useEffect(() => {
    return () => {
      resetTransientUI();
      setSearchResetToken((value) => value + 1);
    };
  }, [resetTransientUI]);

  const selectedMarkerCoordinate = useMemo<[number, number] | null>(() => {
    if (highlightedCoordinate) {
      return highlightedCoordinate;
    }

    const selectedGeometry = selectedProperty?.geometry;
    if (selectedGeometry?.type === 'Point') {
      return selectedGeometry.coordinates;
    }

    return previewGroup?.coordinate ?? null;
  }, [highlightedCoordinate, previewGroup, selectedProperty?.geometry]);

  const currentPreviewProperty = useMemo(() => {
    if (!previewGroup) {
      return null;
    }

    return previewGroup.properties[currentPreviewIndex] ?? null;
  }, [currentPreviewIndex, previewGroup]);
  const isPreviewSelectionActive = !!interaction.highlightedCoordinate;

  const previewCanonicalPath = useMemo(() => {
    const canonicalRouteInput =
      extractCanonicalRouteInput(
        (selectedPropertyForSheet as
          | (typeof selectedPropertyForSheet & {
              streetName?: string | null;
              houseNumber?: string | number | null;
              houseNumberAddition?: string | null;
            })
          | null) ?? null,
      ) ?? extractCanonicalRouteInput(currentPreviewProperty);

    return canonicalRouteInput ? buildCanonicalMapPreviewPath(canonicalRouteInput) : null;
  }, [currentPreviewProperty, selectedPropertyForSheet]);
  const previewOpenRef = useRef(false);
  previewOpenRef.current = !!previewGroup || isPreviewSelectionActive;

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

  const initialMapView = useMemo(() => {
    if (!shouldManageMapRoute) {
      return {
        center: DEFAULT_CENTER as [number, number],
        zoom: DEFAULT_ZOOM,
      };
    }

    const resolvedRoute = routeState.resolvedRoute;
    if (!resolvedRoute || resolvedRoute.kind === 'invalid' || resolvedRoute.kind === 'root') {
      return {
        center: DEFAULT_CENTER as [number, number],
        zoom: DEFAULT_ZOOM,
      };
    }

    if (resolvedRoute.kind === 'camera') {
      return {
        center: [resolvedRoute.camera.lng, resolvedRoute.camera.lat] as [number, number],
        zoom: resolvedRoute.camera.zoom,
      };
    }

    if (resolvedRoute.kind === 'city' || resolvedRoute.kind === 'postcode') {
      return {
        center: resolvedRoute.center,
        zoom: resolvedRoute.zoom,
      };
    }

    if ('property' in resolvedRoute) {
      return {
        center: [
          resolvedRoute.property.coordinates.lon,
          resolvedRoute.property.coordinates.lat,
        ] as [number, number],
        zoom: SEARCH_TARGET_ZOOM,
      };
    }

    return {
      center: DEFAULT_CENTER as [number, number],
      zoom: DEFAULT_ZOOM,
    };
  }, [shouldManageMapRoute, routeState.resolvedRoute]);
  const initialMapViewRef = useRef(initialMapView);
  initialMapViewRef.current = initialMapView;

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

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;
    let initFrame: number | null = null;

    async function initMap() {
      let style: maplibregl.StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        style = await res.json();
      } catch {
        style = STYLE_URL;
      }

      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: initialMapViewRef.current.center,
        zoom: initialMapViewRef.current.zoom,
        pitch: getPitchForZoom(initialMapViewRef.current.zoom),
        bearing: DEFAULT_BEARING,
        maxPitch: 70,
        touchPitch: false,
        pitchWithRotate: false,
        transformCameraUpdate: ({ zoom }) => ({
          pitch: getPitchForZoom(Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM),
        }),
      });

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
      setMapInstance(map);

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
          handleAuthRequiredRef.current(copy);
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
        if (!shouldManageMapRouteRef.current) {
          return;
        }

        const center = map.getCenter();
        const zoom = map.getZoom();
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
          replaceBrowserPath: replacePassiveBrowserPath,
        });
        browserPathRef.current = passiveSyncResult.browserPathname;
        lockedAreaPathRef.current = passiveSyncResult.lockedAreaPath;
        skipNextPassiveUrlSyncRef.current = passiveSyncResult.skipNextPassiveUrlSync;
      });

      // Trigger initial reverse geocode for the boot camera position
      onViewportCenterChangedRef.current(
        initialMapViewRef.current.center[0],
        initialMapViewRef.current.center[1],
        initialMapViewRef.current.zoom,
      );
      lastCameraPathRef.current = serializeCanonicalCameraPath({
        lat: initialMapViewRef.current.center[1],
        lng: initialMapViewRef.current.center[0],
        zoom: initialMapViewRef.current.zoom,
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

      // Handle any map click by querying the rendered property features at the
      // click point and prioritizing clusters over overlapping single nodes.
      // This keeps cluster previews reachable even when a single-property layer
      // is rendered above the cluster at the same coordinate.
      const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
        if (isDragging.current || isZooming.current || isRotating.current) {
          return;
        }

        const features = queryPrioritizedRenderedPropertyFeatures(
          map,
          e.point,
          [...PROPERTY_LAYER_IDS],
        );

        if (features.length > 0) {
            const handled = await handleFeaturePressRef.current(
              features,
              map.getZoom(),
              cameraCommands,
          );
          if (handled) {
            return;
          }
        }

        handleEmptyMapTapRef.current();
      };

      map.on('click', handleMapClick);

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
            map.off('mouseenter', layerId, handleMouseEnter);
            map.off('mouseleave', layerId, handleMouseLeave);
            map.on('mouseenter', layerId, handleMouseEnter);
            map.on('mouseleave', layerId, handleMouseLeave);
          }
        });
      });

      mapRef.current = map;
    }

    const waitForInit = () => {
      if (
        cancelled ||
        mapRef.current ||
        routeLoadingRef.current ||
        !shouldManageMapRouteRef.current ||
        !mapContainerRef.current
      ) {
        if (!cancelled && !mapRef.current) {
          initFrame = requestAnimationFrame(waitForInit);
        }
        return;
      }

      void initMap();
    };

    waitForInit();

    return () => {
      cancelled = true;
      if (initFrame !== null) {
        cancelAnimationFrame(initFrame);
      }
      clearTimeout(loadTimeout);
      setMapInstance(null);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [bottomSheetRef, cameraCommands, syncVisibleZoom]);

  // Search bar callbacks (adapting shared hook to local camera commands)
  const handlePropertyResolved = useCallback(
    (property: PropertyResolveResult, resolvedAddress?: ResolvedAddress) => {
      handleMapPropertyResolved(property, cameraCommands, resolvedAddress);

      // Set the search city from the resolved property
      const city = property.city || resolvedAddress?.details.city;
      if (city) {
        setSearchCity(city, [property.coordinates.lon, property.coordinates.lat]);
      }
    },
    [cameraCommands, handleMapPropertyResolved, setSearchCity],
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
    if (lastReplacedUrlRef.current === routeState.pathname) {
      lastReplacedUrlRef.current = null;
    }
  }, [routeState.pathname]);

  useEffect(() => {
    const nextRoutePathname = pathnameOverride ?? routedPathname;
    setRoutePathname((currentPathname) =>
      currentPathname === nextRoutePathname ? currentPathname : nextRoutePathname,
    );
    browserPathRef.current = nextRoutePathname;
  }, [pathnameOverride, routedPathname]);

  useEffect(() => {
    if (!shouldManageMapRoute) {
      return;
    }

    const resolvedRoute = routeState.resolvedRoute;
    if (!resolvedRoute) {
      return;
    }

    if (
      resolvedRoute.kind === 'city' ||
      resolvedRoute.kind === 'postcode' ||
      resolvedRoute.kind === 'preview'
    ) {
      lockedAreaPathRef.current = resolvedRoute.canonicalPath;
      canReplaceLockedAreaPathRef.current = false;
      return;
    }

    lockedAreaPathRef.current = null;
    canReplaceLockedAreaPathRef.current = true;
  }, [shouldManageMapRoute, routeState.resolvedRoute]);

  useEffect(() => {
    if (!shouldManageMapRoute) {
      return;
    }

    const resolvedRoute = routeState.resolvedRoute;
    if (!resolvedRoute) {
      return;
    }

    if (resolvedRoute.kind === 'invalid') {
      if (
        previewGroup &&
        previewCanonicalPath &&
        routeState.pathname === previewCanonicalPath
      ) {
        return;
      }

      handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      appliedRoutePathRef.current = routeState.pathname;
      replaceManagedMapRoute('/');
      return;
    }

    const explicitCanonicalHref = getExplicitCanonicalReplaceHref(
      routeState.pathname,
      resolvedRoute,
      returnTo,
    );
    if (explicitCanonicalHref) {
      lastReplacedUrlRef.current = resolvedRoute.canonicalPath;
      replaceManagedMapRoute(resolvedRoute.canonicalPath, explicitCanonicalHref);
      return;
    }

    if (
      isPreviewSelectionActive &&
      (resolvedRoute.kind === 'root' ||
        resolvedRoute.kind === 'camera' ||
        resolvedRoute.kind === 'city' ||
        resolvedRoute.kind === 'postcode')
    ) {
      if (resolvedRoute.kind === 'camera') {
        lastCameraPathRef.current = resolvedRoute.canonicalPath;
      }

      return;
    }

    const map = mapRef.current;
    if (
      !map ||
      !mapLoaded ||
      routeState.isLoading ||
      appliedRoutePathRef.current === routeState.pathname
    ) {
      return;
    }

    if (resolvedRoute.kind === 'root') {
      handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      lastCameraPathRef.current = serializeCanonicalCameraPath({
        lat: DEFAULT_CENTER[1],
        lng: DEFAULT_CENTER[0],
        zoom: DEFAULT_ZOOM,
      });
      onViewportCenterChanged(DEFAULT_CENTER[0], DEFAULT_CENTER[1], DEFAULT_ZOOM);
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'camera') {
      handleClosePreview();
      skipNextPassiveUrlSyncRef.current = true;
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      map.jumpTo({
        center: [resolvedRoute.camera.lng, resolvedRoute.camera.lat],
        zoom: resolvedRoute.camera.zoom,
      });
      lastCameraPathRef.current = resolvedRoute.canonicalPath;
      onViewportCenterChanged(
        resolvedRoute.camera.lng,
        resolvedRoute.camera.lat,
        resolvedRoute.camera.zoom,
      );
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'city' || resolvedRoute.kind === 'postcode') {
      handleClosePreview();
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
      onViewportCenterChanged(
        resolvedRoute.center[0],
        resolvedRoute.center[1],
        resolvedRoute.zoom,
      );
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (resolvedRoute.kind === 'preview') {
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;
      if (previewCanonicalPath === resolvedRoute.canonicalPath && previewGroup) {
        appliedRoutePathRef.current = routeState.pathname;
        return;
      }

      skipNextPassiveUrlSyncRef.current = true;
      lastCameraPathRef.current = serializeCanonicalCameraPath({
        lat: resolvedRoute.property.coordinates.lat,
        lng: resolvedRoute.property.coordinates.lon,
        zoom: SEARCH_TARGET_ZOOM,
      });
      handleMapPropertyResolved(
        resolvedRoute.property,
        cameraCommands,
        resolvedRoute.resolvedAddress,
        0,
      );
      setSearchCity(resolvedRoute.property.city, [
        resolvedRoute.property.coordinates.lon,
        resolvedRoute.property.coordinates.lat,
      ]);
      appliedRoutePathRef.current = routeState.pathname;
    }
  }, [
    cameraCommands,
    handleMapPropertyResolved,
    handleClosePreview,
    onViewportCenterChanged,
    previewCanonicalPath,
    previewGroup,
    mapLoaded,
    replaceManagedMapRoute,
    routeState.isLoading,
    routeState.pathname,
    routeState.resolvedRoute,
    returnTo,
    setSearchCity,
    isPreviewSelectionActive,
    shouldManageMapRoute,
  ]);

  useEffect(() => {
    if (!shouldManageMapRoute) {
      return;
    }

    if (routeState.isLoading || !mapRef.current) {
      return;
    }

    if (previewGroup && previewCanonicalPath) {
      previousPreviewPathRef.current = previewCanonicalPath;
      if (routeState.pathname !== previewCanonicalPath) {
        lastReplacedUrlRef.current = previewCanonicalPath;
        replaceManagedMapRoute(previewCanonicalPath);
      }
      return;
    }

    if (!previousPreviewPathRef.current) {
      return;
    }

    previousPreviewPathRef.current = null;

    if (
      lastCameraPathRef.current &&
      routeState.pathname !== lastCameraPathRef.current
    ) {
      lastReplacedUrlRef.current = lastCameraPathRef.current;
      replaceManagedMapRoute(lastCameraPathRef.current);
    }
  }, [
    previewGroup,
    previewCanonicalPath,
    replaceManagedMapRoute,
    routeState.isLoading,
    routeState.pathname,
    shouldManageMapRoute,
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

  if (!shouldManageMapRoute) {
    return null;
  }

  if (routeState.resolvedRoute?.kind === 'property') {
    return (
      <PropertyDetailRouteScreen
        propertyId={routeState.resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyMapRoute(routeState.resolvedRoute.routeInput)}
      />
    );
  }

  if (routeState.resolvedRoute?.kind === 'comments') {
    return (
      <CommentsRouteScreen
        propertyId={routeState.resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyRoute(
          routeState.resolvedRoute.routeInput,
          buildPropertyMapRoute(routeState.resolvedRoute.routeInput),
        )}
      />
    );
  }

  if (routeState.resolvedRoute?.kind === 'guesses') {
    return (
      <GuessesRouteScreen
        propertyId={routeState.resolvedRoute.property.id}
        returnTo={returnTo ?? buildPropertyRoute(
          routeState.resolvedRoute.routeInput,
          buildPropertyMapRoute(routeState.resolvedRoute.routeInput),
        )}
      />
    );
  }

  return (
    <View
      className="flex-1 bg-warm-100"
      pointerEvents="box-none"
      style={styles.screenRoot}
    >
      <View
        className="flex-1"
        pointerEvents="box-none"
        style={styles.screenContent}
      >
        <View
          pointerEvents="auto"
          style={styles.mapSurface}
        >
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
          style={styles.mapTintOverlay as any}
        />

        {/* Map Loading Indicator */}
        {(routeState.isLoading || !mapLoaded) && (
          <View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center bg-warm-100"
            style={styles.loadingOverlay as any}
            testID="map-loading-indicator"
          >
            <View className="items-center">
              <View
                className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full"
                style={{
                  animation: 'spin 1s linear infinite',
                } as any}
              />
              <Text className="text-warm-600 mt-3 text-base">
                {routeState.isLoading ? 'Resolving map route...' : 'Loading map...'}
              </Text>
            </View>
          </View>
        )}

        <WebPreviewMarkerPortal
          map={mapInstance}
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
        </View>

        <View
          pointerEvents="box-none"
          style={styles.chromeLayer}
        >
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

          {/* Zoom level indicator (debug camera only) */}
          {DEBUG_CAMERA && (
            <View
              className="bg-surface-card/90 px-3 py-2 rounded-full shadow-md"
              style={{ position: 'absolute', top: 120, left: 16, zIndex: 50 } as any}
            >
              <Text className="text-sm text-warm-700">Zoom: {visibleZoom.toFixed(1)}</Text>
            </View>
          )}

          {/* Location button — bottom-right of map, above tab bar */}
          <View
            style={styles.locationButtonContainer as any}
          >
            <LocationButton testID="location-button" onPress={handleCurrentLocationPress} />
          </View>
        </View>
      </View>

      {/* Property details side panel (unified PropertyBottomSheet resolves to .web.tsx) */}
      <PropertyBottomSheet
        ref={interaction.bottomSheetRef}
        property={interaction.selectedPropertyForSheet ?? null}
        isLoading={interaction.selectedPropertyLoading && !interaction.selectedPropertyForSheet}
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

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    position: 'relative',
  },
  screenContent: {
    flex: 1,
    position: 'relative',
  },
  mapSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  mapTintOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 248, 240, 0.08)',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  chromeLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  locationButtonContainer: {
    position: 'absolute',
    bottom: 108,
    right: 18,
    zIndex: 20,
  },
});

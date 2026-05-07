import { useRef, useCallback, useState, useEffect, useMemo, startTransition } from 'react';
import { Alert, Text, View, type ViewStyle } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { router, type Href } from 'expo-router';
import * as maplibregl from 'maplibre-gl';
import {
  AuthModal,
  WelcomeModal,
  SearchBar,
  PropertyBottomSheet,
} from '@/src/components';
import { MapFilterBar } from '@/src/components/map/MapFilterBar';
import { FollowingMapStateCard } from '@/src/components/map/FollowingMapStateCard';
import { emitMapFollowingAnalyticsEvent } from '@/src/components/map/followingMapAnalytics';
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
import { useFollowingTileSource } from '@/src/hooks/useFollowingTileSource';
import { usePropertyView } from '@/src/hooks/usePropertyView';
import { useReadTileSource } from '@/src/hooks/useReadTileSource';
import { useWelcomeModal } from '@/src/hooks/useWelcomeModal';
import type { AuthModalCopyInput } from '@/src/lib/authModalCopy';
import {
  API_URL,
  fetchFollowingNearbyGroup,
  fetchNearbyGroup,
  normalizeRenderedPropertyGroup,
  type PropertyResolveResult,
} from '@/src/utils/api';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import { viewportAnchorToOffset } from '@/src/lib/mapCameraAnchor';
import {
  clearLocalPreviewRouteCache,
  extractCanonicalRouteInput,
  getPersistedMapSocialScope,
  parseMapRoutePath,
  persistMapSocialScope,
  registerLocalPreviewRoute,
  type ResolvedMapRoute,
  type MapSocialScope,
} from '@/src/lib/mapRoute';
import { isMapFacingNorth } from '@/src/lib/mapCompass';
import { doesMapSelectionMatchFilters } from '@/src/lib/mapFilterSelection';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import {
  applyReadPropertyFeatureStateStyles,
  buildFollowingTileRequestMatchPattern,
  buildReadTileRequestMatchPattern,
  READ_OVERLAY_LAYER_IDS,
  READ_PROPERTY_FEATURE_STATE_KEY,
  getReadPropertyOverlayLayers,
  injectReadPropertyOverlay,
  replacePropertySourceTiles,
  PROPERTY_VECTOR_SOURCE_ID,
  PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
  READ_PROPERTY_VECTOR_SOURCE_ID,
} from '@/src/lib/mapPropertySource';
import {
  PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT,
  registerPropertyTileRetryProtocol,
  wrapPropertyTileRetryProtocolUrl,
} from '@/src/lib/propertyTileRetryProtocol';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import {
  appendSearchToPath,
  buildPropertyTileTemplateUrl,
  createDefaultMapFilters,
  getCanonicalMapFilterSignature,
  getMapFilterSearchString,
  parseMapFiltersFromSearchParams,
  type MapActivityTimeFilter,
} from '@/src/lib/sharedMapFilters';
import {
  getCurrentBrowserPathname,
  replacePassiveBrowserPath,
} from '@/src/lib/webMapUrlSync';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEFAULT_BEARING, DEBUG_CAMERA } from '@/src/lib/mapDefaults';
import { useBenchmarkRenderProbe } from '@/src/lib/benchmarkRenderProbe';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import { MapWelcomeInfoButton } from '@/src/components/map/MapWelcomeInfoButton';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import type { AddressSearchBias, ResolvedAddress } from '@/src/services/address-resolver';
import { buildCanonicalRouteHref, toInternalAppHref } from '@/src/utils/property-route';
import {
  MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD,
  PROPERTY_GHOST_REVEAL_ZOOM,
  QUERYABLE_PROPERTY_LAYER_IDS,
  resolveActiveClusterNodeVisual,
  resolveActiveSingleNodeVisual,
  withAlpha,
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
const STATIC_ACTIVITY_PULSE_LAYER_IDS = [
  'property-cluster-pulse',
  'active-node-pulse',
] as const;
const PREVIEW_ARROW_MARKER_GAP_PX = 6;
const PREVIEW_CARD_MARKER_OFFSET_PX =
  SELECTED_MARKER_CONTAINER_SIZE_PX / 2 + PREVIEW_ARROW_MARKER_GAP_PX;
const SEARCH_TARGET_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM + 1;
const FOLLOWING_RENDERED_FEATURE_SETTLE_MS = 1500;
const NON_MAP_TAB_PATHNAMES = new Set(['/feed', '/saved', '/profile']);
const AMBIENT_COMMENT_BUBBLE_MIN_ZOOM = 10;
const ACTIVITY_PULSE_DOM_MIN_ZOOM = 10;
const CAMERA_EPSILON = 0.000001;
const ZOOM_EPSILON = 0.001;
const PROPERTY_TILE_RECOVERY_RELOAD_DELAY_MS = 2_500;

type WebViewStyle = ViewStyle & {
  animation?: string;
  boxShadow?: string;
  filter?: string;
  transition?: string;
};

type InternalMapStyle = {
  _clearSource?: (id: string) => void;
  _reloadSource?: (id: string) => void;
  _updateSources?: (transform: unknown) => void;
};

function usesFollowingTiles(tiles: readonly string[]): boolean {
  return tiles.some((tileUrl) => tileUrl.includes('/following/'));
}

function resetSourceCache(map: maplibregl.Map, sourceId: string): void {
  const internalMap = map as maplibregl.Map & {
    style?: InternalMapStyle;
    transform?: unknown;
    triggerRepaint?: () => void;
  };
  const style = internalMap.style;

  if (!style?._clearSource || !style?._reloadSource) {
    return;
  }

  style._clearSource(sourceId);
  style._reloadSource(sourceId);
  style._updateSources?.(internalMap.transform);
  internalMap.triggerRepaint?.();
}

function countGroupedFeaturesInBounds(
  features: GeoJSON.Feature[],
  bounds?: {
    getWest: () => number;
    getSouth: () => number;
    getEast: () => number;
    getNorth: () => number;
  },
): number {
  const dedupedKeys = new Set<string>();

  for (const feature of features) {
    const group = normalizeRenderedPropertyGroup(feature);
    if (!group) {
      continue;
    }

    if (bounds) {
      const [lng, lat] = group.coordinate;
      if (
        lng < bounds.getWest() ||
        lng > bounds.getEast() ||
        lat < bounds.getSouth() ||
        lat > bounds.getNorth()
      ) {
        continue;
      }
    }

    dedupedKeys.add(
      [
        group.groupKind,
        group.primaryPropertyId,
        group.coordinate[0],
        group.coordinate[1],
      ].join(':'),
    );
  }

  return dedupedKeys.size;
}

function getRenderedReadFeatureId(feature: GeoJSON.Feature): string | null {
  const properties = feature.properties ?? {};
  const primaryPropertyId = properties.primary_property_id;
  if (typeof primaryPropertyId === 'string' && primaryPropertyId.length > 0) {
    return primaryPropertyId;
  }

  const id = properties.id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }

  const propertyIds = properties.property_ids;
  if (typeof propertyIds === 'string') {
    return propertyIds.split(',').find((value) => value.length > 0) ?? null;
  }

  return null;
}

function collectVisibleReadFeatureIds(map: maplibregl.Map): Set<string> {
  const readLayerIds = READ_OVERLAY_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
  if (readLayerIds.length === 0) {
    return new Set();
  }

  const canvas = map.getCanvas();
  const features = map.queryRenderedFeatures(
    [[0, 0], [canvas.width, canvas.height]],
    { layers: [...readLayerIds] },
  ) ?? [];
  const ids = new Set<string>();

  for (const feature of features) {
    const id = getRenderedReadFeatureId(feature);
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

function setReadFeatureState(map: maplibregl.Map, id: string, read: boolean): void {
  map.setFeatureState(
    {
      source: PROPERTY_VECTOR_SOURCE_ID,
      sourceLayer: 'properties',
      id,
    },
    { [READ_PROPERTY_FEATURE_STATE_KEY]: read },
  );
}

function emitFollowingFeatureClickAnalytics(
  features: GeoJSON.Feature[],
  platform: string,
): void {
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

function getWebClickCoordinate(
  event: maplibregl.MapMouseEvent,
  fallback?: [number, number],
): [number, number] | null {
  const lngLat = event.lngLat as { lng?: unknown; lat?: unknown } | undefined;
  if (typeof lngLat?.lng === 'number' && typeof lngLat.lat === 'number') {
    return [lngLat.lng, lngLat.lat];
  }

  return fallback ?? null;
}

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

const MAP_WELCOME_INFO_BUTTON_STYLE: WebViewStyle = {
  position: 'absolute',
  bottom: 108,
  left: 18,
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

interface InitialWebMapCamera {
  center: [number, number];
  zoom: number;
  cameraPath: string;
}

function getInitialWebMapCamera(pathname: string): InitialWebMapCamera {
  const parsedRoute = parseMapRoutePath(pathname);

  if (parsedRoute.kind === 'camera') {
    return {
      center: [parsedRoute.camera.lng, parsedRoute.camera.lat],
      zoom: parsedRoute.camera.zoom,
      cameraPath: parsedRoute.pathname,
    };
  }

  return {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    cameraPath: serializeCanonicalCameraPath({
      lat: DEFAULT_CENTER[1],
      lng: DEFAULT_CENTER[0],
      zoom: DEFAULT_ZOOM,
    }),
  };
}

function isMapAlreadyAtCamera(
  map: maplibregl.Map,
  camera: { lng: number; lat: number; zoom: number },
): boolean {
  const center = map.getCenter();
  const zoom = map.getZoom();

  return (
    Math.abs(center.lng - camera.lng) <= CAMERA_EPSILON &&
    Math.abs(center.lat - camera.lat) <= CAMERA_EPSILON &&
    Math.abs(zoom - camera.zoom) <= ZOOM_EPSILON
  );
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
    @keyframes map-node-activity-pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 var(--map-node-pulse-ring);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 var(--map-node-pulse-spread) var(--map-node-pulse-transparent);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 var(--map-node-pulse-transparent);
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
      position: absolute;
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
    .map-node-activity-pulse-overlay {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 1;
    }
    .map-node-activity-pulse-frame {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      transform: translate(-50%, -50%);
    }
    .map-node-activity-pulse {
      flex: 0 0 auto;
      border-radius: 50%;
      background: transparent;
      box-shadow: 0 0 0 0 var(--map-node-pulse-ring);
      animation: map-node-activity-pulse 2s infinite;
      pointer-events: none;
      will-change: transform, box-shadow;
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

type RenderedPropertyGroup = NonNullable<ReturnType<typeof normalizeRenderedPropertyGroup>>;

interface ActivityPulseElement {
  coordinate: [number, number];
  frame: HTMLDivElement;
  pulse: HTMLDivElement;
}

function resolveActivityPulseVisual(group: RenderedPropertyGroup) {
  if (
    group.nodeClass !== 'active' ||
    group.recentSocialCount <= 0 ||
    group.recentSocialScoreTotal <= MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD
  ) {
    return null;
  }

  const visual = group.groupKind === 'cluster'
    ? resolveActiveClusterNodeVisual({
      pointCount: group.pointCount,
      listingShare: group.pointCount > 0 ? group.activeListingCount / group.pointCount : 0,
      socialCount: group.socialCount,
      recentSocialCount: group.recentSocialCount,
      recentSocialScoreTotal: group.recentSocialScoreTotal,
    })
    : resolveActiveSingleNodeVisual({
      activityScore: group.activityScore,
      socialCount: group.socialCount,
      activeListingCount: group.activeListingCount,
      recentSocialCount: group.recentSocialCount,
      recentSocialScoreTotal: group.recentSocialScoreTotal,
    });

  if (
    !visual.pulseDiameter ||
    !visual.pulseColor ||
    !visual.pulseOpacity ||
    visual.pulseOpacity <= 0
  ) {
    return null;
  }

  return visual;
}

function getActivityPulseNodeKey(group: RenderedPropertyGroup): string {
  return [
    group.groupKind,
    group.primaryPropertyId,
    group.coordinate[0],
    group.coordinate[1],
  ].join(':');
}

function hideStaticActivityPulseLayers(map: maplibregl.Map): void {
  STATIC_ACTIVITY_PULSE_LAYER_IDS.forEach((layerId) => {
    if (!map.getLayer(layerId)) {
      return;
    }

    try {
      map.setPaintProperty(layerId, 'circle-opacity', 0);
    } catch {
      // Layer timing can race style reloads; the DOM pulse overlay is best-effort.
    }
  });
}

// Property layer IDs for click handling
const PROPERTY_LAYER_IDS = [...QUERYABLE_PROPERTY_LAYER_IDS];
const AMBIENT_BUBBLE_SETTLE_DELAY_MS = 900;
const AMBIENT_BUBBLE_RESET_ZOOM_OUT_DELTA = 0.75;

export default function MapScreen({ pathnameOverride }: MapScreenProps = {}) {
  useBenchmarkRenderProbe('map-screen');

  const welcomeModal = useWelcomeModal();
  const isFocused = useIsFocused();
  const initialAppliedFilters = useMemo(
    () =>
      typeof window === 'undefined'
        ? createDefaultMapFilters()
        : parseMapFiltersFromSearchParams(
            new URLSearchParams(window.location.search),
          ),
    [],
  );
  const initialSocialScope = useMemo<MapSocialScope>(
    () =>
      typeof window === 'undefined'
        ? 'all'
        : getPersistedMapSocialScope(
            new URLSearchParams(window.location.search),
          ),
    [],
  );
  const filterController = useMapFilterController({
    initialAppliedFilters,
  });
  const { accessToken, getAccessToken, isAuthenticated } = useAuthContext();
  const [socialScope, setSocialScope] = useState<MapSocialScope>(initialSocialScope);
  const [followingActivity, setFollowingActivity] =
    useState<MapActivityTimeFilter>('all-time');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFirstFullRenderReady, setMapFirstFullRenderReady] = useState(false);
  const [mapInteractionsSuspended, setMapInteractionsSuspended] = useState(false);
  const [followingTileAuthToken, setFollowingTileAuthToken] = useState<string | null>(null);
  const { replaceAppliedFilters } = filterController;
  const publicPropertyTileUrl = useMemo(
    () =>
      wrapPropertyTileRetryProtocolUrl(
        API_URL,
        buildPropertyTileTemplateUrl(API_URL, filterController.appliedFilters),
      ),
    [filterController.appliedFilters],
  );
  const followingTileSource = useFollowingTileSource(
    filterController.appliedFilters,
    followingActivity,
    socialScope === 'following' && mapLoaded,
  );
  const readTileSource = useReadTileSource(
    filterController.appliedFilters,
    socialScope !== 'following' && mapLoaded,
  );
  const activePropertyTiles = useMemo(
    () => (
      socialScope === 'following'
        ? (
            followingTileSource.data?.tileUrl && followingTileAuthToken
              ? [followingTileSource.data.tileUrl]
              : []
          )
        : [publicPropertyTileUrl]
    ),
    [
      followingTileAuthToken,
      followingTileSource.data?.tileUrl,
      publicPropertyTileUrl,
      socialScope,
    ],
  );
  const activeReadPropertyTiles = useMemo(
    (): string[] => {
      const readTileUrl =
        readTileSource.data?.cacheBustedTileUrl
        ?? readTileSource.data?.tileUrl
        ?? null;

      if (socialScope === 'following' || !readTileUrl) {
        return [];
      }

      return [readTileUrl];
    },
    [readTileSource.data?.cacheBustedTileUrl, readTileSource.data?.tileUrl, socialScope],
  );
  // Keep map construction stable; later filter changes should update the
  // vector source tiles in place instead of remounting the whole map.
  const activePropertyTilesRef = useRef(activePropertyTiles);
  activePropertyTilesRef.current = activePropertyTiles;
  const activeReadPropertyTilesRef = useRef(activeReadPropertyTiles);
  activeReadPropertyTilesRef.current = activeReadPropertyTiles;
  const activeReadFeatureIdsRef = useRef<Set<string>>(new Set());
  const appliedFilterSignature = useMemo(
    () => getCanonicalMapFilterSignature(filterController.appliedFilters),
    [filterController.appliedFilters],
  );
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const initialRoutePathname = pathnameOverride ?? getCurrentBrowserPathname('/');
  const [initialMapCamera] = useState(() =>
    getInitialWebMapCamera(initialRoutePathname),
  );
  const currentZoomRef = useRef(initialMapCamera.zoom);
  const lastSettledAmbientBubbleZoomRef = useRef<number | null>(null);
  const [visibleZoom, setVisibleZoom] = useState(initialMapCamera.zoom);
  const [searchResetToken, setSearchResetToken] = useState(0);
  const isMapTabActive = isFocused;
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
  const isMapTabActiveRef = useRef(isMapTabActive);
  isMapTabActiveRef.current = isMapTabActive;
  const ambientBubbleRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followingRenderedFeatureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followingRenderedFeatureCount, setFollowingRenderedFeatureCount] = useState<number | null>(null);
  const [followingRenderCheckComplete, setFollowingRenderCheckComplete] = useState(false);
  const trackedFollowingEmptyViewRef = useRef(false);
  const propertyTileRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootAutoLocationRequestedRef = useRef(false);

  useEffect(() => {
    registerPropertyTileRetryProtocol(maplibregl, API_URL);
  }, []);

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
    handleNearbyResult,
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
  const handleNearbyResultRef = useRef(handleNearbyResult);
  handleNearbyResultRef.current = handleNearbyResult;
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
    currentZoomRef.current >= AMBIENT_COMMENT_BUBBLE_MIN_ZOOM &&
    socialScope !== 'following' &&
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
              platform: 'web',
            });
          },
        );
        return currentScope;
      }

      emitMapFollowingAnalyticsEvent('map_following_filter_enabled', {
        authenticated: isAuthenticated,
        platform: 'web',
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

    if (
      socialScope !== 'following' ||
      !isAuthenticated ||
      !followingTileSource.data?.tileUrl
    ) {
      setFollowingTileAuthToken(null);
      return () => {
        cancelled = true;
      };
    }

    if (accessToken) {
      setFollowingTileAuthToken((currentToken) =>
        currentToken === accessToken ? currentToken : accessToken,
      );
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

  const followingTileRequestPattern = useMemo(
    () => (
      followingTileSource.data?.tileUrl
        ? buildFollowingTileRequestMatchPattern(followingTileSource.data.tileUrl)
        : null
    ),
    [followingTileSource.data?.tileUrl],
  );
  const socialScopeRef = useRef(socialScope);
  socialScopeRef.current = socialScope;
  const followingActivityRef = useRef(followingActivity);
  followingActivityRef.current = followingActivity;
  const appliedFiltersRef = useRef(filterController.appliedFilters);
  appliedFiltersRef.current = filterController.appliedFilters;
  const followingTileAuthTokenRef = useRef(followingTileAuthToken);
  followingTileAuthTokenRef.current = followingTileAuthToken;
  const followingTileRequestPatternRef = useRef<RegExp | null>(followingTileRequestPattern);
  followingTileRequestPatternRef.current = followingTileRequestPattern;
  const readTileRequestPattern = useMemo(
    () => (
      readTileSource.data?.tileUrl
        ? buildReadTileRequestMatchPattern(readTileSource.data.tileUrl)
        : null
    ),
    [readTileSource.data?.tileUrl],
  );
  const readTileSourceRef = useRef(readTileSource.data);
  readTileSourceRef.current = readTileSource.data;
  const readTileRequestPatternRef = useRef<RegExp | null>(readTileRequestPattern);
  readTileRequestPatternRef.current = readTileRequestPattern;
  const replaceMapBrowserPathRef = useRef<(pathname: string) => boolean>(() => false);
  const bottomSheetRefBridge = useRef(bottomSheetRef);
  bottomSheetRefBridge.current = bottomSheetRef;
  const handleFeaturePressRef = useRef(handleFeaturePress);
  handleFeaturePressRef.current = handleFeaturePress;
  const handleAuthRequiredRef = useRef(handleAuthRequired);
  handleAuthRequiredRef.current = handleAuthRequired;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const clearRecoveryTimer = () => {
      if (propertyTileRecoveryTimerRef.current) {
        clearTimeout(propertyTileRecoveryTimerRef.current);
        propertyTileRecoveryTimerRef.current = null;
      }
    };

    const scheduleRecoveryReload = () => {
      if (propertyTileRecoveryTimerRef.current) {
        return;
      }

      propertyTileRecoveryTimerRef.current = setTimeout(() => {
        propertyTileRecoveryTimerRef.current = null;
        const map = mapRef.current;
        if (!map || socialScopeRef.current === 'following') {
          return;
        }

        resetSourceCache(map, PROPERTY_VECTOR_SOURCE_ID);
      }, PROPERTY_TILE_RECOVERY_RELOAD_DELAY_MS);
    };

    window.addEventListener(
      PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT,
      scheduleRecoveryReload
    );

    return () => {
      clearRecoveryTimer();
      window.removeEventListener(
        PROPERTY_TILE_TIMEOUT_EMPTY_EXHAUSTED_EVENT,
        scheduleRecoveryReload
      );
    };
  }, []);

  const clearFollowingRenderedFeatureRefresh = useCallback(() => {
    if (followingRenderedFeatureTimeoutRef.current) {
      clearTimeout(followingRenderedFeatureTimeoutRef.current);
      followingRenderedFeatureTimeoutRef.current = null;
    }
  }, []);

  const refreshFollowingRenderedFeatureCount = useCallback(() => {
    const map = mapRef.current;
    if (
      !map ||
      socialScope !== 'following' ||
      !isAuthenticated ||
      !followingTileSource.data?.tileUrl
    ) {
      setFollowingRenderedFeatureCount(null);
      setFollowingRenderCheckComplete(false);
      return;
    }

    const source = map.getSource(PROPERTY_VECTOR_SOURCE_ID) as
      | { serialize?: () => { tiles?: string[] } }
      | undefined;
    const currentTiles = source?.serialize?.().tiles;
    const currentTileUrl = Array.isArray(currentTiles) ? currentTiles[0] : null;
    const expectedTileUrl = activePropertyTilesRef.current[0] ?? null;
    if (!expectedTileUrl || currentTileUrl !== expectedTileUrl) {
      setFollowingRenderCheckComplete(false);
      followingRenderedFeatureTimeoutRef.current = setTimeout(() => {
        followingRenderedFeatureTimeoutRef.current = null;
        refreshFollowingRenderedFeatureCount();
      }, FOLLOWING_RENDERED_FEATURE_SETTLE_MS);
      return;
    }

    const canvas = map.getCanvas();
    const renderedFeatures = map.queryRenderedFeatures(
      [[0, 0], [canvas.width, canvas.height]],
      { layers: PROPERTY_LAYER_IDS },
    ) as unknown as GeoJSON.Feature[];

    setFollowingRenderedFeatureCount(countGroupedFeaturesInBounds(renderedFeatures));
    setFollowingRenderCheckComplete(true);
  }, [followingTileSource.data?.tileUrl, isAuthenticated, socialScope]);

  const scheduleFollowingRenderedFeatureRefresh = useCallback(() => {
    if (
      socialScope !== 'following' ||
      !isAuthenticated ||
      !followingTileSource.data?.tileUrl
    ) {
      clearFollowingRenderedFeatureRefresh();
      setFollowingRenderedFeatureCount(null);
      setFollowingRenderCheckComplete(false);
      return;
    }

    if (followingRenderedFeatureTimeoutRef.current) {
      return;
    }

    setFollowingRenderCheckComplete(false);
    followingRenderedFeatureTimeoutRef.current = setTimeout(() => {
      followingRenderedFeatureTimeoutRef.current = null;
      refreshFollowingRenderedFeatureCount();
    }, FOLLOWING_RENDERED_FEATURE_SETTLE_MS);
  }, [
    clearFollowingRenderedFeatureRefresh,
    followingTileSource.data?.tileUrl,
    isAuthenticated,
    refreshFollowingRenderedFeatureCount,
    socialScope,
  ]);
  const scheduleFollowingRenderedFeatureRefreshRef = useRef(
    scheduleFollowingRenderedFeatureRefresh,
  );
  scheduleFollowingRenderedFeatureRefreshRef.current =
    scheduleFollowingRenderedFeatureRefresh;

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
  const { recordPropertyView: recordPreviewPropertyView } = usePropertyView();
  useEffect(() => {
    if (currentPreviewProperty?.id && currentPreviewProperty.nodeClass !== 'ghost') {
      recordPreviewPropertyView(currentPreviewProperty.id);
    }
  }, [currentPreviewProperty?.id, currentPreviewProperty?.nodeClass, recordPreviewPropertyView]);
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
      if (!isMapTabActiveRef.current) {
        return false;
      }

      const currentBrowserPathname = getCurrentBrowserPathname('/');
      if (pathnameOverride == null && NON_MAP_TAB_PATHNAMES.has(currentBrowserPathname)) {
        return false;
      }

      const nextHref = appendSearchToPath(pathname, browserSearchRef.current);
      return replacePassiveBrowserPath(nextHref);
    },
    [pathnameOverride],
  );
  replaceMapBrowserPathRef.current = replaceMapBrowserPath;

  const syncVisibleZoom = useCallback((zoom: number) => {
    currentZoomRef.current = zoom;

    setVisibleZoom((prev) => {
      const crossedAmbientThreshold =
        (prev >= AMBIENT_COMMENT_BUBBLE_MIN_ZOOM) !==
        (zoom >= AMBIENT_COMMENT_BUBBLE_MIN_ZOOM);

      if (!__DEV__ && !crossedAmbientThreshold) {
        return prev;
      }

      return Math.abs(prev - zoom) < 0.05 ? prev : zoom;
    });
  }, []);

  // Dynamic city name for the map header
  const { cityName, countryCode: viewportCountryCode, setSearchCity, onViewportCenterChanged } = useMapCityName();
  const [searchBiasCenter, setSearchBiasCenter] = useState<Pick<AddressSearchBias, 'lon' | 'lat'>>({
    lon: initialMapCamera.center[0],
    lat: initialMapCamera.center[1],
  });
  const searchBias = useMemo<AddressSearchBias>(
    () => ({
      ...searchBiasCenter,
      ...(viewportCountryCode ? { countryCode: viewportCountryCode } : {}),
    }),
    [searchBiasCenter, viewportCountryCode],
  );
  // Ref bridge so the map init effect (which runs once) can call the latest onViewportCenterChanged
  const onViewportCenterChangedRef = useRef(onViewportCenterChanged);
  onViewportCenterChangedRef.current = onViewportCenterChanged;

  // Refs for building single-property preview when useProperty data arrives (web deferred pattern)
  const pendingSinglePreview = useRef(false);
  const clickCoordRef = useRef<[number, number] | null>(null);
  const clickActivityRef = useRef<number | undefined>(undefined);
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
    (
      propertyId: string,
      coord: [number, number],
      activityScore: number | undefined,
      duration: number,
    ) => {
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

  const flyToCurrentLocation = useCallback(async () => {
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

  const handleCurrentLocationPress = useCallback(() => {
    void flyToCurrentLocation();
  }, [flyToCurrentLocation]);

  useEffect(() => {
    if (
      DEBUG_CAMERA ||
      rootAutoLocationRequestedRef.current ||
      !isMapTabActive ||
      !mapRef.current ||
      !mapFirstFullRenderReady ||
      routeState.isLoading ||
      routeState.resolvedRoute?.kind !== 'root'
    ) {
      return;
    }

    rootAutoLocationRequestedRef.current = true;
    void flyToCurrentLocation();
  }, [
    flyToCurrentLocation,
    isMapTabActive,
    mapFirstFullRenderReady,
    routeState.isLoading,
    routeState.resolvedRoute,
  ]);

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

  useEffect(() => () => {
    clearAmbientBubbleRefreshTimeout();
    clearFollowingRenderedFeatureRefresh();
  }, [clearAmbientBubbleRefreshTimeout, clearFollowingRenderedFeatureRefresh]);
  const clearAmbientCommentBubblesRef = useRef(clearAmbientCommentBubbles);
  clearAmbientCommentBubblesRef.current = clearAmbientCommentBubbles;
  const cancelPendingSinglePreviewSelectionRef = useRef(
    cancelPendingSinglePreviewSelection,
  );
  cancelPendingSinglePreviewSelectionRef.current =
    cancelPendingSinglePreviewSelection;
  const syncVisibleZoomRef = useRef(syncVisibleZoom);
  syncVisibleZoomRef.current = syncVisibleZoom;
  const cameraCommandsRef = useRef(cameraCommands);
  cameraCommandsRef.current = cameraCommands;

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
          activePropertyTilesRef.current,
        );
        style = applyReadPropertyFeatureStateStyles(
          style as maplibregl.StyleSpecification,
        );
        style = injectReadPropertyOverlay(
          style as maplibregl.StyleSpecification,
          activeReadPropertyTilesRef.current,
          { mode: 'probe' },
        );
      } catch {
        style = STYLE_URL;
      }

      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: initialMapCamera.center,
        zoom: initialMapCamera.zoom,
        pitch: getPitchForZoom(initialMapCamera.zoom),
        bearing: DEFAULT_BEARING,
        maxPitch: 70,
        touchPitch: false,
        pitchWithRotate: false,
        transformRequest: (url: string) => {
          const token = followingTileAuthTokenRef.current;
          const pattern = followingTileRequestPatternRef.current;
          const readSource = readTileSourceRef.current;
          const readPattern = readTileRequestPatternRef.current;

          if (
            socialScopeRef.current === 'following' &&
            token &&
            pattern?.test(url)
          ) {
            return {
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            };
          }

          if (
            socialScopeRef.current !== 'following' &&
            readSource &&
            readPattern?.test(url)
          ) {
            return {
              url,
              headers: {
                [readSource.headerName]: readSource.headerValue,
              },
            };
          }

          return { url };
        },
        transformCameraUpdate: ({ zoom }) => ({
          pitch: getPitchForZoom(Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM),
        }),
      });
      lastSettledAmbientBubbleZoomRef.current = initialMapCamera.zoom;

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

      const activityPulseOverlay = document.createElement('div');
      activityPulseOverlay.className = 'map-node-activity-pulse-overlay';
      activityPulseOverlay.dataset.testid = 'map-node-activity-pulse-overlay';
      map.getContainer().appendChild(activityPulseOverlay);
      const activityPulseElements = new Map<string, ActivityPulseElement>();
      let activityPulseAnimationFrame: number | null = null;

      const syncActivityPulsePositions = () => {
        if (map.getZoom() < ACTIVITY_PULSE_DOM_MIN_ZOOM) {
          return;
        }

        activityPulseElements.forEach(({ coordinate, frame }) => {
          const point = map.project(coordinate);
          frame.style.left = `${point.x}px`;
          frame.style.top = `${point.y}px`;
        });
      };

      const updateActivityPulseMarkers = () => {
        if (cancelled || !map.isStyleLoaded()) {
          return;
        }

        hideStaticActivityPulseLayers(map);

        if (map.getZoom() < ACTIVITY_PULSE_DOM_MIN_ZOOM) {
          activityPulseElements.forEach((element) => element.frame.remove());
          activityPulseElements.clear();
          return;
        }

        const mapContainer = map.getContainer();
        if (mapContainer.clientWidth <= 0 || mapContainer.clientHeight <= 0) {
          return;
        }

        const features = map.queryRenderedFeatures(
          [[0, 0], [mapContainer.clientWidth, mapContainer.clientHeight]],
          { layers: PROPERTY_LAYER_IDS },
        ) as unknown as GeoJSON.Feature[];
        const seenKeys = new Set<string>();

        for (const feature of features) {
          const group = normalizeRenderedPropertyGroup(feature);
          if (!group) {
            continue;
          }

          const visual = resolveActivityPulseVisual(group);
          if (!visual) {
            continue;
          }

          const key = getActivityPulseNodeKey(group);
          if (seenKeys.has(key)) {
            continue;
          }
          seenKeys.add(key);

          let element = activityPulseElements.get(key);
          if (!element) {
            const frame = document.createElement('div');
            frame.className = 'map-node-activity-pulse-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('data-testid', 'map-node-activity-pulse');

            const pulse = document.createElement('div');
            pulse.className = 'map-node-activity-pulse';
            frame.appendChild(pulse);
            activityPulseOverlay.appendChild(frame);

            element = { coordinate: group.coordinate, frame, pulse };
            activityPulseElements.set(key, element);
          }

          const pulseDiameter = visual.pulseDiameter ?? visual.diameter;
          const pulseColor = visual.pulseColor ?? '#E11D48';
          const pulseOpacity = visual.pulseOpacity ?? 0;
          const nodeDiameter = visual.diameter;
          const pulseSpread = Math.max((pulseDiameter - nodeDiameter) / 2, 0);
          element.coordinate = group.coordinate;
          element.frame.style.width = `${pulseDiameter}px`;
          element.frame.style.height = `${pulseDiameter}px`;
          element.pulse.style.width = `${nodeDiameter}px`;
          element.pulse.style.height = `${nodeDiameter}px`;
          element.pulse.style.setProperty(
            '--map-node-pulse-ring',
            withAlpha(pulseColor, pulseOpacity),
          );
          element.pulse.style.setProperty(
            '--map-node-pulse-transparent',
            withAlpha(pulseColor, 0),
          );
          element.pulse.style.setProperty(
            '--map-node-pulse-spread',
            `${pulseSpread}px`,
          );
        }

        activityPulseElements.forEach((element, key) => {
          if (seenKeys.has(key)) {
            return;
          }

          element.frame.remove();
          activityPulseElements.delete(key);
        });

        syncActivityPulsePositions();
      };

      const scheduleActivityPulseUpdate = () => {
        if (activityPulseAnimationFrame !== null) {
          return;
        }

        activityPulseAnimationFrame = window.requestAnimationFrame(() => {
          activityPulseAnimationFrame = null;
          updateActivityPulseMarkers();
        });
      };

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
        (
          window as unknown as {
            __bottomSheetRef: typeof bottomSheetRefBridge.current;
          }
        ).__bottomSheetRef = bottomSheetRefBridge.current;
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
        syncVisibleZoomRef.current(map.getZoom());
        scheduleFollowingRenderedFeatureRefreshRef.current();
        scheduleActivityPulseUpdate();
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
        setMapFirstFullRenderReady(true);
        markMapLoaded();

        // Enhance base map colors (imperative overrides on top of server-provided style)
        enhanceBaseMapColors(map);
        enhanceVegetationColors(map);
        hideStaticActivityPulseLayers(map);
        scheduleActivityPulseUpdate();

        setTimeout(() => {
          map.resize();
          scheduleActivityPulseUpdate();
        }, 100);
      });

      // Some static-export runs paint and become interactive without reliably
      // delivering the one-shot `load` event. Once the map reaches `idle`, the
      // first complete render has happened and the loading overlay can go away.
      map.on('idle', () => {
        if (!cancelled) {
          setMapFirstFullRenderReady(true);
          markMapLoaded();
          scheduleFollowingRenderedFeatureRefreshRef.current();
          scheduleActivityPulseUpdate();
        }
      });

      map.on('render', syncActivityPulsePositions);

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
        syncVisibleZoomRef.current(zoom);
      });

      // Track viewport center for dynamic city name (reverse geocoding)
      // Fire on 'moveend' — covers pan, zoom, fly, programmatic camera moves.
      map.on('moveend', () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        scheduleFollowingRenderedFeatureRefreshRef.current();
        const previousSettledBubbleZoom = lastSettledAmbientBubbleZoomRef.current;
        lastSettledAmbientBubbleZoomRef.current = zoom;
        const previousCameraPath = lastCameraPathRef.current;
        const nextCameraPath = serializeCanonicalCameraPath({
          lat: center.lat,
          lng: center.lng,
          zoom,
        });
        lastCameraPathRef.current = nextCameraPath;
        setSearchBiasCenter({ lon: center.lng, lat: center.lat });
        onViewportCenterChangedRef.current(center.lng, center.lat, zoom);
        const passiveSyncResult = syncPassiveCameraPathOnMoveEnd({
          browserPathname: browserPathRef.current,
          nextCameraPath,
          previousCameraPath,
          lockedAreaPath: lockedAreaPathRef.current,
          canReplaceLockedAreaPath: canReplaceLockedAreaPathRef.current,
          previewOpen: previewOpenRef.current,
          skipNextPassiveUrlSync: skipNextPassiveUrlSyncRef.current,
          replaceBrowserPath: replaceMapBrowserPathRef.current,
        });
        browserPathRef.current = passiveSyncResult.browserPathname;
        lockedAreaPathRef.current = passiveSyncResult.lockedAreaPath;
        skipNextPassiveUrlSyncRef.current =
          passiveSyncResult.skipNextPassiveUrlSync;

        const didConsiderablyZoomOut =
          previousSettledBubbleZoom !== null &&
          previousSettledBubbleZoom - zoom >= AMBIENT_BUBBLE_RESET_ZOOM_OUT_DELTA;

        if (didConsiderablyZoomOut) {
          clearAmbientCommentBubblesRef.current();
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

      // Trigger initial reverse geocode for the actual startup camera.
      onViewportCenterChangedRef.current(
        initialMapCamera.center[0],
        initialMapCamera.center[1],
        initialMapCamera.zoom,
      );
      lastCameraPathRef.current = initialMapCamera.cameraPath;

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

        if (socialScopeRef.current === 'following') {
          emitFollowingFeatureClickAnalytics(
            e.features as unknown as GeoJSON.Feature[],
            'web',
          );
        }

        const features = e.features as unknown as GeoJSON.Feature[];
        const group = normalizeRenderedPropertyGroup(features[0]);
        const handled = await handleFeaturePressRef.current(
          features,
          map.getZoom(),
          cameraCommandsRef.current,
        );
        if (handled) {
          return;
        }

        const clickCoordinate = getWebClickCoordinate(e, group?.coordinate);
        if (!clickCoordinate) {
          handleEmptyMapTapRef.current();
          return;
        }

        const currentZoom = map.getZoom();
        const [lon, lat] = clickCoordinate;
        try {
          const nearby =
            socialScopeRef.current === 'following'
              ? await fetchFollowingNearbyGroup(
                  lon,
                  lat,
                  currentZoom,
                  appliedFiltersRef.current,
                  followingActivityRef.current,
                )
              : await fetchNearbyGroup(
                  lon,
                  lat,
                  currentZoom,
                  appliedFiltersRef.current,
                  group?.pyramidVersionId && group.pyramidNodeId
                    ? {
                        pyramidVersionId: group.pyramidVersionId,
                        pyramidNodeId: group.pyramidNodeId,
                      }
                    : undefined,
                );

          if (nearby) {
            handleNearbyResultRef.current(nearby, currentZoom, cameraCommandsRef.current);
            return;
          }
        } catch (error) {
          console.warn('[HuisHype] Nearby fallback failed:', error);
        }

        handleEmptyMapTapRef.current();
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

        cancelPendingSinglePreviewSelectionRef.current();
        handleEmptyMapTapRef.current();
      });

      // Named cursor handlers so they can be properly removed/re-added
      const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
      const handleMouseLeave = () => { map.getCanvas().style.cursor = ''; };

      // Wait for layers to be added
      const layerHandlersAttached = new Set<string>();
      map.on('sourcedata', (event: unknown) => {
        const sourceDataEvent = event as
          | { sourceId?: string; isSourceLoaded?: boolean }
          | undefined;
        if (
          sourceDataEvent?.sourceId === PROPERTY_VECTOR_SOURCE_ID &&
          sourceDataEvent.isSourceLoaded
        ) {
          scheduleFollowingRenderedFeatureRefreshRef.current();
        }

        PROPERTY_LAYER_IDS.forEach((layerId) => {
          if (map.getLayer(layerId) && !layerHandlersAttached.has(layerId)) {
            layerHandlersAttached.add(layerId);
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
      cancelPendingSinglePreviewSelectionRef.current();
    };
  // Build the map once; refs above keep the event-time behavior fresh without
  // tearing down the MapLibre instance on Following/auth/filter state changes.
  }, [initialMapCamera.cameraPath, initialMapCamera.center, initialMapCamera.zoom]);

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
      if (!property.coordinates) {
        return;
      }

      // On web, single-property search also uses the deferred pattern
      const { lon, lat } = property.coordinates;
      const coord: [number, number] = [lon, lat];

      cameraCommands.flyTo({ center: coord, zoom: SEARCH_TARGET_ZOOM, duration: 1000 });
      scheduleSinglePreviewSelection(property.id, coord, undefined, 1000);

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
    if (!isMapTabActive) {
      return;
    }

    setRoutePathname((currentPathname) =>
      currentPathname === nextRoutePathname ? currentPathname : nextRoutePathname,
    );
    browserPathRef.current = nextRoutePathname;
  }, [isMapTabActive, pathnameOverride]);

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
      setSocialScope(
        getPersistedMapSocialScope(
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
    if (!isMapTabActive) {
      return;
    }

    const publicSearch = getMapFilterSearchString(
      filterController.appliedFilters,
      browserSearchRef.current,
    );
    browserSearchRef.current = publicSearch;
    persistMapSocialScope(socialScope);
    replaceMapBrowserPath(browserPathRef.current);
  }, [
    appliedFilterSignature,
    filterController.appliedFilters,
    isMapTabActive,
    replaceMapBrowserPath,
    socialScope,
  ]);

  useEffect(() => {
    if (!interaction.previewGroup || !previewCanonicalPath || !previewRouteInput) {
      return;
    }

    const previewSource = interaction.selectedPropertyForSheet ?? currentPreviewProperty;
    if (!previewSource?.id || !previewSource.address || !previewSource.city) {
      return;
    }
    const officialValuationYear = 'officialValuationYear' in previewSource
      ? previewSource.officialValuationYear
      : null;
    const officialValuationSourceFetch = 'officialValuationSourceFetch' in previewSource
      ? previewSource.officialValuationSourceFetch
      : null;

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
        hasListing: previewSource.hasActiveListing ?? undefined,
        hasActiveListing: previewSource.hasActiveListing ?? undefined,
        marketState: previewSource.marketState ?? null,
        officialValuation: previewSource.officialValuation ?? null,
        officialValuationYear: officialValuationYear ?? null,
        officialValuationSourceFetch: officialValuationSourceFetch ?? null,
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
    if (!isMapTabActive || !resolvedRoute || !map || !mapLoaded || routeState.isLoading) {
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
      if (!isMapAlreadyAtCamera(map, resolvedRoute.camera)) {
        map.jumpTo({
          center: [resolvedRoute.camera.lng, resolvedRoute.camera.lat],
          zoom: resolvedRoute.camera.zoom,
        });
      }
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

      const resolvedCoordinates = resolvedRoute.property.coordinates;
      if (!resolvedCoordinates) {
        appliedRoutePathRef.current = routeState.pathname;
        return;
      }

      skipNextPassiveUrlSyncRef.current = true;
      if (lastCameraPathRef.current === '/') {
        lastCameraPathRef.current = serializeCanonicalCameraPath({
          lat: resolvedCoordinates.lat,
          lng: resolvedCoordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
      }
      handlePropertyResolved(resolvedRoute.property, resolvedRoute.resolvedAddress);
      setSearchCity(resolvedRoute.property.city, [
        resolvedCoordinates.lon,
        resolvedCoordinates.lat,
      ]);
      appliedRoutePathRef.current = routeState.pathname;
    }
  }, [
    currentPreviewProperty,
    handlePropertyResolved,
    isMapTabActive,
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
    if (!isMapTabActive || routeState.isLoading || !mapRef.current) {
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
    isMapTabActive,
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

    const serializedTiles = source.serialize?.().tiles;
    const currentTiles = Array.isArray(serializedTiles)
      ? serializedTiles.filter((value): value is string => typeof value === 'string')
      : [];
    if (
      currentTiles.length === activePropertyTiles.length &&
      currentTiles.every(
        (value: string, index: number) => value === activePropertyTiles[index],
      )
    ) {
      return;
    }

    source.setTiles(activePropertyTiles);
    if (usesFollowingTiles(currentTiles) !== usesFollowingTiles(activePropertyTiles)) {
      resetSourceCache(map, PROPERTY_VECTOR_SOURCE_ID);
    }
  }, [activePropertyTiles, appliedFilterSignature, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) {
      return;
    }

    const source = map.getSource(READ_PROPERTY_VECTOR_SOURCE_ID) as
      | (maplibregl.Source & {
          setTiles?: (tiles: string[]) => void;
          serialize?: () => { tiles?: string[] };
        })
      | undefined;

    if (source && activeReadPropertyTiles.length === 0) {
      for (const layer of getReadPropertyOverlayLayers()) {
        if (map.getLayer(layer.id)) {
          map.removeLayer(layer.id);
        }
      }
      map.removeSource(READ_PROPERTY_VECTOR_SOURCE_ID);
      return;
    }

    if (!source) {
      if (activeReadPropertyTiles.length === 0 || !map.addSource || !map.addLayer) {
        return;
      }

      map.addSource(READ_PROPERTY_VECTOR_SOURCE_ID, {
        type: 'vector',
        tiles: activeReadPropertyTiles,
        minzoom: 0,
        maxzoom: 22,
        promoteId: PROPERTY_VECTOR_SOURCE_PROMOTE_ID,
      });

      for (const layer of getReadPropertyOverlayLayers({ mode: 'probe' })) {
        if (!map.getLayer(layer.id)) {
          map.addLayer(layer as maplibregl.LayerSpecification);
        }
      }
      return;
    }

    if (!source.setTiles) {
      return;
    }

    const serializedTiles = source.serialize?.().tiles;
    const currentTiles = Array.isArray(serializedTiles)
      ? serializedTiles.filter((value): value is string => typeof value === 'string')
      : [];
    if (
      currentTiles.length === activeReadPropertyTiles.length &&
      currentTiles.every(
        (value: string, index: number) => value === activeReadPropertyTiles[index],
      )
    ) {
      return;
    }

    source.setTiles(activeReadPropertyTiles);
  }, [activeReadPropertyTiles, appliedFilterSignature, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) {
      return;
    }

    const clearReadFeatureStates = () => {
      for (const id of activeReadFeatureIdsRef.current) {
        try {
          setReadFeatureState(map, id, false);
        } catch {
          // Source tiles can disappear while filters or read tiles are changing.
        }
      }
      activeReadFeatureIdsRef.current = new Set();
    };

    if (activeReadPropertyTiles.length === 0) {
      clearReadFeatureStates();
      return;
    }

    const syncReadFeatureStates = () => {
      if (!map.isStyleLoaded() || !map.getSource(READ_PROPERTY_VECTOR_SOURCE_ID)) {
        return;
      }

      let nextReadIds: Set<string>;
      try {
        nextReadIds = collectVisibleReadFeatureIds(map);
      } catch {
        return;
      }

      for (const id of activeReadFeatureIdsRef.current) {
        if (!nextReadIds.has(id)) {
          try {
            setReadFeatureState(map, id, false);
          } catch {
            // Ignore stale tile ids while the vector source is refreshing.
          }
        }
      }

      for (const id of nextReadIds) {
        if (!activeReadFeatureIdsRef.current.has(id)) {
          try {
            setReadFeatureState(map, id, true);
          } catch {
            // Ignore stale tile ids while the vector source is refreshing.
          }
        }
      }

      activeReadFeatureIdsRef.current = nextReadIds;
    };

    syncReadFeatureStates();
    map.on('idle', syncReadFeatureStates);

    return () => {
      map.off('idle', syncReadFeatureStates);
    };
  }, [activeReadPropertyTiles, appliedFilterSignature, mapLoaded]);

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
      platform: 'web',
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

  return (
    <ScreenBackground>
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
            pointerEvents: mapInteractionsSuspended ? 'none' : 'auto',
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
            className="absolute inset-0 items-center justify-center"
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
          searchBias={searchBias}
        />

        <MapFilterBar
          controller={filterController}
          followingActivity={followingActivity}
          onFollowingActivityChange={setFollowingActivity}
          onPanelOpenChange={setMapInteractionsSuspended}
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
                    platform: 'web',
                  });
                },
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
          <FollowingMapStateCard
            mode="empty"
            onPrimaryPress={() => setSocialScope('all')}
          />
        ) : null}

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
        <MapWelcomeInfoButton
          onPress={welcomeModal.open}
          style={MAP_WELCOME_INFO_BUTTON_STYLE}
        />

        <View
          style={MAP_LOCATION_BUTTON_STYLE}
        >
          <LocationButton testID="location-button" onPress={handleCurrentLocationPress} />
        </View>

        {!mapInteractionsSuspended ? (
          <WebPreviewMarkerPortal
            map={mapRef.current}
            previewGroup={interaction.previewGroup}
            anchorCoordinate={selectedMarkerCoordinate}
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
        ) : null}

        {!mapInteractionsSuspended ? (
          <WebAmbientCommentBubblesPortal
            map={mapRef.current}
            bubbles={ambientCommentBubbleItems}
            onBubblePress={handleAmbientBubblePress}
          />
        ) : null}

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

      <WelcomeModal
        visible={welcomeModal.visible && !interaction.showAuthModal}
        onClose={welcomeModal.dismiss}
      />
    </ScreenBackground>
  );
}

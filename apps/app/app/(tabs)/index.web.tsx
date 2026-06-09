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
import { CommentsRouteScreen } from '@/src/screens/CommentsRouteScreen';
import { GuessesRouteScreen } from '@/src/screens/GuessesRouteScreen';
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
import { useMapSearchBias } from '@/src/hooks/useMapSearchBias';
import { useFollowingTileSource } from '@/src/hooks/useFollowingTileSource';
import { usePropertyView } from '@/src/hooks/usePropertyView';
import { useReadTileSource } from '@/src/hooks/useReadTileSource';
import { useWelcomeModal } from '@/src/hooks/useWelcomeModal';
import type { AuthModalCopyInput } from '@/src/lib/authModalCopy';
import {
  API_URL,
  fetchFollowingNearbyGroup,
  fetchHouseNumberTapResolve,
  fetchNearbyGroup,
  fetchPhysicalTapResolve,
  normalizeRenderedPropertyGroup,
  type PropertyResolveResult,
} from '@/src/utils/api';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import { PREVIEW_CARD_VIEWPORT_ANCHOR, viewportAnchorToOffset } from '@/src/lib/mapCameraAnchor';
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
  DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
  getCanonicalMapFilterSignature,
  getLocationFilterTokenCameraBounds,
  getLocationFilterTokenCameraMaxZoom,
  getMapFilterSearchString,
  hasMapFilterQueryParams,
  parseMapFiltersFromSearchParams,
  serializeLocationFilterToken,
  type MapActivityTimeFilter,
  type MapFilters,
} from '@/src/lib/sharedMapFilters';
import {
  getCurrentBrowserPathname,
  pushBrowserPath,
  type PushBrowserPathOptions,
  replacePassiveBrowserPath,
} from '@/src/lib/webMapUrlSync';
import { registerWebMapCameraPopHandler } from '@/src/lib/webMapCameraHistory';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEFAULT_BEARING, DEBUG_CAMERA } from '@/src/lib/mapDefaults';
import { useBenchmarkRenderProbe } from '@/src/lib/benchmarkRenderProbe';
import { useResolvedMapRoute } from '@/src/lib/useResolvedMapRoute';
import { useAuthContext } from '@/src/providers/AuthProvider';
import type { LocationFilterToken } from '@huishype/shared';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import { TAB_BAR_DOCK_HEIGHT } from '@/src/components/navigation/tabBarMetrics';
import { MapWelcomeInfoButton } from '@/src/components/map/MapWelcomeInfoButton';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { useT } from '@/src/i18n';
import type { AddressSearchBias, ResolvedAddress } from '@/src/services/address-resolver';
import { hydrateLocationFilterTokens } from '@/src/services/location-search';
import {
  buildCanonicalRouteHref,
  buildPropertyMapCommentsRoute,
  buildPropertyMapGuessesRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';
import { PROPERTY_QUERY_LAYER_IDS } from '@/src/lib/propertyQueryLayers';
import {
  MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD,
  PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM,
  resolveActiveClusterNodeVisual,
  resolveActiveSingleNodeVisual,
  withAlpha,
} from '@huishype/shared/config';
import {
  buildCanonicalMapPreviewPath,
  serializeCanonicalCameraPath,
} from '@huishype/shared';

// Style URL — served by our API, merging the HuisHype base style,
// property layers, 3D buildings, and self-hosted fonts.
const STYLE_URL = `${API_URL}/tiles/style.json`;
const FLOATING_ZOOM_CONTROL_RIGHT = 18;
const FLOATING_ZOOM_CONTROL_TOP = 118;
const FLOATING_ZOOM_CONTROL_SIZE = 40;
const MAP_ATTRIBUTION_BOTTOM_GAP = 2;
const MAP_ATTRIBUTION_BOTTOM_OFFSET = TAB_BAR_DOCK_HEIGHT + MAP_ATTRIBUTION_BOTTOM_GAP;
const WEB_TOUCH_LONG_PRESS_MS = 550;
const HOUSE_NUMBER_LAYER_ID = 'housenumber';
const SELECTED_MARKER_CONTAINER_SIZE_PX = 24;
const SELECTED_MARKER_PULSE_SIZE_PX = 32;
const SELECTED_MARKER_DOT_SIZE_PX = 18;
const CURRENT_LOCATION_MARKER_SIZE_PX = 34;
const CURRENT_LOCATION_RING_SIZE_PX = 18;
const CURRENT_LOCATION_DOT_SIZE_PX = 12;
const STATIC_ACTIVITY_PULSE_LAYER_IDS = [
  'property-cluster-pulse',
  'active-node-pulse',
] as const;
const PREVIEW_ARROW_MARKER_GAP_PX = 6;
const PREVIEW_CARD_MARKER_OFFSET_PX =
  SELECTED_MARKER_CONTAINER_SIZE_PX / 2 + PREVIEW_ARROW_MARKER_GAP_PX;
const SEARCH_TARGET_ZOOM = PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM + 1;
const FOLLOWING_RENDERED_FEATURE_SETTLE_MS = 1500;
const NON_MAP_TAB_PATHNAMES = new Set(['/feed', '/saved', '/profile']);
const AMBIENT_COMMENT_BUBBLE_MIN_ZOOM = 10;
const ACTIVITY_PULSE_DOM_MIN_ZOOM = 10;
const CAMERA_EPSILON = 0.000001;
const ZOOM_EPSILON = 0.001;
const BROWSER_CAMERA_POP_FLY_DURATION_MS = 700;
const CAMERA_HISTORY_CHECKPOINT_INTERVAL_MS = 8_000;
const CAMERA_HISTORY_CHECKPOINT_ZOOM_DELTA = 0.75;
const CAMERA_HISTORY_CHECKPOINT_CENTER_DELTA_METERS = 750;
const PROPERTY_TILE_RECOVERY_RELOAD_DELAY_MS = 2_500;
const MAP_SOCIAL_PANEL_WIDTH = 420;

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

function getAreaTokenSignature(areas: readonly LocationFilterToken[] | null | undefined): string {
  return (areas ?? [])
    .map((area) => serializeLocationFilterToken(area))
    .filter((area): area is string => area != null)
    .join('|');
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

function getHouseNumberFeatureValue(features?: GeoJSON.Feature[] | null): string | null {
  const properties = features?.[0]?.properties;
  if (!properties) {
    return null;
  }

  for (const key of ['housenumber', 'addr:housenumber', 'house_number', 'number']) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function getPointFeatureCoordinate(feature?: GeoJSON.Feature | null): [number, number] | null {
  const coordinates = feature?.geometry?.type === 'Point'
    ? feature.geometry.coordinates
    : null;
  const lon = coordinates?.[0];
  const lat = coordinates?.[1];
  return typeof lon === 'number' &&
    Number.isFinite(lon) &&
    typeof lat === 'number' &&
    Number.isFinite(lat)
    ? [lon, lat]
    : null;
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
  fromCameraRoute: boolean;
}

interface CameraHistoryCheckpoint {
  lat: number;
  lng: number;
  zoom: number;
  pushedAtMs: number;
}

type ResolvedPropertyRoute = Extract<ResolvedMapRoute, { property: unknown }>;
type MapSocialRoute = Omit<ResolvedPropertyRoute, 'kind'> & {
  kind: 'map-comments' | 'map-guesses';
};

function isMapSocialRoute(
  route: ResolvedMapRoute | null | undefined,
): route is MapSocialRoute {
  return route?.kind === 'map-comments' || route?.kind === 'map-guesses';
}

function getInitialWebMapCamera(pathname: string): InitialWebMapCamera {
  const parsedRoute = parseMapRoutePath(pathname);

  if (parsedRoute.kind === 'camera') {
    return {
      center: [parsedRoute.camera.lng, parsedRoute.camera.lat],
      zoom: parsedRoute.camera.zoom,
      cameraPath: parsedRoute.pathname,
      fromCameraRoute: true,
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
    fromCameraRoute: false,
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

function getApproximateCenterDistanceMeters(
  from: Pick<CameraHistoryCheckpoint, 'lat' | 'lng'>,
  to: Pick<CameraHistoryCheckpoint, 'lat' | 'lng'>,
): number {
  const averageLatitudeRadians = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const metersPerDegreeLongitude = 111_320 * Math.cos(averageLatitudeRadians);
  const deltaLngMeters = (to.lng - from.lng) * metersPerDegreeLongitude;
  const deltaLatMeters = (to.lat - from.lat) * 111_320;
  return Math.hypot(deltaLngMeters, deltaLatMeters);
}

function shouldPushCameraHistoryCheckpoint({
  previousCheckpoint,
  nextCamera,
  nowMs,
  previewOpen,
}: {
  previousCheckpoint: CameraHistoryCheckpoint;
  nextCamera: Pick<CameraHistoryCheckpoint, 'lat' | 'lng' | 'zoom'>;
  nowMs: number;
  previewOpen: boolean;
}): boolean {
  if (
    previewOpen ||
    nowMs - previousCheckpoint.pushedAtMs < CAMERA_HISTORY_CHECKPOINT_INTERVAL_MS
  ) {
    return false;
  }

  const zoomChanged =
    Math.abs(nextCamera.zoom - previousCheckpoint.zoom) >=
    CAMERA_HISTORY_CHECKPOINT_ZOOM_DELTA;
  const centerMoved =
    getApproximateCenterDistanceMeters(previousCheckpoint, nextCamera) >=
    CAMERA_HISTORY_CHECKPOINT_CENTER_DELTA_METERS;

  return zoomChanged || centerMoved;
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
    .current-location-dot-container {
      position: absolute;
      width: ${CURRENT_LOCATION_MARKER_SIZE_PX}px;
      height: ${CURRENT_LOCATION_MARKER_SIZE_PX}px;
      pointer-events: none;
    }
    .current-location-dot-halo,
    .current-location-dot-ring,
    .current-location-dot-core {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
    }
    .current-location-dot-halo {
      width: ${CURRENT_LOCATION_MARKER_SIZE_PX}px;
      height: ${CURRENT_LOCATION_MARKER_SIZE_PX}px;
      background-color: rgba(66, 133, 244, 0.2);
    }
    .current-location-dot-ring {
      width: ${CURRENT_LOCATION_RING_SIZE_PX}px;
      height: ${CURRENT_LOCATION_RING_SIZE_PX}px;
      background-color: #FFFFFF;
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.22);
    }
    .current-location-dot-core {
      width: ${CURRENT_LOCATION_DOT_SIZE_PX}px;
      height: ${CURRENT_LOCATION_DOT_SIZE_PX}px;
      background-color: #1A73E8;
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

const MAP_SOCIAL_OVERLAY_CSS_ID = 'map-social-overlay-css';
if (typeof document !== 'undefined') {
  let style = document.getElementById(MAP_SOCIAL_OVERLAY_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = MAP_SOCIAL_OVERLAY_CSS_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    .map-social-overlay {
      display: contents;
    }

    @media (orientation: portrait) {
      .map-social-overlay {
        position: fixed;
        left: 0;
        right: 0;
        bottom: ${TAB_BAR_DOCK_HEIGHT}px;
        height: min(68vh, calc(100vh - ${TAB_BAR_DOCK_HEIGHT + 24}px));
        z-index: 2003;
        overflow: hidden;
        border-radius: 16px 16px 0 0;
        background: #FFFBF5;
        box-shadow: 0 -6px 28px rgba(0, 0, 0, 0.16);
        display: flex;
        flex-direction: column;
      }

      .map-social-overlay > * {
        min-height: 0;
        flex: 1 1 auto;
      }
    }

    @media (orientation: landscape) and (min-width: ${MAP_SOCIAL_PANEL_WIDTH * 2}px) {
      body.map-social-overlay-open .web-property-panel--landscape.open {
        right: ${MAP_SOCIAL_PANEL_WIDTH}px;
      }
    }

    @media (orientation: landscape) and (max-width: ${MAP_SOCIAL_PANEL_WIDTH * 2 - 1}px) {
      body.map-social-overlay-open .responsive-panel--landscape.open {
        z-index: 2003;
      }
    }
  `;
}

const MAP_ATTRIBUTION_CSS_ID = 'map-attribution-css';
if (typeof document !== 'undefined' && !document.getElementById(MAP_ATTRIBUTION_CSS_ID)) {
  const style = document.createElement('style');
  style.id = MAP_ATTRIBUTION_CSS_ID;
  style.textContent = `
    .maplibregl-ctrl-bottom-left {
      left: 0;
      bottom: ${MAP_ATTRIBUTION_BOTTOM_OFFSET}px;
      z-index: 4;
      pointer-events: none;
    }
    .maplibregl-ctrl-attrib {
      max-width: min(520px, 100vw);
      margin: 0 !important;
      padding: 0 5px;
      border-radius: 0;
      background: rgba(255, 255, 255, 0.5);
      border: 0;
      box-shadow: none;
      color: rgb(34, 34, 34);
      font: 12px/20px "Helvetica Neue", Arial, Helvetica, sans-serif;
      pointer-events: none;
    }
    .maplibregl-ctrl-attrib a {
      color: rgb(34, 34, 34);
      text-decoration: none;
    }
    .maplibregl-ctrl-attrib a:hover {
      text-decoration: underline;
    }
    @media (max-width: 640px) {
      .maplibregl-ctrl-bottom-left {
        left: 0;
        bottom: ${MAP_ATTRIBUTION_BOTTOM_OFFSET}px;
        display: flex;
      }
      .maplibregl-ctrl-attrib {
        max-width: 100vw;
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

function createCurrentLocationMarkerElement(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'current-location-dot-container';
  container.setAttribute('data-testid', 'current-location-dot');

  const halo = document.createElement('div');
  halo.className = 'current-location-dot-halo';

  const ring = document.createElement('div');
  ring.className = 'current-location-dot-ring';

  const dot = document.createElement('div');
  dot.className = 'current-location-dot-core';

  container.appendChild(halo);
  container.appendChild(ring);
  container.appendChild(dot);

  return container;
}

function MapSocialOverlay({
  route,
  returnTo,
  onNavigate,
}: {
  route: MapSocialRoute;
  returnTo: string;
  onNavigate: (path: string) => void;
}) {
  const testID =
    route.kind === 'map-comments'
      ? 'map-comments-overlay'
      : 'map-guesses-overlay';

  return (
    <div className="map-social-overlay" data-testid={testID}>
      {route.kind === 'map-comments' ? (
        <CommentsRouteScreen
          propertyId={route.property.id}
          returnTo={returnTo}
          onNavigate={onNavigate}
        />
      ) : (
        <GuessesRouteScreen
          propertyId={route.property.id}
          returnTo={returnTo}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
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
const PROPERTY_LAYER_IDS = [...PROPERTY_QUERY_LAYER_IDS];
const AMBIENT_BUBBLE_SETTLE_DELAY_MS = 900;
const AMBIENT_BUBBLE_RESET_ZOOM_OUT_DELTA = 0.75;

export default function MapScreen({ pathnameOverride }: MapScreenProps = {}) {
  useBenchmarkRenderProbe('map-screen');

  const t = useT();
  const welcomeModal = useWelcomeModal();
  const isFocused = useIsFocused();
  const initialSearchParams = useMemo(
    () =>
      typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const hasInitialFilterSearchParams = useMemo(
    () => hasMapFilterQueryParams(initialSearchParams),
    [initialSearchParams],
  );
  const initialParsedFilters = useMemo(
    () =>
      hasInitialFilterSearchParams
        ? parseMapFiltersFromSearchParams(initialSearchParams)
        : createDefaultMapFilters(),
    [hasInitialFilterSearchParams, initialSearchParams],
  );
  const initialAppliedFilters = useMemo(
    () => ({
      ...initialParsedFilters,
      areas: (initialParsedFilters.areas ?? []).filter(
        (area) => area.type === 'current-location',
      ),
    }),
    [initialParsedFilters],
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
  const initialRoutePathname = pathnameOverride ?? getCurrentBrowserPathname('/');
  const [initialMapCamera] = useState(() =>
    getInitialWebMapCamera(initialRoutePathname),
  );
  const currentZoomRef = useRef(initialMapCamera.zoom);
  const isMapTabActive = isFocused;
  const browserPathRef = useRef(getCurrentBrowserPathname(initialRoutePathname));
  const browserSearchRef = useRef(
    typeof window === 'undefined' ? '' : window.location.search || '',
  );
  const isMapTabActiveRef = useRef(isMapTabActive);
  isMapTabActiveRef.current = isMapTabActive;
  const replaceMapBrowserPathRef = useRef<(pathname: string) => boolean>(() => false);
  const pushMapBrowserPathRef = useRef<(pathname: string) => boolean>(() => false);
  const handleAppliedFiltersChange = useCallback((nextFilters: MapFilters) => {
    if (!isMapTabActiveRef.current) {
      return;
    }

    browserSearchRef.current = getMapFilterSearchString(nextFilters, browserSearchRef.current);
    pushMapBrowserPathRef.current(browserPathRef.current);
  }, []);
  const filterController = useMapFilterController({
    initialAppliedFilters: hasInitialFilterSearchParams ? initialAppliedFilters : undefined,
    onAppliedFiltersChange: handleAppliedFiltersChange,
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
  const currentLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastSettledAmbientBubbleZoomRef = useRef<number | null>(null);
  const [visibleZoom, setVisibleZoom] = useState(initialMapCamera.zoom);
  const [currentLocationCoordinate, setCurrentLocationCoordinate] = useState<[number, number] | null>(
    null
  );
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [routePathname, setRoutePathname] = useState(initialRoutePathname);
  const routeState = useResolvedMapRoute(routePathname);
  const activeMapSocialRoute = isMapSocialRoute(routeState.resolvedRoute)
    ? routeState.resolvedRoute
    : null;
  const activeMapSocialPreviewPath = activeMapSocialRoute
    ? buildCanonicalMapPreviewPath(activeMapSocialRoute.routeInput)
    : null;
  const appliedRoutePathRef = useRef<string | null>(null);
  const skipNextPassiveUrlSyncRef = useRef(true);
  const lastCameraPathRef = useRef<string>('/');
  const hasNavigableCameraPathRef = useRef(initialMapCamera.fromCameraRoute);
  const lastCameraHistoryCheckpointRef = useRef<CameraHistoryCheckpoint>({
    lat: initialMapCamera.center[1],
    lng: initialMapCamera.center[0],
    zoom: initialMapCamera.zoom,
    pushedAtMs: Date.now(),
  });
  const resetCameraHistoryCheckpointBaseline = useCallback(
    (camera: Pick<CameraHistoryCheckpoint, 'lat' | 'lng' | 'zoom'>) => {
      lastCameraHistoryCheckpointRef.current = {
        ...camera,
        pushedAtMs: Date.now(),
      };
    },
    [],
  );
  const previousPreviewPathRef = useRef<string | null>(null);
  const directPreviewHistoryPathRef = useRef<string | null>(null);
  const previewRoutePopPathRef = useRef<string | null>(null);
  const expandedSheetHistoryPathRef = useRef<string | null>(null);
  const lockedAreaPathRef = useRef<string | null>(null);
  const canReplaceLockedAreaPathRef = useRef(true);
  const ambientBubbleRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followingRenderedFeatureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followingRenderedFeatureCount, setFollowingRenderedFeatureCount] = useState<number | null>(null);
  const [followingRenderCheckComplete, setFollowingRenderCheckComplete] = useState(false);
  const trackedFollowingEmptyViewRef = useRef(false);
  const propertyTileRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootAutoLocationRequestedRef = useRef(false);
  const rootAutoLocationCancelledByUserRef = useRef(false);

  useEffect(() => {
    registerPropertyTileRetryProtocol(maplibregl, API_URL);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    document.body.classList.toggle('map-social-overlay-open', activeMapSocialRoute !== null);
    return () => {
      document.body.classList.remove('map-social-overlay-open');
    };
  }, [activeMapSocialRoute]);

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
            subtitle: t('auth.following.subtitle'),
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
  }, [interaction, isAuthenticated, t]);

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
  const bottomSheetRefBridge = useRef(bottomSheetRef);
  bottomSheetRefBridge.current = bottomSheetRef;
  const handleFeaturePressRef = useRef(handleFeaturePress);
  handleFeaturePressRef.current = handleFeaturePress;
  const handleAuthRequiredRef = useRef(handleAuthRequired);
  handleAuthRequiredRef.current = handleAuthRequired;
  const handleClosePreviewRef = useRef(interaction.handleClosePreview);
  handleClosePreviewRef.current = interaction.handleClosePreview;

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
    if (currentPreviewProperty?.id) {
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
  const parsedRouteForPreviewState = parseMapRoutePath(routePathname);
  previewOpenRef.current =
    !!interaction.previewGroup ||
    !!interaction.highlightedCoordinate ||
    parsedRouteForPreviewState.kind === 'preview' ||
    parsedRouteForPreviewState.kind === 'map-comments' ||
    parsedRouteForPreviewState.kind === 'map-guesses' ||
    routeState.resolvedRoute?.kind === 'preview' ||
    routeState.resolvedRoute?.kind === 'map-comments' ||
    routeState.resolvedRoute?.kind === 'map-guesses';
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
  const pushMapBrowserPath = useCallback(
    (pathname: string, options?: PushBrowserPathOptions) => {
      if (!isMapTabActiveRef.current) {
        return false;
      }

      const currentBrowserPathname = getCurrentBrowserPathname('/');
      if (pathnameOverride == null && NON_MAP_TAB_PATHNAMES.has(currentBrowserPathname)) {
        return false;
      }

      const nextHref = appendSearchToPath(pathname, browserSearchRef.current);
      return pushBrowserPath(nextHref, options);
    },
    [pathnameOverride],
  );
  pushMapBrowserPathRef.current = pushMapBrowserPath;
  const openMapSocialPath = useCallback(
    (pathname: string) => {
      if (!pushMapBrowserPath(pathname)) {
        return;
      }

      browserPathRef.current = pathname;
      setRoutePathname((currentPathname) =>
        currentPathname === pathname ? currentPathname : pathname,
      );
    },
    [pushMapBrowserPath],
  );
  const handleMapSocialNavigate = useCallback(
    (target: string) => {
      const [targetPathname = '/'] = target.split('?');
      if (targetPathname.startsWith('/map/')) {
        if (replaceMapBrowserPath(targetPathname)) {
          browserPathRef.current = targetPathname;
        }
        setRoutePathname((currentPathname) =>
          currentPathname === targetPathname ? currentPathname : targetPathname,
        );
        return;
      }

      router.navigate(toInternalAppHref(target));
    },
    [replaceMapBrowserPath],
  );
  const handleMapCommentPress = useCallback(
    (_propertyId: string) => {
      const routeProperty =
        interaction.selectedPropertyForSheet ?? currentPreviewProperty ?? selectedProperty;
      if (!routeProperty) {
        return;
      }

      openMapSocialPath(buildPropertyMapCommentsRoute(routeProperty));
    },
    [
      currentPreviewProperty,
      interaction.selectedPropertyForSheet,
      openMapSocialPath,
      selectedProperty,
    ],
  );
  const handleMapGuessPress = useCallback(
    (_propertyId: string) => {
      const routeProperty =
        interaction.selectedPropertyForSheet ?? currentPreviewProperty ?? selectedProperty;
      if (!routeProperty) {
        return;
      }

      openMapSocialPath(buildPropertyMapGuessesRoute(routeProperty));
    },
    [
      currentPreviewProperty,
      interaction.selectedPropertyForSheet,
      openMapSocialPath,
      selectedProperty,
    ],
  );
  const seedDirectPreviewHistory = useCallback(
    (
      previewPath: string,
      coordinates: {
        lat: number;
        lon: number;
      },
    ) => {
      if (
        directPreviewHistoryPathRef.current === previewPath ||
        previewRoutePopPathRef.current === previewPath
      ) {
        return;
      }

      let fallbackCameraPath = lastCameraPathRef.current;
      if (!hasNavigableCameraPathRef.current || fallbackCameraPath === '/') {
        fallbackCameraPath = serializeCanonicalCameraPath({
          lat: coordinates.lat,
          lng: coordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
        lastCameraPathRef.current = fallbackCameraPath;
        hasNavigableCameraPathRef.current = true;
        resetCameraHistoryCheckpointBaseline({
          lat: coordinates.lat,
          lng: coordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
      }

      if (fallbackCameraPath !== previewPath && replaceMapBrowserPath(fallbackCameraPath)) {
        browserPathRef.current = fallbackCameraPath;
      }

      if (pushMapBrowserPath(previewPath)) {
        directPreviewHistoryPathRef.current = previewPath;
        browserPathRef.current = previewPath;
      }
    },
    [
      pushMapBrowserPath,
      replaceMapBrowserPath,
      resetCameraHistoryCheckpointBaseline,
    ],
  );

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
  const { setMapSearchBias } = useMapSearchBias();
  useEffect(() => {
    setMapSearchBias(searchBias);
  }, [searchBias, setMapSearchBias]);
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
      setCurrentLocationCoordinate([longitude, latitude]);
      const targetZoom = Math.max(currentZoomRef.current, 16);
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: targetZoom,
        duration: 800,
        essential: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('map.locationUnable');
      console.warn('[MapScreen] Current location failed:', message);
      Alert.alert(t('map.locationUnavailable'), message);
    }
  }, [t]);

  const cancelRootAutoLocationAfterUserInteraction = useCallback(() => {
    if (!rootAutoLocationRequestedRef.current) {
      rootAutoLocationCancelledByUserRef.current = true;
    }
  }, []);

  const handleCurrentLocationPress = useCallback(() => {
    void flyToCurrentLocation();
  }, [flyToCurrentLocation]);

  useEffect(() => {
    if (
      DEBUG_CAMERA ||
      rootAutoLocationRequestedRef.current ||
      rootAutoLocationCancelledByUserRef.current ||
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
            ? (
                group.previewPropertyIds.length > 0 ||
                group.membershipComplete === false ||
                group.readStateCoverage === 'partial'
                  ? group.previewPropertyIds
                  : group.propertyIds
              )
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
    let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTouchLongPressTimer = () => {
      if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
    };

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
        attributionControl: false,
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
      map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');

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
        btn.title = t('nav.zoom.copyCamera');
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
        if (!previewOpenRef.current) {
          lastCameraPathRef.current = nextCameraPath;
          hasNavigableCameraPathRef.current = true;
        }
        setSearchBiasCenter({ lon: center.lng, lat: center.lat });
        onViewportCenterChangedRef.current(center.lng, center.lat, zoom);
        let didPushCameraCheckpoint = false;
        const nowMs = Date.now();
        const nextCheckpointCamera = {
          lat: center.lat,
          lng: center.lng,
          zoom,
        };
        if (
          shouldPushCameraHistoryCheckpoint({
            previousCheckpoint: lastCameraHistoryCheckpointRef.current,
            nextCamera: nextCheckpointCamera,
            nowMs,
            previewOpen: previewOpenRef.current,
          }) &&
          pushMapBrowserPathRef.current(nextCameraPath)
        ) {
          didPushCameraCheckpoint = true;
          lastCameraHistoryCheckpointRef.current = {
            ...nextCheckpointCamera,
            pushedAtMs: nowMs,
          };
        }
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
        browserPathRef.current = didPushCameraCheckpoint
          ? nextCameraPath
          : passiveSyncResult.browserPathname;
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
        cancelRootAutoLocationAfterUserInteraction();
        isDragging.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('dragend', () => { setTimeout(() => { isDragging.current = false; }, 100); });
      map.on('zoomstart', () => {
        cancelRootAutoLocationAfterUserInteraction();
        isZooming.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('zoomend', () => { setTimeout(() => { isZooming.current = false; }, 100); });
      map.on('rotatestart', () => {
        cancelRootAutoLocationAfterUserInteraction();
        isRotating.current = true;
        canReplaceLockedAreaPathRef.current = true;
      });
      map.on('rotateend', () => { setTimeout(() => { isRotating.current = false; }, 100); });
      map.on('mousedown', cancelRootAutoLocationAfterUserInteraction);

      const resolvePhysicalTapAtCoordinate = async (
        lon: number,
        lat: number,
        currentZoom: number,
        event?: {
          preventDefault?: () => void;
          originalEvent?: { preventDefault?: () => void };
        },
      ): Promise<boolean> => {
        if (currentZoom < PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM) {
          return false;
        }

        event?.preventDefault?.();
        event?.originalEvent?.preventDefault?.();

        try {
          const resolved = await fetchPhysicalTapResolve(lon, lat, currentZoom);
          if (resolved) {
            handleNearbyResultRef.current(
              resolved,
              currentZoom,
              cameraCommandsRef.current,
            );
          }
          return true;
        } catch (error) {
          console.warn('[HuisHype] Physical tap resolver failed:', error);
          return true;
        }
      };

      const getMapEventCoordinate = (event: {
        lngLat?: { lng?: number; lat?: number };
      }): [number, number] | null => {
        const lon = event.lngLat?.lng;
        const lat = event.lngLat?.lat;
        return typeof lon === 'number' &&
          Number.isFinite(lon) &&
          typeof lat === 'number' &&
          Number.isFinite(lat)
          ? [lon, lat]
          : null;
      };

      const markPropertyClickHandled = () => {
        propertyClickHandled.current = true;
        if (propertyClickResetTimer.current) {
          clearTimeout(propertyClickResetTimer.current);
        }
        propertyClickResetTimer.current = setTimeout(() => {
          propertyClickHandled.current = false;
          propertyClickResetTimer.current = null;
        }, 0);
      };

      const handleMapContextMenu = (
        event: maplibregl.MapMouseEvent & {
          preventDefault?: () => void;
          originalEvent?: { preventDefault?: () => void };
        },
      ) => {
        const coordinate = getMapEventCoordinate(event);
        if (!coordinate) {
          return;
        }

        void resolvePhysicalTapAtCoordinate(
          coordinate[0],
          coordinate[1],
          map.getZoom(),
          event,
        );
      };

      const handleMapTouchStart = (
        event: maplibregl.MapTouchEvent & {
          preventDefault?: () => void;
          originalEvent?: { preventDefault?: () => void };
          points?: unknown[];
        },
      ) => {
        cancelRootAutoLocationAfterUserInteraction();
        clearTouchLongPressTimer();
        if (map.getZoom() < PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM || (event.points?.length ?? 1) > 1) {
          return;
        }

        const coordinate = getMapEventCoordinate(event);
        if (!coordinate) {
          return;
        }

        touchLongPressTimer = setTimeout(() => {
          touchLongPressTimer = null;
          void resolvePhysicalTapAtCoordinate(
            coordinate[0],
            coordinate[1],
            map.getZoom(),
            event,
          );
        }, WEB_TOUCH_LONG_PRESS_MS);
      };

      map.on('contextmenu', handleMapContextMenu);
      map.on('touchstart', handleMapTouchStart);
      map.on('touchmove', clearTouchLongPressTimer);
      map.on('touchend', clearTouchLongPressTimer);
      map.on('touchcancel', clearTouchLongPressTimer);

      // Handle click on property points
      const handlePropertyClick = async (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
      ) => {
        if (!e.features?.length) return;

        markPropertyClickHandled();

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

      const handleHouseNumberClick = (
        event: maplibregl.MapMouseEvent & {
          features?: maplibregl.GeoJSONFeature[];
          preventDefault?: () => void;
          originalEvent?: { preventDefault?: () => void };
        },
      ) => {
        const features = event.features as unknown as GeoJSON.Feature[] | undefined;
        const houseNumber = getHouseNumberFeatureValue(features);
        if (!houseNumber) {
          return;
        }

        const coordinate = getPointFeatureCoordinate(features?.[0]) ?? getMapEventCoordinate(event);
        if (!coordinate) {
          return;
        }

        markPropertyClickHandled();
        event.preventDefault?.();
        event.originalEvent?.preventDefault?.();

        const currentZoom = map.getZoom();
        void fetchHouseNumberTapResolve(coordinate[0], coordinate[1], currentZoom, houseNumber)
          .then((resolved) => {
            if (resolved) {
              handleNearbyResultRef.current(
                resolved,
                currentZoom,
                cameraCommandsRef.current,
              );
              return;
            }

            handleEmptyMapTapRef.current();
          })
          .catch((error) => {
            console.warn('[HuisHype] House-number tap resolver failed:', error);
            handleEmptyMapTapRef.current();
          });
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
      const attachLayerHandlers = () => {
        PROPERTY_LAYER_IDS.forEach((layerId) => {
          if (map.getLayer(layerId) && !layerHandlersAttached.has(layerId)) {
            layerHandlersAttached.add(layerId);
            map.on('click', layerId, handlePropertyClick);
            map.on('mouseenter', layerId, handleMouseEnter);
            map.on('mouseleave', layerId, handleMouseLeave);
          }
        });

        if (
          map.getLayer(HOUSE_NUMBER_LAYER_ID) &&
          !layerHandlersAttached.has(HOUSE_NUMBER_LAYER_ID)
        ) {
          layerHandlersAttached.add(HOUSE_NUMBER_LAYER_ID);
          map.on('click', HOUSE_NUMBER_LAYER_ID, handleHouseNumberClick);
          map.on('mouseenter', HOUSE_NUMBER_LAYER_ID, handleMouseEnter);
          map.on('mouseleave', HOUSE_NUMBER_LAYER_ID, handleMouseLeave);
        }
      };

      attachLayerHandlers();
      map.on('styledata', attachLayerHandlers);
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

        attachLayerHandlers();
      });

      mapRef.current = map;
    }

    initMap();

    return () => {
      cancelled = true;
      clearTimeout(loadTimeout);
      clearTouchLongPressTimer();
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
  }, [
    cancelRootAutoLocationAfterUserInteraction,
    initialMapCamera.cameraPath,
    initialMapCamera.center,
    initialMapCamera.zoom,
    t,
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
      if (!property.coordinates) {
        return;
      }

      // On web, single-property search also uses the deferred pattern
      const { lon, lat } = property.coordinates;
      const coord: [number, number] = [lon, lat];

      cameraCommands.flyTo({
        center: coord,
        zoom: SEARCH_TARGET_ZOOM,
        duration: 1000,
        anchor: PREVIEW_CARD_VIEWPORT_ANCHOR,
      });
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

  const fitMapToAreaTokens = useCallback((areas: LocationFilterToken[]) => {
    const map = mapRef.current;
    if (!map || areas.length === 0) {
      return;
    }

    const bounds = getLocationFilterTokenCameraBounds(areas);
    if (bounds) {
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
        padding: 96,
        maxZoom: getLocationFilterTokenCameraMaxZoom(areas),
        duration: 650,
        essential: true,
      });
    }
  }, []);
  const suppressedAreaFitSignatureRef = useRef<string | null>(null);

  const areaFitSignature = useMemo(
    () => getAreaTokenSignature(filterController.appliedFilters.areas),
    [filterController.appliedFilters.areas],
  );

  useEffect(() => {
    if (!mapLoaded || !areaFitSignature) {
      return;
    }

    if (suppressedAreaFitSignatureRef.current === areaFitSignature) {
      return;
    }

    fitMapToAreaTokens(appliedFiltersRef.current.areas ?? []);
  }, [
    areaFitSignature,
    fitMapToAreaTokens,
    mapLoaded,
  ]);

  useEffect(() => {
    const parsedAreas = initialParsedFilters.areas ?? [];
    const hydratableAreas = parsedAreas.filter((area) => area.type !== 'current-location');
    if (hydratableAreas.length === 0) {
      return undefined;
    }

    let cancelled = false;
    void hydrateLocationFilterTokens(hydratableAreas)
      .then((hydratedAreas) => {
        if (cancelled) {
          return;
        }

        replaceAppliedFilters({
          ...initialParsedFilters,
          areas: [
            ...parsedAreas.filter((area) => area.type === 'current-location'),
            ...hydratedAreas,
          ],
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        replaceAppliedFilters(initialParsedFilters);
      });

    return () => {
      cancelled = true;
    };
  }, [initialParsedFilters, replaceAppliedFilters]);

  const commitAreaFilters = useCallback(
    (nextFilters: MapFilters) => {
      const commit = () => {
        browserSearchRef.current = getMapFilterSearchString(nextFilters, browserSearchRef.current);
        replaceMapBrowserPath(browserPathRef.current);
        replaceAppliedFilters(nextFilters);
      };

      browserSearchRef.current = getMapFilterSearchString(nextFilters, browserSearchRef.current);
      pushMapBrowserPath(browserPathRef.current);
      replaceAppliedFilters(nextFilters);

      // Camera fly/fit handlers also sync the browser path. Re-commit once on
      // the next tick so the filter query wins if both updates land together.
      if (typeof window !== 'undefined') {
        window.setTimeout(commit, 0);
      }
    },
    [pushMapBrowserPath, replaceAppliedFilters, replaceMapBrowserPath],
  );

  const handleAreaSelected = useCallback(
    (area: LocationFilterToken) => {
      const currentAreas = filterController.appliedFilters.areas ?? [];
      const nextAreas = [
        ...(area.type === 'current-location'
          ? currentAreas.filter((currentArea) => currentArea.type !== 'current-location')
          : currentAreas),
        area,
      ];
      const nextFilters = {
        ...filterController.appliedFilters,
        areas: nextAreas,
      };
      if (area.type === 'current-location') {
        const suppressedSignature = getAreaTokenSignature(nextAreas);
        suppressedAreaFitSignatureRef.current = suppressedSignature;
        window.setTimeout(() => {
          if (suppressedAreaFitSignatureRef.current === suppressedSignature) {
            suppressedAreaFitSignatureRef.current = null;
          }
        }, 2_000);
      }
      commitAreaFilters(nextFilters);
      if (area.type !== 'current-location') {
        fitMapToAreaTokens(nextAreas);
      }
    },
    [
      commitAreaFilters,
      filterController.appliedFilters,
      fitMapToAreaTokens,
    ],
  );

  const handleAreaRemoved = useCallback(
    (area: LocationFilterToken) => {
      const removeKey = serializeLocationFilterToken(area);
      const nextAreas = (filterController.appliedFilters.areas ?? []).filter(
        (candidate) => {
          const candidateKey = serializeLocationFilterToken(candidate);
          return removeKey == null ? candidate !== area : candidateKey !== removeKey;
        },
      );
      const nextFilters = {
        ...filterController.appliedFilters,
        areas: nextAreas,
      };
      commitAreaFilters(nextFilters);
      fitMapToAreaTokens(nextAreas);
    },
    [
      commitAreaFilters,
      filterController.appliedFilters,
      fitMapToAreaTokens,
    ],
  );

  const handleClearAreas = useCallback(() => {
    const nextFilters = {
      ...filterController.appliedFilters,
      areas: [],
    };
    commitAreaFilters(nextFilters);
  }, [commitAreaFilters, filterController.appliedFilters]);

  const handleSearchCurrentLocation = useCallback(async () => {
    try {
      const { longitude, latitude } = await getCurrentLocation();
      setCurrentLocationCoordinate([longitude, latitude]);
      const currentAreas = filterController.appliedFilters.areas ?? [];
      const existingCurrentLocation = (filterController.appliedFilters.areas ?? []).find(
        (area) => area.type === 'current-location',
      );
      const area: LocationFilterToken = {
        type: 'current-location',
        countryCode: null,
        value: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
        label: t('search.currentLocationLabel'),
        coordinates: [longitude, latitude],
        radiusMeters:
          existingCurrentLocation?.radiusMeters ?? DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
      };
      const nextAreas = [
        ...currentAreas.filter((currentArea) => currentArea.type !== 'current-location'),
        area,
      ];
      handleAreaSelected(area);
      fitMapToAreaTokens(nextAreas);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('map.locationUnable');
      console.warn('[MapScreen] Search current location failed:', message);
      Alert.alert(t('map.locationUnavailable'), message);
    }
  }, [filterController.appliedFilters.areas, fitMapToAreaTokens, handleAreaSelected, t]);

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

    const applyCameraPopInPlace = () => {
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
      if (expandedSheetHistoryPathRef.current && interaction.sheetIndexRef.current > 0) {
        expandedSheetHistoryPathRef.current = null;
        bottomSheetRefBridge.current.current?.close();
        return true;
      }

      const previousRoute = parseMapRoutePath(browserPathRef.current);
      const nextRoute = parseMapRoutePath(nextPathname);
      const map = mapRef.current;

      const canConsumeSamePathPop =
        isMapTabActiveRef.current &&
        previousRoute.pathname === nextRoute.pathname;

      if (canConsumeSamePathPop) {
        browserPathRef.current = nextPathname;
        setRoutePathname((currentPathname) =>
          currentPathname === nextPathname ? currentPathname : nextPathname,
        );
        return true;
      }

      const canDismissPreviewInPlace =
        isMapTabActiveRef.current &&
        previousRoute.kind === 'preview' &&
        (nextRoute.kind === 'camera' || nextRoute.kind === 'root');

      if (canDismissPreviewInPlace) {
        handleClosePreviewRef.current();
        skipNextPassiveUrlSyncRef.current = true;
        lockedAreaPathRef.current = null;
        canReplaceLockedAreaPathRef.current = true;
        expandedSheetHistoryPathRef.current = null;
        appliedRoutePathRef.current = nextPathname;
        browserPathRef.current = nextPathname;
        setRoutePathname((currentPathname) =>
          currentPathname === nextPathname ? currentPathname : nextPathname,
        );

        if (nextRoute.kind === 'camera') {
          lastCameraPathRef.current = nextRoute.pathname;
          hasNavigableCameraPathRef.current = true;
          resetCameraHistoryCheckpointBaseline(nextRoute.camera);

          if (map && !isMapAlreadyAtCamera(map, nextRoute.camera)) {
            map.flyTo({
              center: [nextRoute.camera.lng, nextRoute.camera.lat],
              zoom: nextRoute.camera.zoom,
              duration: BROWSER_CAMERA_POP_FLY_DURATION_MS,
              essential: true,
            });
          }
        }

        return true;
      }

      const canApplyPreviewRouteInPlace =
        isMapTabActiveRef.current &&
        nextRoute.kind === 'preview' &&
        previousRoute.kind !== 'preview';

      if (canApplyPreviewRouteInPlace) {
        skipNextPassiveUrlSyncRef.current = true;
        lockedAreaPathRef.current = null;
        canReplaceLockedAreaPathRef.current = true;
        expandedSheetHistoryPathRef.current = null;
        previewRoutePopPathRef.current = nextPathname;
        browserPathRef.current = nextPathname;
        setRoutePathname((currentPathname) =>
          currentPathname === nextPathname ? currentPathname : nextPathname,
        );
        return true;
      }

      const canApplyCameraInPlace =
        isMapTabActiveRef.current &&
        previousRoute.kind === 'camera' &&
        nextRoute.kind === 'camera' &&
        previousRoute.pathname !== nextRoute.pathname &&
        !!map;

      if (canApplyCameraInPlace) {
        handleClosePreviewRef.current();
        skipNextPassiveUrlSyncRef.current = true;
        lockedAreaPathRef.current = null;
        canReplaceLockedAreaPathRef.current = true;
        lastCameraPathRef.current = nextRoute.pathname;
        hasNavigableCameraPathRef.current = true;
        resetCameraHistoryCheckpointBaseline(nextRoute.camera);
        appliedRoutePathRef.current = nextPathname;
        browserPathRef.current = nextPathname;
        setRoutePathname((currentPathname) =>
          currentPathname === nextPathname ? currentPathname : nextPathname,
        );

        if (!isMapAlreadyAtCamera(map, nextRoute.camera)) {
          map.flyTo({
            center: [nextRoute.camera.lng, nextRoute.camera.lat],
            zoom: nextRoute.camera.zoom,
            duration: BROWSER_CAMERA_POP_FLY_DURATION_MS,
            essential: true,
          });
        }

        return true;
      }

      return false;
    };

    return registerWebMapCameraPopHandler(applyCameraPopInPlace);
  }, [
    interaction.sheetIndexRef,
    replaceAppliedFilters,
    resetCameraHistoryCheckpointBaseline,
  ]);

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
      if (expandedSheetHistoryPathRef.current && interaction.sheetIndexRef.current > 0) {
        expandedSheetHistoryPathRef.current = null;
        bottomSheetRefBridge.current.current?.close();
      }

      browserPathRef.current = nextPathname;
      setRoutePathname(nextPathname);
    };

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => {
      window.removeEventListener('popstate', handlePopState, { capture: true });
    };
  }, [
    interaction.sheetIndexRef,
    replaceAppliedFilters,
    resetCameraHistoryCheckpointBaseline,
  ]);

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

    if (resolvedRoute.kind === 'preview' && resolvedRoute.property.coordinates) {
      seedDirectPreviewHistory(
        resolvedRoute.canonicalPath,
        resolvedRoute.property.coordinates,
      );
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
      hasNavigableCameraPathRef.current = true;
      resetCameraHistoryCheckpointBaseline(resolvedRoute.camera);
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
      hasNavigableCameraPathRef.current = true;
      resetCameraHistoryCheckpointBaseline({
        lat: resolvedRoute.center[1],
        lng: resolvedRoute.center[0],
        zoom: resolvedRoute.zoom,
      });
      setSearchCity(resolvedRoute.cityName, resolvedRoute.center);
      appliedRoutePathRef.current = routeState.pathname;
      return;
    }

    if (
      resolvedRoute.kind === 'map-comments' ||
      resolvedRoute.kind === 'map-guesses'
    ) {
      lockedAreaPathRef.current = null;
      canReplaceLockedAreaPathRef.current = true;

      const resolvedCoordinates = resolvedRoute.property.coordinates;
      const socialPreviewPath = buildCanonicalMapPreviewPath(resolvedRoute.routeInput);
      if (previewCanonicalPath === socialPreviewPath && interaction.previewGroup) {
        appliedRoutePathRef.current = routeState.pathname;
        return;
      }

      if (!resolvedCoordinates) {
        appliedRoutePathRef.current = routeState.pathname;
        return;
      }

      skipNextPassiveUrlSyncRef.current = true;
      if (!hasNavigableCameraPathRef.current) {
        const fallbackCameraPath = serializeCanonicalCameraPath({
          lat: resolvedCoordinates.lat,
          lng: resolvedCoordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
        lastCameraPathRef.current = fallbackCameraPath;
        hasNavigableCameraPathRef.current = true;
        resetCameraHistoryCheckpointBaseline({
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
      if (!hasNavigableCameraPathRef.current) {
        const fallbackCameraPath = serializeCanonicalCameraPath({
          lat: resolvedCoordinates.lat,
          lng: resolvedCoordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
        lastCameraPathRef.current = fallbackCameraPath;
        hasNavigableCameraPathRef.current = true;
        resetCameraHistoryCheckpointBaseline({
          lat: resolvedCoordinates.lat,
          lng: resolvedCoordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
      }
      seedDirectPreviewHistory(resolvedRoute.canonicalPath, resolvedCoordinates);
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
    resetCameraHistoryCheckpointBaseline,
    seedDirectPreviewHistory,
    setSearchCity,
  ]);

  useEffect(() => {
    if (!isMapTabActive || routeState.isLoading) {
      return;
    }

    if (interaction.previewGroup && previewCanonicalPath) {
      previousPreviewPathRef.current = previewCanonicalPath;
      if (
        activeMapSocialRoute &&
        activeMapSocialPreviewPath === previewCanonicalPath
      ) {
        browserPathRef.current = activeMapSocialRoute.canonicalPath;
        return;
      }

      if (pushMapBrowserPath(previewCanonicalPath)) {
        directPreviewHistoryPathRef.current = null;
        browserPathRef.current = previewCanonicalPath;
        return;
      }

      if (browserPathRef.current !== previewCanonicalPath) {
        browserPathRef.current = previewCanonicalPath;
      }

      const resolvedRoute = routeState.resolvedRoute;
      if (
        resolvedRoute?.kind === 'preview' &&
        resolvedRoute.canonicalPath === previewCanonicalPath &&
        !hasNavigableCameraPathRef.current &&
        resolvedRoute.property.coordinates
      ) {
        const fallbackCameraPath = serializeCanonicalCameraPath({
          lat: resolvedRoute.property.coordinates.lat,
          lng: resolvedRoute.property.coordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
        lastCameraPathRef.current = fallbackCameraPath;
        hasNavigableCameraPathRef.current = true;
        resetCameraHistoryCheckpointBaseline({
          lat: resolvedRoute.property.coordinates.lat,
          lng: resolvedRoute.property.coordinates.lon,
          zoom: SEARCH_TARGET_ZOOM,
        });
      }

      if (
        resolvedRoute?.kind === 'preview' &&
        resolvedRoute.canonicalPath === previewCanonicalPath &&
        resolvedRoute.property.coordinates
      ) {
        seedDirectPreviewHistory(previewCanonicalPath, resolvedRoute.property.coordinates);
      }

      if (previewRoutePopPathRef.current === previewCanonicalPath) {
        previewRoutePopPathRef.current = null;
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
    activeMapSocialPreviewPath,
    activeMapSocialRoute,
    previewCanonicalPath,
    pushMapBrowserPath,
    replaceMapBrowserPath,
    resetCameraHistoryCheckpointBaseline,
    routeState.isLoading,
    routeState.resolvedRoute,
    seedDirectPreviewHistory,
  ]);

  useEffect(() => {
    if (!isMapTabActive || routeState.isLoading) {
      return;
    }

    if (!interaction.previewGroup || !previewCanonicalPath) {
      expandedSheetHistoryPathRef.current = null;
      return;
    }

    if (interaction.sheetIndex <= 0) {
      expandedSheetHistoryPathRef.current = null;
      return;
    }

    if (expandedSheetHistoryPathRef.current === previewCanonicalPath) {
      return;
    }

    if (browserPathRef.current !== previewCanonicalPath) {
      return;
    }

    if (pushMapBrowserPath(previewCanonicalPath, { allowSamePath: true })) {
      expandedSheetHistoryPathRef.current = previewCanonicalPath;
      browserPathRef.current = previewCanonicalPath;
    }
  }, [
    interaction.previewGroup,
    interaction.sheetIndex,
    isMapTabActive,
    previewCanonicalPath,
    pushMapBrowserPath,
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
    const map = mapRef.current;
    if (!map) return;

    if (currentLocationMarkerRef.current) {
      currentLocationMarkerRef.current.remove();
      currentLocationMarkerRef.current = null;
    }

    if (currentLocationCoordinate) {
      const markerElement = createCurrentLocationMarkerElement();
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat(currentLocationCoordinate)
        .addTo(map);

      currentLocationMarkerRef.current = marker;
    }

    return () => {
      if (currentLocationMarkerRef.current) {
        currentLocationMarkerRef.current.remove();
        currentLocationMarkerRef.current = null;
      }
    };
  }, [currentLocationCoordinate, mapLoaded]);

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
              <Text className="text-warm-600 mt-3 text-base">{t('map.loading')}</Text>
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
          selectedAreas={filterController.appliedFilters.areas ?? []}
          onAreaSelected={handleAreaSelected}
          onAreaRemoved={handleAreaRemoved}
          onClearAreas={handleClearAreas}
          onCurrentLocationSelected={handleSearchCurrentLocation}
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
                  subtitle: t('auth.following.subtitle'),
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
            <Text className="text-sm text-warm-700">
              {t('map.debug.zoom', { zoom: visibleZoom.toFixed(1) })}
            </Text>
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
        onGuessPress={handleMapGuessPress}
        onCommentPress={handleMapCommentPress}
        onAuthRequired={interaction.handleAuthRequired}
      />

      {activeMapSocialRoute && activeMapSocialPreviewPath ? (
        <MapSocialOverlay
          route={activeMapSocialRoute}
          returnTo={activeMapSocialPreviewPath}
          onNavigate={handleMapSocialNavigate}
        />
      ) : null}

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

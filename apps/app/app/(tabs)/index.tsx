import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Alert, Text, View, ActivityIndicator, Pressable, StyleSheet, type NativeSyntheticEvent } from 'react-native';
import {
  Map,
  Camera,
  Marker,
  UserLocation,
  LogManager,
  type CameraRef,
  type MapRef,
  type ViewStateChangeEvent,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import { useFocusEffect } from '@react-navigation/native';

// Suppress MapLibre native error toasts in dev (e.g. RenderThread errors in emulator)
LogManager.setLogLevel('warn');
import {
  PropertyBottomSheet,
  AuthModal,
  SearchBar,
  BottomSheetErrorBoundary,
  GroupPreviewCard,
} from '@/src/components';
import { useMapInteraction, type MapCameraCommands } from '@/src/hooks/useMapInteraction';
import { useMapCityName, extractCityFromAddress } from '@/src/hooks/useMapCityName';
import { fetchNearbyGroup } from '@/src/utils/api';
import { API_URL } from '@/src/utils/api';
import { viewportAnchorToPadding } from '@/src/lib/mapCameraAnchor';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEBUG_CAMERA } from '@/src/lib/mapDefaults';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { QUERYABLE_PROPERTY_LAYER_IDS } from '@huishype/shared/config';

// Semantic color constants for inline styles (warm palette)
const COLORS = {
  white: '#FFFFFF',
  whiteOverlay: 'rgba(255, 255, 255, 0.92)',
  gray100: '#FFF8F0',    // warm-100
  gray200: '#F5F0E8',    // warm-200
  gray600: '#736C62',    // warm-600
  gray700: '#504A42',    // warm-700
  gray800: '#3D3832',    // warm-800
  blue500: '#F5A623',    // primary-500 (gold)
} as const;

// Fallback timeout for the touch guard ref. If the map's onPress doesn't fire
// after a card touch (e.g. user lifts finger outside the map gesture area),
// the ref resets so the next map tap isn't blocked.
const TOUCH_GUARD_RESET_MS = 500;

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
function useMergedMapStyle(): Record<string, unknown> | null {
  const [mergedStyle, setMergedStyle] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(STYLE_URL)
      .then(r => r.json())
      .then((styleJson: Record<string, unknown>) => {
        if (cancelled) return;
        if (__DEV__) console.log('[HuisHype] Fetched merged style from API, layers=',
          (styleJson.layers as Array<unknown>)?.length);
        setMergedStyle(styleJson);
      })
      .catch(e => {
        console.error('[HuisHype] Failed to fetch merged style:', e.message);
        // Fallback: minimal style with just our tiles (no base map)
        const tileUrl = `${API_URL}/tiles/properties/{z}/{x}/{y}.pbf`;
        setMergedStyle({
          version: 8,
          sources: {
            'properties-source': {
              type: 'vector',
              tiles: [tileUrl],
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
        });
      });
    return () => { cancelled = true; };
  }, []);

  return mergedStyle;
}

// Property layer IDs to query for features (matching server's /tiles/style.json)
const PROPERTY_LAYER_IDS = [...QUERYABLE_PROPERTY_LAYER_IDS];

export default function MapScreen() {
  const [hasLayout, setHasLayout] = useState(false);
  // Merged style as JS object (base map + property vector tiles)
  const mergedStyle = useMergedMapStyle();
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showUserLocation, setShowUserLocation] = useState(false);
  const appliedPitchRef = useRef(getPitchForZoom(DEFAULT_ZOOM));

  // Shared map interaction state and logic
  const interaction = useMapInteraction();
  const {
    handleNearbyResult,
    handleEmptyMapTap,
    handlePropertyResolved: handleMapPropertyResolved,
    handleLocationResolved: handleMapLocationResolved,
    resetTransientUI,
  } = interaction;
  const [searchResetToken, setSearchResetToken] = useState(0);

  // Dynamic city name for the map header
  const { cityName, setSearchCity, onViewportCenterChanged } = useMapCityName();

  useFocusEffect(
    useCallback(() => {
      return () => {
        resetTransientUI();
        setSearchResetToken((value) => value + 1);
      };
    }, [resetTransientUI])
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
  const mapViewportSizeRef = useRef({ width: 0, height: 0 });

  // Build a camera adapter for the shared hook
  const cameraCommands: MapCameraCommands = useMemo(() => ({
    flyTo: (opts) => {
      const padding = opts.anchor
        ? viewportAnchorToPadding(mapViewportSizeRef.current, opts.anchor)
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
      cameraRef.current?.fitBounds(
        [bounds[0], bounds[1], bounds[2], bounds[3]],
        { padding: { top: opts.padding, right: opts.padding, bottom: opts.padding, left: opts.padding }, duration: opts.duration },
      );
    },
  }), []);

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
    },
    [syncPitchForZoom],
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
        onViewportCenterChanged(center[0], center[1], zoom);
      }
    },
    [onViewportCenterChanged, syncPitchForZoom]
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

      // Query rendered features at the tap point.
      // NOTE: On native Android, queryRenderedFeatures is unreliable with style-based
      // vector sources — we still try it first since it's free (no API call).
      if (mapRef.current) {
        try {
          const features = await mapRef.current.queryRenderedFeatures(
            pixelPoint,
            { layers: PROPERTY_LAYER_IDS }
          );

          if (features && features.length > 0) {
            const handled = await interaction.handleFeaturePress(features, currentZoom, cameraCommands);
            if (handled) return;
          }
        } catch (error) {
          console.warn('[HuisHype] Error querying features:', error);
        }
      }

      // Server-side fallback: use the nearby API with reliable lngLat coordinates.
      // Threshold at 12 (not 13) because fitBounds can settle at e.g. 12.98 for z13 clusters.
      if (currentZoom >= 12) {
        const [lon, lat] = lngLat;
        try {
          const nearby = await fetchNearbyGroup(lon, lat, currentZoom);
          if (nearby) {
            handleNearbyResult(nearby, currentZoom, cameraCommands);
            return;
          }
        } catch (error) {
          console.warn('[HuisHype] Nearby fallback failed:', error);
        }
      }

      // No features at tap point — check if we should close preview
      handleEmptyMapTap();
    },
    [interaction, handleNearbyResult, handleEmptyMapTap, currentZoom, cameraCommands]
  );

  // Search bar callbacks
  const handlePropertyResolved = useCallback(
    (
      property: Parameters<typeof handleMapPropertyResolved>[0],
      resolvedAddress?: ResolvedAddress,
    ) => {
      handleMapPropertyResolved(property, cameraCommands, resolvedAddress);
      // Set the search city from the resolved property
      const city = property.city || resolvedAddress?.details.city;
      if (city) {
        setSearchCity(city, [property.coordinates.lon, property.coordinates.lat]);
      }
    },
    [handleMapPropertyResolved, cameraCommands, setSearchCity],
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

  const handleCurrentLocationPress = useCallback(async () => {
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

  return (
    <View style={{ flex: 1 }} className="bg-warm-100">
      {/* Map View */}
      <View style={{ flex: 1 }} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        mapViewportSizeRef.current = { width, height };
        if (!hasLayout) setHasLayout(true);
      }}>
        {hasLayout && mergedStyle && (
        <Map
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          mapStyle={mergedStyle as any}
          compass
          compassPosition={{ top: 160, right: 16 }}
          compassHiddenFacingNorth
          touchPitch={false}
          onPress={handleMapPress}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
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
            <Marker
              lngLat={interaction.highlightedCoordinate}
              anchor="center"
            >
              <View pointerEvents="none" testID="selected-marker" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
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
          {interaction.previewGroup && interaction.previewGroup.properties.length > 0 && (
            <Marker
              lngLat={interaction.previewGroup.coordinate}
              anchor="bottom"
            >
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
                  setTimeout(() => { previewCardTouchedRef.current = false; }, TOUCH_GUARD_RESET_MS);
                }}
              />
            </Marker>
          )}
        </Map>
        )}

        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(255, 248, 240, 0.08)' }} />
        </View>

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gray100 }}
            testID="map-loading-indicator"
          >
            <ActivityIndicator size="large" color={COLORS.blue500} />
            <Text style={{ color: COLORS.gray600, marginTop: 12, fontSize: 16 }}>Loading map...</Text>
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

        {/* Zoom level indicator (debug camera only) */}
        {DEBUG_CAMERA && (
          <View style={{ position: 'absolute', top: 120, left: 16, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, zIndex: 50 }}>
            <Text style={{ fontSize: 12, color: COLORS.gray700 }}>
              Zoom: {currentZoom.toFixed(1)}
            </Text>
          </View>
        )}

        {/* Floating controls — lighter circular treatment to match the pen */}
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
          onAuthRequired={() => interaction.handleAuthRequired('Sign in to continue')}
        />
      </BottomSheetErrorBoundary>

      {/* Auth Modal */}
      <AuthModal
        visible={interaction.showAuthModal}
        onClose={interaction.handleAuthModalClose}
        message={interaction.authMessage}
        onSuccess={interaction.handleAuthSuccess}
        onAuthStarting={interaction.handleAuthStarting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controlRail: {
    position: 'absolute',
    right: 16,
    bottom: 108,
    zIndex: 10,
    alignItems: 'center',
    gap: 10,
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

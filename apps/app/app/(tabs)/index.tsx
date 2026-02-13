import { useRef, useCallback, useState, useEffect } from 'react';
import { Text, View, ActivityIndicator, Pressable, type NativeSyntheticEvent } from 'react-native';
import {
  Map,
  Camera,
  Marker,
  LogManager,
  type CameraRef,
  type MapRef,
  type ViewStateChangeEvent,
  type PressEvent,
} from '@maplibre/maplibre-react-native';

// Suppress MapLibre native error toasts in dev (e.g. RenderThread errors in emulator)
LogManager.setLogLevel('warn');
import {
  PropertyBottomSheet,
  AuthModal,
  SearchBar,
  BottomSheetErrorBoundary,
  GroupPreviewCard,
} from '@/src/components';
import type { GroupPreviewProperty } from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useProperty } from '@/src/hooks/useProperties';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { LARGE_CLUSTER_THRESHOLD } from '@/src/hooks/useClusterPreview';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';

import { API_URL, fetchBatchProperties, fetchNearbyCluster, type PropertyResolveResult } from '@/src/utils/api';

// No access token needed for MapLibre - it's open source

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;
const DEFAULT_PITCH = 50; // 3D perspective angle for buildings

// Style URL — served by our API, single source of truth for all map layers
const STYLE_URL = `${API_URL}/tiles/style.json`;

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
            { id: 'background', type: 'background', paint: { 'background-color': '#e0e0e0' } },
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

// Get activity level from score
function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

/** State for the geo-anchored preview card (single or cluster). */
interface PreviewGroup {
  properties: GroupPreviewProperty[];
  coordinate: [number, number]; // [longitude, latitude]
}

export default function MapScreen() {
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  // Merged style as JS object (base map + property vector tiles)
  const mergedStyle = useMergedMapStyle();
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null
  );
  const [previewGroup, setPreviewGroup] = useState<PreviewGroup | null>(null);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Timeout fallback: dismiss loading overlay after 10s even if onDidFinishLoadingMap doesn't fire
  useEffect(() => {
    if (mapLoaded) return;
    const timeout = setTimeout(() => {
      console.warn('Map loading timeout - dismissing overlay');
      setMapLoaded(true);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [mapLoaded]);

  // Cluster preview index (for paging within a cluster preview card)
  const [clusterIndex, setClusterIndex] = useState(0);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState('Sign in to continue');

  // Track bottom sheet index for preview card persistence logic
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef(-1);

  // Fetch selected property details
  const { data: selectedProperty, isLoading: propertyLoading } =
    useProperty(selectedPropertyId);

  // Property like hook
  const { isLiked, toggleLike } = usePropertyLike({
    propertyId: selectedPropertyId,
    onAuthRequired: () => handleAuthRequired('Sign in to like this property'),
  });

  // Property save hook
  const { isSaved, toggleSave } = usePropertySave({
    propertyId: selectedPropertyId,
    onAuthRequired: () => handleAuthRequired('Sign in to save this property'),
  });


  /** Convert batch/nearby properties to GroupPreviewProperty format. */
  const toGroupProperty = useCallback(
    (p: { id: string; address: string; city: string; postalCode?: string | null; wozValue?: number | null; askingPrice?: number | null; activityScore?: number; geometry?: { type: 'Point'; coordinates: [number, number] } | null; bouwjaar?: number | null; oppervlakte?: number | null }): GroupPreviewProperty => ({
      id: p.id,
      address: p.address,
      city: p.city,
      postalCode: p.postalCode,
      wozValue: p.wozValue,
      askingPrice: p.askingPrice ?? null,
      activityLevel: getActivityLevel((p.activityScore as number) ?? 0),
      activityScore: (p.activityScore as number) ?? 0,
      thumbnailUrl: p.geometry ? getPropertyThumbnailFromGeometry(p.geometry) : null,
      bouwjaar: p.bouwjaar ?? null,
      oppervlakte: p.oppervlakte ?? null,
    }),
    []
  );

  /** Open a cluster preview by batch-fetching property IDs and geo-anchoring. */
  const openClusterPreviewAtCoord = useCallback(
    async (propertyIds: string[], coordinate: [number, number]) => {
      try {
        const batch = await fetchBatchProperties(propertyIds.slice(0, 50));
        if (batch.length > 0) {
          setPreviewGroup({
            properties: batch.map(b => toGroupProperty({ ...b, activityScore: 0 })),
            coordinate,
          });
          setClusterIndex(0);
        }
      } catch (err) {
        console.warn('[HuisHype] Batch fetch for cluster preview failed:', err);
      }
    },
    [toGroupProperty]
  );

  // Handle feature press - queries rendered features from style layers via Map
  const handleFeaturePress = useCallback(
    async (features: GeoJSON.Feature[]) => {
      if (!features.length) return;
      const feature = features[0];
      const properties = feature.properties;
      if (!properties) return;

      const isCluster =
        properties.point_count !== undefined && properties.point_count > 1;

      if (isCluster) {
        const pointCount = (properties.point_count as number) ?? 0;
        const propertyIdsStr = properties.property_ids as string | undefined;
        const clusterGeom = feature.geometry;

        if (pointCount > LARGE_CLUSTER_THRESHOLD || !propertyIdsStr) {
          // Large cluster or missing IDs — zoom in
          if (clusterGeom && clusterGeom.type === 'Point') {
            const [lng, lat] = clusterGeom.coordinates as [number, number];
            const newZoom = Math.min(currentZoom + 2, 18);
            cameraRef.current?.flyTo({
              center: [lng, lat],
              zoom: newZoom,
              duration: 500,
            });
          }
        } else {
          // Small cluster — show geo-anchored GroupPreviewCard
          const ids = propertyIdsStr.split(',');
          if (clusterGeom && clusterGeom.type === 'Point') {
            const coord = clusterGeom.coordinates as [number, number];
            openClusterPreviewAtCoord(ids, coord);
          }
        }
      } else {
        const propertyId = properties.id as string;
        const activityScore = (properties.activityScore as number) ?? 0;
        const geom = feature.geometry;

        if (propertyId && geom && geom.type === 'Point') {
          const coord = geom.coordinates as [number, number];
          setSelectedPropertyId(propertyId);
          setPreviewGroup({
            properties: [{
              id: propertyId,
              address: (properties.address as string) ?? '',
              city: (properties.city as string) ?? '',
              postalCode: (properties.postalCode as string) ?? null,
              wozValue: (properties.wozValue as number) ?? null,
              askingPrice: (properties.askingPrice as number) ?? null,
              activityLevel: getActivityLevel(activityScore),
              activityScore,
              thumbnailUrl: getPropertyThumbnailFromGeometry({ type: 'Point', coordinates: coord }),
            }],
            coordinate: coord,
          });
          setClusterIndex(0);
        }
      }
    },
    [currentZoom, openClusterPreviewAtCoord]
  );

  // Handle map region change to track zoom level
  const handleRegionChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { zoom } = event.nativeEvent;
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
      }
    },
    []
  );

  // Handle bottom sheet index changes for preview card persistence logic
  const handleSheetIndexChange = useCallback((index: number) => {
    sheetIndexRef.current = index;
  }, []);

  // Handle bottom sheet close - called when sheet index changes to -1 (fully closed)
  // CRITICAL: Per expectation 0023, preview card should STAY OPEN when sheet is dismissed
  // The preview only closes when user explicitly taps empty map background while sheet is in peek/closed state
  // Dismissing the sheet via backdrop should NOT close the preview
  const handleSheetClose = useCallback(() => {
    // This is called from PropertyBottomSheet onChange when index === -1
    // Sheet has been dismissed (e.g., via backdrop tap or swipe down)
    // BUT we do NOT close the preview card here - user intention is to "return to map view"
    // not to deselect the property. Preview card remains visible showing the selected property.
    // The preview will only close when user taps on empty map background (handled in handleMapPress)
  }, []);


  // Handle quick actions from preview card
  const handleComment = useCallback((_property?: any) => {
    // Preview card stays open - user can still see the property while commenting
    bottomSheetRef.current?.scrollToComments();
  }, []);

  const handleGuess = useCallback((_property?: any) => {
    // Preview card stays open - user can still see the property while guessing
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  // Handle bottom sheet actions
  const handleSave = useCallback((_propertyId?: string) => {
    toggleSave();
  }, [toggleSave]);

  const handleShare = useCallback((_propertyId: string) => {
    // Sharing is handled within QuickActions component
  }, []);

  const handleLike = useCallback((_property?: any) => {
    toggleLike();
  }, [toggleLike]);

  const handleGuessPress = useCallback((_propertyId: string) => {
    // TODO: Open full guess modal
  }, []);

  const handleCommentPress = useCallback((_propertyId: string) => {
    // TODO: Open comments section
  }, []);

  // Auth handlers
  // Show the auth modal without dismissing the property/bottom sheet.
  // The user might cancel — we don't want to lose the selected property.
  const handleAuthRequired = useCallback((message?: string) => {
    setAuthMessage(message || 'Sign in to continue');
    setShowAuthModal(true);
  }, []);

  // Called by AuthModal right before the user actually signs in (clicked a
  // sign-in button, not cancel). Dismiss the PropertyBottomSheet BEFORE the
  // auth state change to prevent the Reanimated/GestureDetector crash in
  // PriceGuessSlider ("Couldn't find a navigation context").
  const handleAuthStarting = useCallback(() => {
    bottomSheetRef.current?.close();
    setSelectedPropertyId(null);
    setPreviewGroup(null);
  }, []);

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  // Property layer IDs to query for features (matching server's /tiles/style.json)
  const propertyLayerIds = [
    'property-clusters',
    'single-active-points',
    'active-nodes',
    'ghost-nodes',
  ];

  // Handle map press - query features at tap point, or close preview if tapping empty area
  // CRITICAL: Only close preview when bottom sheet is NOT expanded
  // If sheet is expanded (index > 0), tapping map should close sheet but preserve preview
  const handleMapPress = useCallback(
    async (event: NativeSyntheticEvent<PressEvent>) => {
      const { point, lngLat } = event.nativeEvent;
      // PixelPoint is a tuple [x, y], not an object
      const pixelPoint: [number, number] = [point[0], point[1]];

      // Query rendered features at the tap point.
      // NOTE: On native Android, queryRenderedFeatures is unreliable with style-based
      // vector sources because (a) the press event point is in screen pixels but the
      // TurboModule expects dp, causing a double-density offset, and (b) only JSX-declared
      // <VectorSource onPress> components get automatic hit testing on the native side.
      // We still try it first since it's free (no API call).
      if (mapRef.current) {
        try {
          const features = await mapRef.current.queryRenderedFeatures(
            pixelPoint,
            { layers: propertyLayerIds }
          );

          if (features && features.length > 0) {
            handleFeaturePress(features);
            return;
          }
        } catch (error) {
          console.warn('[HuisHype] Error querying features:', error);
        }
      }

      // Server-side fallback: use the nearby API with reliable lngLat coordinates.
      // Only call at zoom >= 13 to avoid excessive API hits when zoomed out.
      if (currentZoom >= 13) {
        const [lon, lat] = lngLat;
        try {
          const nearby = await fetchNearbyCluster(lon, lat, currentZoom);
          if (nearby) {
            if (nearby.type === 'single') {
              const coord = nearby.geometry?.coordinates as [number, number] | undefined;
              if (coord) {
                setSelectedPropertyId(nearby.id);
                setPreviewGroup({
                  properties: [{
                    id: nearby.id,
                    address: nearby.address,
                    city: nearby.city,
                    postalCode: nearby.postalCode,
                    wozValue: nearby.wozValue,
                    askingPrice: nearby.askingPrice,
                    activityLevel: getActivityLevel(nearby.activityScore ?? 0),
                    activityScore: nearby.activityScore ?? 0,
                    thumbnailUrl: getPropertyThumbnailFromGeometry({ type: 'Point', coordinates: coord }),
                  }],
                  coordinate: coord,
                });
                setClusterIndex(0);
                return;
              }
            } else if (nearby.type === 'cluster') {
              const pointCount = nearby.point_count ?? 0;
              if (pointCount > LARGE_CLUSTER_THRESHOLD) {
                // Large cluster — zoom in
                cameraRef.current?.flyTo({
                  center: nearby.coordinate,
                  zoom: Math.min(currentZoom + 2, 18),
                  duration: 500,
                });
              } else {
                // Small cluster — show preview card
                const ids = nearby.property_ids.split(',');
                openClusterPreviewAtCoord(ids, nearby.coordinate);
              }
              return;
            }
          }
        } catch (error) {
          console.warn('[HuisHype] Nearby fallback failed:', error);
        }
      }

      // No features at tap point - check if we should close preview
      const currentSheetIndex = sheetIndexRef.current;
      if (currentSheetIndex <= 0) {
        // Sheet is in peek (0) or closed (-1) state - safe to close preview
        if (previewGroup) {
          setPreviewGroup(null);
        }
      }
      // If sheet is expanded (1 or 2), don't close preview
      // The backdrop/sheet will handle closing itself
    },
    [previewGroup, handleFeaturePress, currentZoom, openClusterPreviewAtCoord]
  );

  // Zoom control handlers
  // Search bar callbacks
  const handlePropertyResolved = useCallback((property: PropertyResolveResult) => {
    const { lon, lat } = property.coordinates;
    const coord: [number, number] = [lon, lat];
    cameraRef.current?.flyTo({
      center: coord,
      zoom: 17,
      duration: 1000,
    });
    setSelectedPropertyId(property.id);
    setPreviewGroup({
      properties: [{
        id: property.id,
        address: property.address,
        city: property.city,
        postalCode: property.postalCode ?? null,
        wozValue: property.wozValue ?? null,
        askingPrice: null,
        activityLevel: 'cold',
        activityScore: 0,
        thumbnailUrl: getPropertyThumbnailFromGeometry({ type: 'Point', coordinates: coord }),
      }],
      coordinate: coord,
    });
    setClusterIndex(0);
  }, []);

  const handleLocationResolved = useCallback((coordinates: { lon: number; lat: number }, _address: string) => {
    cameraRef.current?.flyTo({
      center: [coordinates.lon, coordinates.lat],
      zoom: 17,
      duration: 1000,
    });
  }, []);

  const handleZoomIn = useCallback(async () => {
    const newZoom = Math.min(currentZoom + 1, 20);
    const center = await mapRef.current?.getCenter();
    if (center) {
      cameraRef.current?.flyTo({
        center,
        zoom: newZoom,
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
        duration: 300,
      });
    }
  }, [currentZoom]);

  return (
    <View style={{ flex: 1 }} className="bg-gray-100">
      {/* Map View */}
      <View style={{ flex: 1 }} onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setContentSize({ width, height });
      }}>
        {contentSize.width > 0 && mergedStyle && (
        <Map
          ref={mapRef}
          style={{ position: 'absolute', width: contentSize.width, height: contentSize.height }}
          mapStyle={mergedStyle as any}
          onPress={handleMapPress}
          onRegionDidChange={handleRegionChange}
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
              center: EINDHOVEN_CENTER,
              zoom: DEFAULT_ZOOM,
              pitch: DEFAULT_PITCH,
            }}
          />

          {/* Geo-anchored GroupPreviewCard via native Marker.
              On Android, Marker renders real native Views (not GL textures),
              so it's accessible to Maestro/uiautomator. The native map engine
              handles projection at 60fps — no async JS roundtrip needed. */}
          {previewGroup && previewGroup.properties.length > 0 && (
            <Marker
              lngLat={previewGroup.coordinate}
              anchor="bottom"
            >
              <GroupPreviewCard
                properties={previewGroup.properties}
                currentIndex={clusterIndex}
                onIndexChange={setClusterIndex}
                onClose={() => setPreviewGroup(null)}
                onPropertyTap={(property) => {
                  setSelectedPropertyId(property.id);
                  bottomSheetRef.current?.snapToIndex(1);
                }}
                onLike={handleLike}
                onComment={handleComment}
                onGuess={handleGuess}
                isLiked={isLiked}
                showArrow
                arrowDirection="down"
              />
            </Marker>
          )}
        </Map>
        )}

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' }}
            testID="map-loading-indicator"
          >
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={{ color: '#4B5563', marginTop: 12, fontSize: 16 }}>Loading map...</Text>
          </View>
        )}

        {/* Search Bar */}
        <SearchBar
          onPropertyResolved={handlePropertyResolved}
          onLocationResolved={handleLocationResolved}
        />

        {/* Zoom level indicator (dev only) */}
        {__DEV__ && (
          <View style={{ position: 'absolute', top: 16, left: 16, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 }}>
            <Text style={{ fontSize: 12, color: '#374151' }}>
              Zoom: {currentZoom.toFixed(1)}
            </Text>
          </View>
        )}

        {/* Zoom controls */}
        <View style={{
          position: 'absolute',
          top: 16,
          right: 16,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 6,
          elevation: 5,
        }}>
          <Pressable
            testID="zoom-in-button"
            onPress={handleZoomIn}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? '#F3F4F6' : '#FFFFFF',
            })}
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22, fontWeight: '300', color: '#1F2937', lineHeight: 24 }}>+</Text>
          </Pressable>
          <View style={{ height: 1, backgroundColor: '#E5E7EB', marginHorizontal: 8 }} />
          <Pressable
            testID="zoom-out-button"
            onPress={handleZoomOut}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? '#F3F4F6' : '#FFFFFF',
            })}
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 22, fontWeight: '300', color: '#1F2937', lineHeight: 24 }}>{'\u2212'}</Text>
          </Pressable>
        </View>

        {/* Loading indicator for property fetch */}
        {previewGroup && previewGroup.properties.length === 1 && propertyLoading && !selectedProperty && (
          <View className="absolute bottom-4 left-4 right-4 bg-white rounded-xl p-4 shadow-lg items-center">
            <ActivityIndicator size="small" color="#3B82F6" />
            <Text className="text-gray-500 mt-2">Loading property...</Text>
          </View>
        )}

      </View>

      {/* Property details bottom sheet */}
      <BottomSheetErrorBoundary>
        <PropertyBottomSheet
          ref={bottomSheetRef}
          property={selectedProperty ?? null}
          isLiked={isLiked}
          isSaved={isSaved}
          onClose={handleSheetClose}
          onSheetChange={handleSheetIndexChange}
          onSave={handleSave}
          onShare={handleShare}
          onLike={handleLike}
          onGuessPress={handleGuessPress}
          onCommentPress={handleCommentPress}
          onAuthRequired={() => handleAuthRequired('Sign in to continue')}
        />
      </BottomSheetErrorBoundary>

      {/* Auth Modal */}
      <AuthModal
        visible={showAuthModal}
        onClose={handleAuthModalClose}
        message={authMessage}
        onSuccess={handleAuthSuccess}
        onAuthStarting={handleAuthStarting}
      />
    </View>
  );
}

import { useRef, useCallback, useState, useEffect } from 'react';
import { Text, View, ActivityIndicator, Pressable, type NativeSyntheticEvent } from 'react-native';
import {
  Map,
  Camera,
  LogManager,
  type CameraRef,
  type MapRef,
  type ViewStateChangeEvent,
  type PressEvent,
} from '@maplibre/maplibre-react-native';

// Suppress MapLibre native error toasts in dev (e.g. RenderThread errors in emulator)
LogManager.setLogLevel('warn');
import {
  PropertyPreviewCard,
  PropertyBottomSheet,
  ClusterPreviewCard,
  AuthModal,
  SearchBar,
  BottomSheetErrorBoundary,
} from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useProperty, type Property } from '@/src/hooks/useProperties';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { useClusterPreview, LARGE_CLUSTER_THRESHOLD } from '@/src/hooks/useClusterPreview';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';

import { API_URL, fetchNearbyProperty, type PropertyResolveResult } from '@/src/utils/api';

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
function useMergedMapStyle(): object | null {
  const [mergedStyle, setMergedStyle] = useState<object | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(STYLE_URL)
      .then(r => r.json())
      .then((styleJson: Record<string, unknown>) => {
        if (cancelled) return;
        console.log('[HuisHype] Fetched merged style from API, layers=',
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
  const [showPreview, setShowPreview] = useState(false);
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

  // Cluster preview (shared hook — batch-fetches properties and manages navigation)
  const handleClusterPropertySelect = useCallback((property: Property) => {
    setSelectedPropertyId(property.id);
    // Snap to partial (index 1 = 50%) when selecting from cluster
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  const {
    clusterProperties,
    currentClusterIndex,
    isClusterPreview,
    openClusterPreview,
    closeClusterPreview,
    setCurrentClusterIndex: handleClusterIndexChange,
    handleClusterPropertyPress,
  } = useClusterPreview({ onPropertySelect: handleClusterPropertySelect });

  // Activity data for selected property (from vector tile feature)
  const [selectedActivityScore, setSelectedActivityScore] = useState(0);
  const [selectedHasListing, setSelectedHasListing] = useState(false);

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


  // Handle feature press - queries rendered features from style layers via Map
  // TODO: Re-implement using mapRef.queryRenderedFeatures() once tiles render
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
          // Small cluster — show paginated preview
          const ids = propertyIdsStr.split(',');
          openClusterPreview(ids);
        }
      } else {
        const propertyId = properties.id as string;
        const activityScore = (properties.activityScore as number) ?? 0;
        const hasListing = (properties.hasListing as boolean) ?? false;

        if (propertyId) {
          setSelectedPropertyId(propertyId);
          setSelectedActivityScore(activityScore);
          setSelectedHasListing(hasListing);
          setShowPreview(true);
          closeClusterPreview();
        }
      }
    },
    [currentZoom, openClusterPreview, closeClusterPreview]
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

  // Handle preview card press (opens full bottom sheet)
  // CRITICAL: Preview card should STAY OPEN when clicked - only expand the sheet
  const handlePreviewPress = useCallback(() => {
    // Do NOT close preview - just expand the bottom sheet
    // Preview card persists until user explicitly dismisses it
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

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

    // We also don't clear selectedPropertyId here - the property remains selected
    // Only close cluster preview since that doesn't have the same persistence rules
    closeClusterPreview();
    // Don't clear the rest - preview should persist
    // setSelectedPropertyId(null);  // DON'T do this
    // setShowPreview(false);        // DON'T do this
  }, [closeClusterPreview]);


  // Handle quick actions from preview card
  const handleComment = useCallback(() => {
    // Preview card stays open - user can still see the property while commenting
    bottomSheetRef.current?.scrollToComments();
  }, []);

  const handleGuess = useCallback(() => {
    // Preview card stays open - user can still see the property while guessing
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  // Handle bottom sheet actions
  const handleSave = useCallback((_propertyId?: string) => {
    toggleSave();
  }, [toggleSave]);

  const handleShare = useCallback((propertyId: string) => {
    console.log('Share property:', propertyId);
    // Sharing is handled within QuickActions component
  }, []);

  const handleLike = useCallback((_propertyId?: string) => {
    toggleLike();
  }, [toggleLike]);

  const handleGuessPress = useCallback((propertyId: string) => {
    console.log('Open guess for property:', propertyId);
    // TODO: Open full guess modal
  }, []);

  const handleCommentPress = useCallback((propertyId: string) => {
    console.log('Open comments for property:', propertyId);
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
    setShowPreview(false);
    closeClusterPreview();
  }, [closeClusterPreview]);

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

      // Query rendered features at the tap point
      // Note: queryRenderedFeatures in maplibre-react-native alpha may not reliably
      // find features from custom vector tile sources. This is a known limitation.
      let foundFeature = false;
      if (mapRef.current) {
        try {
          const features = await mapRef.current.queryRenderedFeatures(
            pixelPoint,
            { layers: propertyLayerIds }
          );

          if (features && features.length > 0) {
            // Found a property/cluster - handle the feature press
            handleFeaturePress(features);
            return;
          }
        } catch (error) {
          console.warn('[HuisHype] Error querying features:', error);
        }
      }

      // Fallback: use /properties/nearby API endpoint (native only).
      // queryRenderedFeatures doesn't reliably find features from custom
      // vector tile sources on Android — this is a MapLibre Native C++ bug.
      if (!foundFeature && lngLat) {
        const [lng, lat] = lngLat;
        try {
          const nearby = await fetchNearbyProperty(lng, lat, currentZoom);
          if (nearby) {
            setSelectedPropertyId(nearby.id);
            setSelectedActivityScore(nearby.activityScore);
            setSelectedHasListing(nearby.hasListing);
            setShowPreview(true);
            closeClusterPreview();
            return;
          }
        } catch (err) {
          console.warn('[HuisHype] Nearby fallback failed:', err);
        }
      }

      // No features at tap point - check if we should close preview
      const currentSheetIndex = sheetIndexRef.current;
      if (currentSheetIndex <= 0) {
        // Sheet is in peek (0) or closed (-1) state - safe to close preview
        if (showPreview) {
          setShowPreview(false);
        }
        if (isClusterPreview) {
          closeClusterPreview();
        }
      }
      // If sheet is expanded (1 or 2), don't close preview
      // The backdrop/sheet will handle closing itself
    },
    [showPreview, isClusterPreview, handleFeaturePress, closeClusterPreview, currentZoom]
  );

  // Zoom control handlers
  // Search bar callbacks
  const handlePropertyResolved = useCallback((property: PropertyResolveResult) => {
    const { lon, lat } = property.coordinates;
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: 17,
      duration: 1000,
    });
    setSelectedPropertyId(property.id);
    setSelectedActivityScore(0); // Will be updated when property data loads
    setSelectedHasListing(property.hasListing);
    setShowPreview(true);
    closeClusterPreview();
  }, [closeClusterPreview]);

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
          mapStyle={mergedStyle}
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

        {/* Property Preview Card (floating) - single property */}
        {showPreview && selectedProperty && !isClusterPreview && (
          <View className="absolute bottom-4 left-4 right-4">
            <PropertyPreviewCard
              property={{
                id: selectedProperty.id,
                address: selectedProperty.address,
                city: selectedProperty.city,
                postalCode: selectedProperty.postalCode,
                wozValue: selectedProperty.wozValue,
                activityLevel: getActivityLevel(selectedActivityScore),
                activityScore: selectedActivityScore,
                thumbnailUrl: getPropertyThumbnailFromGeometry(selectedProperty.geometry),
              }}
              isLiked={isLiked}
              onPress={handlePreviewPress}
              onLike={handleLike}
              onComment={handleComment}
              onGuess={handleGuess}
            />
          </View>
        )}

        {/* Loading indicator for property fetch */}
        {showPreview && propertyLoading && !selectedProperty && (
          <View className="absolute bottom-4 left-4 right-4 bg-white rounded-xl p-4 shadow-lg items-center">
            <ActivityIndicator size="small" color="#3B82F6" />
            <Text className="text-gray-500 mt-2">Loading property...</Text>
          </View>
        )}

        {/* Cluster Preview Card (floating) - multiple properties */}
        {isClusterPreview && clusterProperties.length > 0 && (
          <View className="absolute bottom-4 left-4 right-4">
            <ClusterPreviewCard
              properties={clusterProperties}
              currentIndex={currentClusterIndex}
              onIndexChange={handleClusterIndexChange}
              onClose={closeClusterPreview}
              onPropertyPress={handleClusterPropertyPress}
            />
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

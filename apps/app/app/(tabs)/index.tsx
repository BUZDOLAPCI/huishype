import { useRef, useCallback, useState } from 'react';
import { Text, View, ActivityIndicator, type NativeSyntheticEvent } from 'react-native';
import {
  MapView,
  Camera,
  VectorSource,
  CircleLayer,
  SymbolLayer,
  type CameraRef,
  type ViewStateChangeEvent,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import type { Feature } from 'geojson';
import Constants from 'expo-constants';

import {
  PropertyPreviewCard,
  PropertyBottomSheet,
  ClusterPreviewCard,
} from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useProperty, type Property } from '@/src/hooks/useProperties';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';

// Get API URL for tile endpoint
const getApiUrl = (): string => {
  const extra = Constants.expoConfig?.extra;
  return extra?.apiUrl ?? 'http://localhost:3000';
};

const API_URL = getApiUrl();

// No access token needed for MapLibre - it's open source

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;

// Zoom threshold for ghost nodes (matching backend)
const GHOST_NODE_THRESHOLD_ZOOM = 15;

// OpenFreeMap Positron style - light, minimalist map with proper Dutch coverage
// Shows roads, water, parks, and city labels at zoomed-out levels
// Attribution: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// Vector tile URL template
const TILE_URL = `${API_URL}/tiles/properties/{z}/{x}/{y}.pbf`;


// Get activity level from score
function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

export default function MapScreen() {
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null
  );
  const [showPreview, setShowPreview] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Cluster preview state
  const [clusterPropertyIds, setClusterPropertyIds] = useState<string[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [isClusterPreview, setIsClusterPreview] = useState(false);

  // Activity data for selected property (from vector tile feature)
  const [selectedActivityScore, setSelectedActivityScore] = useState(0);
  const [selectedHasListing, setSelectedHasListing] = useState(false);

  // Track bottom sheet index for preview card persistence logic
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef(-1);

  // Fetch selected property details
  const { data: selectedProperty, isLoading: propertyLoading } =
    useProperty(selectedPropertyId);

  // Fetch cluster properties (for paginated preview)
  const [clusterProperties, setClusterProperties] = useState<Property[]>([]);

  // Handle feature press from vector tiles
  const handleFeaturePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const { features } = event.nativeEvent;
      if (!features?.length) return;

      const feature = features[0];
      const properties = feature.properties;

      if (!properties) return;

      // Check if this is a cluster (has point_count property from backend clustering)
      const isCluster =
        properties.point_count !== undefined && properties.point_count > 1;

      if (isCluster) {
        // Cluster tap - zoom in to expand
        // For now, zoom in. In future, could show paginated preview
        const clusterGeom = feature.geometry;
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
        // Individual property tap
        const propertyId = properties.id as string;
        const activityScore = (properties.activityScore as number) ?? 0;
        const hasListing = (properties.hasListing as boolean) ?? false;

        if (propertyId) {
          setSelectedPropertyId(propertyId);
          setSelectedActivityScore(activityScore);
          setSelectedHasListing(hasListing);
          setShowPreview(true);
          setIsClusterPreview(false);
        }
      }
    },
    [currentZoom]
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
    setIsClusterPreview(false);
    // Don't clear the rest - preview should persist
    // setSelectedPropertyId(null);  // DON'T do this
    // setShowPreview(false);        // DON'T do this
  }, []);

  // Handle cluster preview navigation
  const handleClusterIndexChange = useCallback((index: number) => {
    setCurrentClusterIndex(index);
  }, []);

  // Handle cluster preview close
  const handleClusterClose = useCallback(() => {
    setIsClusterPreview(false);
    setClusterPropertyIds([]);
    setClusterProperties([]);
    setCurrentClusterIndex(0);
  }, []);

  // Handle property selection from cluster preview
  const handleClusterPropertyPress = useCallback((property: Property) => {
    setSelectedPropertyId(property.id);
    setIsClusterPreview(false);
    // Snap to partial (index 1 = 50%) when selecting from cluster
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  // Handle quick actions from preview card
  const handleLike = useCallback(() => {
    console.log('Like property:', selectedPropertyId);
    // TODO: Implement like functionality
  }, [selectedPropertyId]);

  const handleComment = useCallback(() => {
    // Preview card stays open - user can still see the property while commenting
    bottomSheetRef.current?.scrollToComments();
  }, []);

  const handleGuess = useCallback(() => {
    // Preview card stays open - user can still see the property while guessing
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  // Handle bottom sheet actions
  const handleSave = useCallback((propertyId: string) => {
    console.log('Save property:', propertyId);
    // TODO: Implement save functionality
  }, []);

  const handleShare = useCallback((propertyId: string) => {
    console.log('Share property:', propertyId);
    // Sharing is handled within QuickActions component
  }, []);

  const handleFavorite = useCallback((propertyId: string) => {
    console.log('Favorite property:', propertyId);
    // TODO: Implement favorite functionality
  }, []);

  const handleGuessPress = useCallback((propertyId: string) => {
    console.log('Open guess for property:', propertyId);
    // TODO: Open full guess modal
  }, []);

  const handleCommentPress = useCallback((propertyId: string) => {
    console.log('Open comments for property:', propertyId);
    // TODO: Open comments section
  }, []);

  // Close preview when tapping elsewhere on the map
  // CRITICAL: Only close preview when bottom sheet is NOT expanded
  // If sheet is expanded (index > 0), tapping map should close sheet but preserve preview
  const handleMapPress = useCallback(() => {
    // Check if bottom sheet is expanded (index > 0 means partial or full)
    const currentSheetIndex = sheetIndexRef.current;
    if (currentSheetIndex <= 0) {
      // Sheet is in peek (0) or closed (-1) state - safe to close preview
      if (showPreview) {
        setShowPreview(false);
      }
      if (isClusterPreview) {
        setIsClusterPreview(false);
      }
    }
    // If sheet is expanded (1 or 2), don't close preview
    // The backdrop/sheet will handle closing itself
  }, [showPreview, isClusterPreview]);

  return (
    <View className="flex-1 bg-gray-100">
      {/* Map View */}
      <View className="flex-1">
        <MapView
          style={{ flex: 1 }}
          mapStyle={STYLE_URL}
          onPress={handleMapPress}
          onRegionDidChange={handleRegionChange}
          onDidFinishLoadingMap={() => setMapLoaded(true)}
          testID="map-view"
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: EINDHOVEN_CENTER,
              zoom: DEFAULT_ZOOM,
            }}
          />

          {/* Vector tile source for properties */}
          <VectorSource
            id="properties-source"
            url={TILE_URL}
            onPress={handleFeaturePress}
          >
            {/* Layer 1: Clusters (Z0-Z14) - only formed from Active Nodes */}
            <CircleLayer
              id="clusters"
              sourceLayerID="properties"
              minZoomLevel={0}
              maxZoomLevel={GHOST_NODE_THRESHOLD_ZOOM}
              filter={['>', ['coalesce', ['get', 'point_count'], 0], 1]}
              style={{
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['coalesce', ['get', 'point_count'], 2],
                  2,
                  18,
                  10,
                  24,
                  50,
                  32,
                  100,
                  40,
                ],
                circleColor: [
                  'case',
                  ['==', ['get', 'has_active_children'], true],
                  '#FF5A5F', // Hot cluster (has active properties)
                  '#51bbd6', // Standard cluster
                ],
                circleOpacity: 0.85,
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />

            {/* Cluster count labels */}
            <SymbolLayer
              id="cluster-count"
              sourceLayerID="properties"
              minZoomLevel={0}
              maxZoomLevel={GHOST_NODE_THRESHOLD_ZOOM}
              filter={['>', ['coalesce', ['get', 'point_count'], 0], 1]}
              style={{
                textField: ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
                textSize: 14,
                textColor: '#FFFFFF',
                textHaloColor: '#000000',
                textHaloWidth: 1,
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />

            {/* Single active points at low zoom (point_count = 1 or undefined) */}
            <CircleLayer
              id="single-active-points"
              sourceLayerID="properties"
              minZoomLevel={0}
              maxZoomLevel={GHOST_NODE_THRESHOLD_ZOOM}
              filter={[
                'all',
                ['any', ['!', ['has', 'point_count']], ['==', ['coalesce', ['get', 'point_count'], 0], 1]],
              ]}
              style={{
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0],
                  0,
                  8,
                  50,
                  12,
                  100,
                  16,
                ],
                circleColor: [
                  'case',
                  ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 50],
                  '#EF4444', // red-500 (hot)
                  ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 0],
                  '#F97316', // orange-500 (warm)
                  '#3B82F6', // blue-500 (has listing but no activity)
                ],
                circleOpacity: 0.9,
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />

            {/* Layer 2: Active Nodes (Z15+) - full opacity, larger */}
            <CircleLayer
              id="active-nodes"
              sourceLayerID="properties"
              minZoomLevel={GHOST_NODE_THRESHOLD_ZOOM}
              filter={['==', ['get', 'is_ghost'], false]}
              style={{
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['coalesce', ['get', 'activityScore'], 0],
                  0,
                  6,
                  50,
                  10,
                  100,
                  14,
                ],
                circleColor: [
                  'case',
                  ['>', ['coalesce', ['get', 'activityScore'], 0], 50],
                  '#EF4444', // red-500 (hot)
                  ['>', ['coalesce', ['get', 'activityScore'], 0], 0],
                  '#F97316', // orange-500 (warm)
                  '#3B82F6', // blue-500 (has listing)
                ],
                circleOpacity: 0.9,
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />

            {/* Layer 3: Ghost Nodes (Z15+) - low opacity, small, unobtrusive */}
            <CircleLayer
              id="ghost-nodes"
              sourceLayerID="properties"
              minZoomLevel={GHOST_NODE_THRESHOLD_ZOOM}
              filter={['==', ['get', 'is_ghost'], true]}
              style={{
                circleRadius: 3,
                circleColor: '#94A3B8', // gray-400
                circleOpacity: 0.4,
                circleStrokeWidth: 1,
                circleStrokeColor: '#FFFFFF',
                circleStrokeOpacity: 0.5,
              }}
            />
          </VectorSource>
        </MapView>

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View
            className="absolute inset-0 items-center justify-center bg-gray-100"
            testID="map-loading-indicator"
          >
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-gray-600 mt-3 text-base">Loading map...</Text>
          </View>
        )}

        {/* Zoom level indicator (for debugging) */}
        <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
          <Text className="text-sm text-gray-700">
            Zoom: {currentZoom.toFixed(1)}
          </Text>
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
              onClose={handleClusterClose}
              onPropertyPress={handleClusterPropertyPress}
            />
          </View>
        )}
      </View>

      {/* Property details bottom sheet */}
      <PropertyBottomSheet
        ref={bottomSheetRef}
        property={selectedProperty ?? null}
        onClose={handleSheetClose}
        onSheetChange={handleSheetIndexChange}
        onSave={handleSave}
        onShare={handleShare}
        onFavorite={handleFavorite}
        onGuessPress={handleGuessPress}
        onCommentPress={handleCommentPress}
      />
    </View>
  );
}

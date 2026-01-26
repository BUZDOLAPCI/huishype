import { useRef, useCallback, useState, useMemo } from 'react';
import { Text, View, ActivityIndicator } from 'react-native';
import Mapbox, { MapView, Camera, ShapeSource, CircleLayer, SymbolLayer } from '@rnmapbox/maps';
import type { Feature, FeatureCollection, Point } from 'geojson';

import { PropertyPreviewCard, PropertyBottomSheet } from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useAllProperties, type Property } from '@/src/hooks/useProperties';

// Configure MapLibre (no Mapbox token needed for MapLibre)
Mapbox.setAccessToken(null);

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;

// OpenFreeMap Positron style - light, minimalist map with proper Dutch coverage
// Shows roads, water, parks, and city labels at zoomed-out levels
// Attribution: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// Property GeoJSON properties interface
interface PropertyGeoJsonProperties {
  [key: string]: unknown;
  id: string;
  address: string;
  city: string;
  postalCode: string | null;
  wozValue: number | null;
  oppervlakte: number | null;
  bouwjaar: number | null;
  activityScore: number;
}

// OnPressEvent type from @rnmapbox/maps
interface OnPressEvent {
  features: Feature[];
  coordinates: {
    latitude: number;
    longitude: number;
  };
  point: {
    x: number;
    y: number;
  };
}

// Convert properties to GeoJSON FeatureCollection
function propertiesToGeoJSON(
  properties: Property[]
): FeatureCollection<Point, PropertyGeoJsonProperties> {
  const features: Feature<Point, PropertyGeoJsonProperties>[] = properties
    .filter((p) => p.geometry !== null)
    .map((property) => ({
      type: 'Feature' as const,
      id: property.id,
      geometry: {
        type: 'Point' as const,
        coordinates: property.geometry!.coordinates,
      },
      properties: {
        id: property.id,
        address: property.address,
        city: property.city,
        postalCode: property.postalCode,
        wozValue: property.wozValue,
        oppervlakte: property.oppervlakte,
        bouwjaar: property.bouwjaar,
        // Simulate activity score (0 = ghost, >0 = active)
        // In production, this would come from the API
        activityScore: Math.random() > 0.7 ? Math.floor(Math.random() * 100) : 0,
      },
    }));

  return {
    type: 'FeatureCollection',
    features,
  };
}

// Get activity level from score
function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

export default function MapScreen() {
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Fetch properties from API
  const { data: propertiesData, isLoading, error, refetch } = useAllProperties();

  // Convert properties to GeoJSON
  const geoJSON = useMemo(() => {
    if (!propertiesData?.data) return null;
    return propertiesToGeoJSON(propertiesData.data);
  }, [propertiesData?.data]);

  // Handle property marker press
  const handleMarkerPress = useCallback(
    (event: OnPressEvent) => {
      if (!event.features?.length || !propertiesData?.data) return;

      const feature = event.features[0];
      const propertyId = (feature.properties?.id as string) || (feature.id as string);

      // Find the full property data
      const property = propertiesData.data.find((p) => p.id === propertyId);

      if (property) {
        setSelectedProperty(property);
        setShowPreview(true);
      }
    },
    [propertiesData?.data]
  );

  // Handle preview card press (opens full bottom sheet)
  const handlePreviewPress = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  // Handle bottom sheet close
  const handleSheetClose = useCallback(() => {
    setSelectedProperty(null);
    setShowPreview(false);
  }, []);

  // Handle quick actions from preview card
  const handleLike = useCallback(() => {
    console.log('Like property:', selectedProperty?.id);
    // TODO: Implement like functionality
  }, [selectedProperty?.id]);

  const handleComment = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.snapToIndex(1);
    // TODO: Scroll to comments section
  }, []);

  const handleGuess = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
    // TODO: Scroll to guess section
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

  // Close preview when tapping elsewhere
  const handleMapPress = useCallback(() => {
    if (showPreview) {
      setShowPreview(false);
    }
  }, [showPreview]);

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1 bg-gray-100 items-center justify-center">
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text className="text-gray-500 mt-4">Loading map...</Text>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View className="flex-1 bg-gray-100 items-center justify-center px-8">
        <Text className="text-red-500 text-lg mb-2">Failed to load properties</Text>
        <Text className="text-gray-500 text-sm text-center mb-4">
          {error instanceof Error ? error.message : 'An error occurred'}
        </Text>
        <Text className="text-primary-600 underline" onPress={() => refetch()}>
          Try again
        </Text>
      </View>
    );
  }

  // Get activity score for selected property
  const getSelectedPropertyActivityScore = (): number => {
    if (!selectedProperty || !geoJSON) return 0;
    const feature = geoJSON.features.find((f) => f.id === selectedProperty.id);
    return feature?.properties?.activityScore ?? 0;
  };

  return (
    <View className="flex-1 bg-gray-100">
      {/* Map View */}
      <View className="flex-1">
        <MapView
          style={{ flex: 1 }}
          styleURL={STYLE_URL}
          onPress={handleMapPress}
          testID="map-view"
        >
          <Camera
            centerCoordinate={EINDHOVEN_CENTER}
            zoomLevel={DEFAULT_ZOOM}
            animationMode="flyTo"
            animationDuration={1000}
          />

          {/* Property markers with clustering */}
          {geoJSON && (
            <ShapeSource
              id="properties"
              shape={geoJSON}
              cluster={true}
              clusterRadius={50}
              clusterMaxZoomLevel={14}
              onPress={handleMarkerPress}
            >
              {/* Clustered points */}
              <CircleLayer
                id="clusters"
                filter={['has', 'point_count']}
                style={{
                  circleRadius: [
                    'step',
                    ['get', 'point_count'],
                    20, // default size
                    10,
                    25, // 10+ points
                    50,
                    30, // 50+ points
                    100,
                    40, // 100+ points
                  ],
                  circleColor: '#3B82F6',
                  circleOpacity: 0.8,
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#FFFFFF',
                }}
              />

              {/* Cluster count labels */}
              <SymbolLayer
                id="cluster-count"
                filter={['has', 'point_count']}
                style={{
                  textField: ['get', 'point_count_abbreviated'],
                  textSize: 14,
                  textColor: '#FFFFFF',
                  textAllowOverlap: true,
                }}
              />

              {/* Ghost nodes (inactive properties) */}
              <CircleLayer
                id="ghost-points"
                filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'activityScore'], 0]]}
                style={{
                  circleRadius: 6,
                  circleColor: '#94A3B8', // gray-400
                  circleOpacity: 0.4,
                  circleStrokeWidth: 1,
                  circleStrokeColor: '#FFFFFF',
                  circleStrokeOpacity: 0.5,
                }}
              />

              {/* Active nodes (socially active properties) */}
              <CircleLayer
                id="active-points"
                filter={['all', ['!', ['has', 'point_count']], ['>', ['get', 'activityScore'], 0]]}
                style={{
                  circleRadius: [
                    'interpolate',
                    ['linear'],
                    ['get', 'activityScore'],
                    1,
                    8, // low activity
                    50,
                    12, // medium activity
                    100,
                    16, // high activity
                  ],
                  circleColor: [
                    'interpolate',
                    ['linear'],
                    ['get', 'activityScore'],
                    1,
                    '#F97316', // orange-500 (warm)
                    50,
                    '#EF4444', // red-500 (hot)
                  ],
                  circleOpacity: 0.9,
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#FFFFFF',
                }}
              />
            </ShapeSource>
          )}
        </MapView>

        {/* Property count indicator */}
        <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
          <Text className="text-sm text-gray-700">
            {propertiesData?.meta?.total ?? 0} properties
          </Text>
        </View>

        {/* Property Preview Card (floating) */}
        {showPreview && selectedProperty && (
          <View className="absolute bottom-4 left-4 right-4">
            <PropertyPreviewCard
              property={{
                id: selectedProperty.id,
                address: selectedProperty.address,
                city: selectedProperty.city,
                postalCode: selectedProperty.postalCode,
                wozValue: selectedProperty.wozValue,
                activityLevel: getActivityLevel(getSelectedPropertyActivityScore()),
                activityScore: getSelectedPropertyActivityScore(),
              }}
              onPress={handlePreviewPress}
              onLike={handleLike}
              onComment={handleComment}
              onGuess={handleGuess}
            />
          </View>
        )}
      </View>

      {/* Property details bottom sheet */}
      <PropertyBottomSheet
        ref={bottomSheetRef}
        property={selectedProperty}
        onClose={handleSheetClose}
        onSave={handleSave}
        onShare={handleShare}
        onFavorite={handleFavorite}
        onGuessPress={handleGuessPress}
        onCommentPress={handleCommentPress}
      />
    </View>
  );
}

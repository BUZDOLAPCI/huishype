import { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Text, View, ActivityIndicator, Pressable, Dimensions } from 'react-native';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';

import { PropertyPreviewCard, PropertyBottomSheet, ClusterPreviewCard } from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useAllProperties, type Property } from '@/src/hooks/useProperties';

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;
const DEFAULT_PITCH = 50; // 3D perspective angle (45-60 degrees for good 3D view)
const DEFAULT_BEARING = 0; // Map rotation

// OpenFreeMap Bright style - warm, detailed map with building data for 3D extrusions
// Includes building footprints with height data from OpenStreetMap
// Attribution: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors
const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// 3D Buildings configuration - matches reference (Snap Maps style)
const BUILDINGS_3D_CONFIG = {
  minZoom: 14, // Only show 3D buildings when zoomed in
  colors: {
    base: '#F5EEE5', // Light cream/off-white base color (warmer, lighter)
    highlight: '#FAF6F0', // Even lighter for taller buildings
  },
  opacity: 0.92,
  // Height multiplier to make buildings more prominent
  heightMultiplier: 1.0,
};

/**
 * Add 3D buildings layer using fill-extrusion
 * Buildings are colored in a beige/cream style matching the reference (Snap Maps)
 * Height data comes from OpenStreetMap via OpenFreeMap tiles
 */
function add3DBuildingsLayer(map: maplibregl.Map) {
  // Check if the building source layer exists in the style
  // OpenFreeMap Bright style uses 'openmaptiles' as source with 'building' layer
  const sourceId = 'openmaptiles';

  // First, find and remove any existing building fill layers to avoid conflicts
  // We want our 3D buildings to be the primary representation
  const existingLayers = map.getStyle()?.layers || [];
  existingLayers.forEach((layer) => {
    if (
      layer.id.includes('building') &&
      layer.type === 'fill' &&
      'source-layer' in layer &&
      layer['source-layer'] === 'building'
    ) {
      // Make existing flat building layers invisible at high zoom
      // This prevents visual conflicts with our 3D extrusions
      try {
        map.setPaintProperty(layer.id, 'fill-opacity', [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          1,
          BUILDINGS_3D_CONFIG.minZoom + 0.5,
          0,
        ]);
      } catch {
        // Layer might not support this property, ignore
      }
    }
  });

  // Add 3D buildings layer with fill-extrusion
  // Insert it before symbol layers so labels stay on top
  const labelLayerId = existingLayers.find(
    (layer) => layer.type === 'symbol' && layer.layout?.['text-field']
  )?.id;

  map.addLayer(
    {
      id: '3d-buildings',
      source: sourceId,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: BUILDINGS_3D_CONFIG.minZoom,
      filter: ['!=', ['get', 'hide_3d'], true], // Exclude underground structures
      paint: {
        // Building color - beige/cream matching reference
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['get', 'render_height'],
          0,
          BUILDINGS_3D_CONFIG.colors.base,
          50,
          BUILDINGS_3D_CONFIG.colors.highlight,
        ],
        // Building height - use render_height from OpenStreetMap data
        // Interpolate from flat at zoom 14 to full height at zoom 16
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 1,
          ['*', ['coalesce', ['get', 'render_height'], 10], BUILDINGS_3D_CONFIG.heightMultiplier],
        ],
        // Building base height (for multi-level structures)
        // Use interpolate with zoom to smoothly transition base height
        'fill-extrusion-base': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 1,
          ['coalesce', ['get', 'render_min_height'], 0],
        ],
        // Opacity - slightly transparent for softer look
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 0.5,
          BUILDINGS_3D_CONFIG.opacity,
        ],
      },
    },
    labelLayerId
  );
}

// Inject maplibre-gl CSS for web (Metro doesn't properly handle @import in global.css)
const MAPLIBRE_CSS_ID = 'maplibre-gl-css';
if (typeof document !== 'undefined' && !document.getElementById(MAPLIBRE_CSS_ID)) {
  const link = document.createElement('link');
  link.id = MAPLIBRE_CSS_ID;
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  document.head.appendChild(link);
}

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
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Cluster preview state
  const [clusterProperties, setClusterProperties] = useState<Property[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [isClusterPreview, setIsClusterPreview] = useState(false);

  // Fetch properties from API
  const { data: propertiesData, isLoading, error, refetch } = useAllProperties();

  // Convert properties to GeoJSON
  const geoJSON = useMemo(() => {
    if (!propertiesData?.data) return null;
    return propertiesToGeoJSON(propertiesData.data);
  }, [propertiesData?.data]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: EINDHOVEN_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH, // 3D perspective angle
      bearing: DEFAULT_BEARING,
      maxPitch: 70, // Allow more tilt for dramatic 3D view
    });

    // Expose map instance for testing (used by visual E2E tests)
    if (typeof window !== 'undefined') {
      (window as unknown as { __mapInstance: maplibregl.Map }).__mapInstance = map;
    }

    map.on('load', () => {
      setMapLoaded(true);

      // Configure lighting for pronounced soft shadows (Snap Maps style)
      // Using 'map' anchor for consistent directional shadows
      // Warm white light with higher intensity for visible shadow contrast
      map.setLight({
        anchor: 'map',
        color: '#FFF8F0', // Warm white light
        intensity: 0.6, // Higher intensity for more pronounced shadows
        position: [1.15, 210, 30], // Lower sun angle for longer, softer shadows
      });

      // Add 3D building layer (fill-extrusion)
      // This layer renders buildings with height data from OpenStreetMap
      add3DBuildingsLayer(map);

      // Trigger resize after map loads to ensure proper dimensions
      setTimeout(() => {
        map.resize();
      }, 100);
    });

    // Handle click on map to close preview
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['ghost-points', 'active-points', 'clusters'],
      });

      if (features.length === 0) {
        setShowPreview(false);
        setIsClusterPreview(false);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add/update data source and layers when geoJSON changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !geoJSON) return;

    // Remove existing source and layers if they exist
    if (map.getSource('properties')) {
      ['cluster-count', 'clusters', 'ghost-points', 'active-points'].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });
      map.removeSource('properties');
    }

    // Add GeoJSON source with clustering
    map.addSource('properties', {
      type: 'geojson',
      data: geoJSON,
      cluster: true,
      clusterRadius: 50,
      clusterMaxZoom: 14,
    });

    // Clustered points layer
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'properties',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': [
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
        'circle-color': '#3B82F6',
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    });

    // Cluster count labels
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'properties',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 14,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#FFFFFF',
      },
    });

    // Ghost nodes (inactive properties)
    map.addLayer({
      id: 'ghost-points',
      type: 'circle',
      source: 'properties',
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'activityScore'], 0]],
      paint: {
        'circle-radius': 6,
        'circle-color': '#94A3B8', // gray-400
        'circle-opacity': 0.4,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-opacity': 0.5,
      },
    });

    // Active nodes (socially active properties)
    map.addLayer({
      id: 'active-points',
      type: 'circle',
      source: 'properties',
      filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'activityScore'], 0]],
      paint: {
        'circle-radius': [
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
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'activityScore'],
          1,
          '#F97316', // orange-500 (warm)
          50,
          '#EF4444', // red-500 (hot)
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    });

    // Handle click on property points
    const handlePointClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
    ) => {
      if (!e.features?.length || !propertiesData?.data) return;

      const feature = e.features[0];
      const propertyId = (feature.properties?.id as string) || (feature.id as string);

      // Find the full property data
      const property = propertiesData.data.find((p) => p.id === propertyId);

      if (property) {
        setSelectedProperty(property);
        setShowPreview(true);
      }
    };

    // Handle click on clusters - show paginated preview instead of just zooming
    const handleClusterClick = async (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
    ) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      if (!features.length || !propertiesData?.data) return;

      const clusterId = features[0].properties?.cluster_id;
      const pointCount = features[0].properties?.point_count || 10;
      const source = map.getSource('properties') as maplibregl.GeoJSONSource;

      // Helper function to zoom to cluster
      const zoomToCluster = async () => {
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const geometry = features[0].geometry;
          if (geometry.type === 'Point') {
            map.easeTo({
              center: geometry.coordinates as [number, number],
              zoom: zoom ?? DEFAULT_ZOOM,
            });
          }
        } catch {
          // Ignore zoom errors
        }
      };

      try {
        // Get all properties in this cluster using Promise API
        const clusterFeatures = await source.getClusterLeaves(clusterId, pointCount, 0);

        if (!clusterFeatures || clusterFeatures.length === 0) {
          await zoomToCluster();
          return;
        }

        // Map cluster features to Property objects
        const props = clusterFeatures
          .map((f) => {
            const propertyId =
              (f.properties?.id as string) || (f.id as string | number)?.toString();
            return propertiesData.data.find((p) => p.id === propertyId);
          })
          .filter((p): p is Property => p !== undefined);

        if (props.length > 1) {
          // Show cluster preview for multiple properties
          setClusterProperties(props);
          setCurrentClusterIndex(0);
          setIsClusterPreview(true);
          setShowPreview(false); // Close single property preview if open
        } else if (props.length === 1) {
          // Single property in cluster - show regular preview
          setSelectedProperty(props[0]);
          setShowPreview(true);
          setIsClusterPreview(false);
        } else {
          // No properties found - fall back to zoom
          await zoomToCluster();
        }
      } catch {
        // On error, fall back to zoom behavior
        await zoomToCluster();
      }
    };

    map.on('click', 'ghost-points', handlePointClick);
    map.on('click', 'active-points', handlePointClick);
    map.on('click', 'clusters', handleClusterClick);

    // Change cursor on hover
    map.on('mouseenter', 'ghost-points', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'ghost-points', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'active-points', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'active-points', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'clusters', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters', () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      map.off('click', 'ghost-points', handlePointClick);
      map.off('click', 'active-points', handlePointClick);
      map.off('click', 'clusters', handleClusterClick);
    };
  }, [mapLoaded, geoJSON, propertiesData?.data]);

  // Handle preview card press (opens full bottom sheet)
  const handlePreviewPress = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  // Handle bottom sheet close
  const handleSheetClose = useCallback(() => {
    setSelectedProperty(null);
    setShowPreview(false);
    setIsClusterPreview(false);
  }, []);

  // Handle cluster preview navigation
  const handleClusterIndexChange = useCallback((index: number) => {
    setCurrentClusterIndex(index);
  }, []);

  // Handle cluster preview close
  const handleClusterClose = useCallback(() => {
    setIsClusterPreview(false);
    setClusterProperties([]);
    setCurrentClusterIndex(0);
  }, []);

  // Handle property selection from cluster preview
  const handleClusterPropertyPress = useCallback((property: Property) => {
    setSelectedProperty(property);
    setIsClusterPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
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

  // Get activity score for selected property
  const getSelectedPropertyActivityScore = (): number => {
    if (!selectedProperty || !geoJSON) return 0;
    const feature = geoJSON.features.find((f) => f.id === selectedProperty.id);
    return feature?.properties?.activityScore ?? 0;
  };

  // Error state - show full screen error
  if (error) {
    return (
      <View className="flex-1 bg-gray-100 items-center justify-center px-8">
        <Text className="text-red-500 text-lg mb-2">Failed to load properties</Text>
        <Text className="text-gray-500 text-sm text-center mb-4">
          {error instanceof Error ? error.message : 'An error occurred'}
        </Text>
        <Pressable onPress={() => refetch()}>
          <Text className="text-primary-600 underline">Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-100">
      {/* Map View - always render so ref is available for map initialization */}
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

        {/* Loading overlay - show while data is loading */}
        {isLoading && (
          <View
            className="absolute inset-0 bg-gray-100/80 items-center justify-center"
            style={{ zIndex: 10 }}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-gray-500 mt-4">Loading properties...</Text>
          </View>
        )}

        {/* Property count indicator */}
        <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
          <Text className="text-sm text-gray-700">
            {propertiesData?.meta?.total ?? 0} properties
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

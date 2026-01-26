import { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Text, View, ActivityIndicator, Pressable } from 'react-native';
import maplibregl from 'maplibre-gl';
import type { Feature } from 'geojson';
import Constants from 'expo-constants';

import {
  PropertyPreviewCard,
  PropertyBottomSheet,
  ClusterPreviewCard,
  AuthModal,
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

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;
const DEFAULT_PITCH = 50; // 3D perspective angle
const DEFAULT_BEARING = 0;

// Zoom threshold for ghost nodes (matching backend)
const GHOST_NODE_THRESHOLD_ZOOM = 15;

// OpenFreeMap Bright style - warm, detailed map with building data for 3D extrusions
const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// Vector tile URL template
const TILE_URL = `${API_URL}/tiles/properties/{z}/{x}/{y}.pbf`;

// 3D Buildings configuration
const BUILDINGS_3D_CONFIG = {
  minZoom: 14,
  colors: {
    base: '#FFFFFF',
    highlight: '#FFFFFF',
    walls: '#F8F8F5',
  },
  opacity: 1.0,
  heightMultiplier: 1.0,
};

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
 * Add 3D buildings layer
 */
function add3DBuildingsLayer(map: maplibregl.Map) {
  const sourceId = 'openmaptiles';
  const existingLayers = map.getStyle()?.layers || [];

  existingLayers.forEach((layer) => {
    const isBuilding =
      layer.id.includes('building') &&
      'source-layer' in layer &&
      layer['source-layer'] === 'building';

    if (isBuilding) {
      if (layer.type === 'fill') {
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
          // Ignore
        }
      } else if (layer.type === 'fill-extrusion') {
        try {
          map.removeLayer(layer.id);
        } catch {
          // Ignore
        }
      }
    }
  });

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
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': BUILDINGS_3D_CONFIG.colors.base,
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 1,
          [
            '*',
            ['coalesce', ['get', 'render_height'], 10],
            BUILDINGS_3D_CONFIG.heightMultiplier,
          ],
        ],
        'fill-extrusion-base': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 1,
          ['coalesce', ['get', 'render_min_height'], 0],
        ],
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          BUILDINGS_3D_CONFIG.minZoom,
          0,
          BUILDINGS_3D_CONFIG.minZoom + 0.5,
          BUILDINGS_3D_CONFIG.opacity,
        ],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    labelLayerId
  );
}

/**
 * Enhance vegetation colors
 */
function enhanceVegetationColors(map: maplibregl.Map) {
  const existingLayers = map.getStyle()?.layers || [];

  existingLayers.forEach((layer) => {
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
 * Create tree icon
 */
function createTreeIcon(size: number = 64): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  const centerX = size / 2;
  const trunkWidth = size * 0.08;
  const trunkHeight = size * 0.2;
  const canopyRadius = size * 0.35;

  ctx.fillStyle = VEGETATION_CONFIG.colors.treeTrunk;
  ctx.fillRect(
    centerX - trunkWidth / 2,
    size - trunkHeight - 2,
    trunkWidth,
    trunkHeight
  );

  const gradient = ctx.createRadialGradient(
    centerX - canopyRadius * 0.3,
    size * 0.35 - canopyRadius * 0.3,
    0,
    centerX,
    size * 0.35,
    canopyRadius
  );
  gradient.addColorStop(0, '#6BCB6B');
  gradient.addColorStop(0.5, VEGETATION_CONFIG.colors.tree);
  gradient.addColorStop(1, '#3D8B40');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, size * 0.35, canopyRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#357A38';
  ctx.lineWidth = 1;
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

/**
 * Add 3D tree symbols
 */
function add3DTreeSymbols(map: maplibregl.Map) {
  const sourceId = 'openmaptiles';

  const treeIcon = createTreeIcon(64);
  if (!map.hasImage('tree-icon')) {
    map.addImage('tree-icon', treeIcon, { pixelRatio: 2 });
  }

  const existingLayers = map.getStyle()?.layers || [];
  const labelLayerId = existingLayers.find(
    (layer) => layer.type === 'symbol' && layer.layout?.['text-field']
  )?.id;

  map.addLayer(
    {
      id: '3d-tree-symbols',
      source: sourceId,
      'source-layer': 'poi',
      type: 'symbol',
      minzoom: 14,
      filter: [
        'any',
        ['==', ['get', 'class'], 'park'],
        ['==', ['get', 'class'], 'garden'],
        ['==', ['get', 'subclass'], 'tree'],
        ['==', ['get', 'subclass'], 'park'],
        ['==', ['get', 'subclass'], 'garden'],
        ['==', ['get', 'subclass'], 'nature_reserve'],
      ],
      layout: {
        'icon-image': 'tree-icon',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 16, 0.6, 18, 0.8],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-placement': 'point',
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 16, 1.0],
      },
    },
    labelLayerId
  );
}

/**
 * Enhance base map colors
 */
function enhanceBaseMapColors(map: maplibregl.Map) {
  const existingLayers = map.getStyle()?.layers || [];

  existingLayers.forEach((layer) => {
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

      if (layer.id.includes('water') && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', ENHANCED_BASE_COLORS.water);
      }
    } catch {
      // Ignore
    }
  });
}

/**
 * Add vector tile property layers
 */
function addPropertyLayers(map: maplibregl.Map) {
  // Add vector tile source for properties
  if (!map.getSource('properties-source')) {
    map.addSource('properties-source', {
      type: 'vector',
      tiles: [TILE_URL],
      minzoom: 0,
      maxzoom: 22,
    });
  }

  // Find label layer to insert before
  const existingLayers = map.getStyle()?.layers || [];
  const labelLayerId = existingLayers.find(
    (layer) => layer.type === 'symbol' && layer.layout?.['text-field']
  )?.id;

  // Layer 1: Clusters (Z0-Z14)
  map.addLayer(
    {
      id: 'property-clusters',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: 0,
      maxzoom: GHOST_NODE_THRESHOLD_ZOOM,
      filter: ['>', ['get', 'point_count'], 1],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'point_count'],
          2,
          18,
          10,
          24,
          50,
          32,
          100,
          40,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'has_active_children'], true],
          '#FF5A5F', // Hot cluster
          '#51bbd6', // Standard cluster
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    labelLayerId
  );

  // Cluster count labels
  map.addLayer(
    {
      id: 'cluster-count',
      type: 'symbol',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: 0,
      maxzoom: GHOST_NODE_THRESHOLD_ZOOM,
      filter: ['>', ['get', 'point_count'], 1],
      layout: {
        'text-field': ['get', 'point_count'],
        'text-size': 14,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    },
    labelLayerId
  );

  // Single active points at low zoom
  map.addLayer(
    {
      id: 'single-active-points',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: 0,
      maxzoom: GHOST_NODE_THRESHOLD_ZOOM,
      filter: [
        'all',
        ['any', ['!', ['has', 'point_count']], ['==', ['get', 'point_count'], 1]],
      ],
      paint: {
        'circle-radius': [
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
        'circle-color': [
          'case',
          ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 50],
          '#EF4444', // red-500 (hot)
          ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 0],
          '#F97316', // orange-500 (warm)
          '#3B82F6', // blue-500
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    labelLayerId
  );

  // Active Nodes (Z15+)
  map.addLayer(
    {
      id: 'active-nodes',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: GHOST_NODE_THRESHOLD_ZOOM,
      filter: ['==', ['get', 'is_ghost'], false],
      paint: {
        'circle-radius': [
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
        'circle-color': [
          'case',
          ['>', ['coalesce', ['get', 'activityScore'], 0], 50],
          '#EF4444',
          ['>', ['coalesce', ['get', 'activityScore'], 0], 0],
          '#F97316',
          '#3B82F6',
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    labelLayerId
  );

  // Ghost Nodes (Z15+)
  map.addLayer(
    {
      id: 'ghost-nodes',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: GHOST_NODE_THRESHOLD_ZOOM,
      filter: ['==', ['get', 'is_ghost'], true],
      paint: {
        'circle-radius': 3,
        'circle-color': '#94A3B8',
        'circle-opacity': 0.4,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-opacity': 0.5,
      },
    },
    labelLayerId
  );
}

// Inject maplibre-gl CSS for web
const MAPLIBRE_CSS_ID = 'maplibre-gl-css';
if (typeof document !== 'undefined' && !document.getElementById(MAPLIBRE_CSS_ID)) {
  const link = document.createElement('link');
  link.id = MAPLIBRE_CSS_ID;
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  document.head.appendChild(link);
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
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);

  // Activity data for selected property
  const [selectedActivityScore, setSelectedActivityScore] = useState(0);
  const [selectedHasListing, setSelectedHasListing] = useState(false);

  // Cluster preview state
  const [clusterProperties, setClusterProperties] = useState<Property[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [isClusterPreview, setIsClusterPreview] = useState(false);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState('Sign in to continue');

  // Fetch selected property details
  const { data: selectedProperty, isLoading: propertyLoading } =
    useProperty(selectedPropertyId);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: EINDHOVEN_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxPitch: 70,
    });

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
        window as unknown as { __triggerAuthModal: (message?: string) => void }
      ).__triggerAuthModal = (message?: string) => {
        setAuthMessage(message || 'Sign in to continue');
        setShowAuthModal(true);
      };
    }

    map.on('load', () => {
      setMapLoaded(true);

      // Configure lighting
      map.setLight({
        anchor: 'viewport',
        color: '#FFFFFF',
        intensity: 0.3,
        position: [1.15, 210, 45],
      });

      // Enhance base map
      enhanceBaseMapColors(map);
      enhanceVegetationColors(map);
      add3DBuildingsLayer(map);
      add3DTreeSymbols(map);

      // Add property layers from vector tiles
      addPropertyLayers(map);

      setTimeout(() => {
        map.resize();
      }, 100);
    });

    // Track zoom level
    map.on('zoom', () => {
      setCurrentZoom(map.getZoom());
    });

    // Handle click on property points
    const handlePropertyClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
    ) => {
      if (!e.features?.length) return;

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties) return;

      // Check if cluster
      const isCluster =
        properties.point_count !== undefined && properties.point_count > 1;

      if (isCluster) {
        // Zoom in on cluster
        const geom = feature.geometry;
        if (geom.type === 'Point') {
          const newZoom = Math.min(map.getZoom() + 2, 18);
          map.easeTo({
            center: geom.coordinates as [number, number],
            zoom: newZoom,
          });
        }
      } else {
        // Individual property
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
    };

    // Handle map click to close preview
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [
          'property-clusters',
          'single-active-points',
          'active-nodes',
          'ghost-nodes',
        ],
      });

      if (features.length === 0) {
        setShowPreview(false);
        setIsClusterPreview(false);
      }
    });

    // Wait for layers to be added
    map.on('sourcedata', () => {
      // Attach click handlers once source is loaded
      const propertyLayers = [
        'property-clusters',
        'single-active-points',
        'active-nodes',
        'ghost-nodes',
      ];

      propertyLayers.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          // Remove existing handlers
          map.off('click', layerId, handlePropertyClick);
          // Add click handler
          map.on('click', layerId, handlePropertyClick);

          // Cursor style
          map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
          });
        }
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Handle preview card press
  const handlePreviewPress = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  // Handle bottom sheet close
  const handleSheetClose = useCallback(() => {
    setSelectedPropertyId(null);
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
    setSelectedPropertyId(property.id);
    setIsClusterPreview(false);
    bottomSheetRef.current?.snapToIndex(0);
  }, []);

  // Handle quick actions
  const handleLike = useCallback(() => {
    console.log('Like property:', selectedPropertyId);
  }, [selectedPropertyId]);

  const handleComment = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.scrollToComments();
  }, []);

  const handleGuess = useCallback(() => {
    setShowPreview(false);
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  const handleSave = useCallback((propertyId: string) => {
    console.log('Save property:', propertyId);
  }, []);

  const handleShare = useCallback((propertyId: string) => {
    console.log('Share property:', propertyId);
  }, []);

  const handleFavorite = useCallback((propertyId: string) => {
    console.log('Favorite property:', propertyId);
  }, []);

  const handleGuessPress = useCallback((propertyId: string) => {
    console.log('Open guess for property:', propertyId);
  }, []);

  const handleCommentPress = useCallback((propertyId: string) => {
    console.log('Open comments for property:', propertyId);
  }, []);

  // Auth handlers
  const handleAuthRequired = useCallback((message?: string) => {
    setAuthMessage(message || 'Sign in to continue');
    setShowAuthModal(true);
  }, []);

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  return (
    <View className="flex-1 bg-gray-100">
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

        {/* Zoom level indicator */}
        <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
          <Text className="text-sm text-gray-700">Zoom: {currentZoom.toFixed(1)}</Text>
        </View>

        {/* Property Preview Card */}
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

        {/* Cluster Preview Card */}
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
        onSave={handleSave}
        onShare={handleShare}
        onFavorite={handleFavorite}
        onGuessPress={handleGuessPress}
        onCommentPress={handleCommentPress}
        onAuthRequired={() => handleAuthRequired('Sign in to post your comment')}
      />

      {/* Auth Modal */}
      <AuthModal
        visible={showAuthModal}
        onClose={handleAuthModalClose}
        message={authMessage}
        onSuccess={handleAuthSuccess}
      />
    </View>
  );
}

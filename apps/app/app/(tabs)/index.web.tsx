import { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Text, View } from 'react-native';
import maplibregl from 'maplibre-gl';

import {
  GroupPreviewCard,
  AuthModal,
  SearchBar,
  PropertyBottomSheet,
} from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components/PropertyBottomSheet';
import type { GroupPreviewProperty } from '@/src/components/GroupPreviewCard';
import { useProperty } from '@/src/hooks/useProperties';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { LARGE_CLUSTER_THRESHOLD } from '@/src/hooks/useClusterPreview';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';
import { API_URL, fetchBatchProperties, type PropertyResolveResult } from '@/src/utils/api';

// Eindhoven center coordinates [longitude, latitude]
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const DEFAULT_ZOOM = 13;
const DEFAULT_PITCH = 50; // 3D perspective angle
const DEFAULT_BEARING = 0;

// Style URL — served by our API, merging OpenFreeMap base + property layers + 3D buildings + self-hosted fonts
const STYLE_URL = `${API_URL}/tiles/style.json`;

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

// Inject maplibre-gl CSS for web
const MAPLIBRE_CSS_ID = 'maplibre-gl-css';
if (typeof document !== 'undefined' && !document.getElementById(MAPLIBRE_CSS_ID)) {
  const link = document.createElement('link');
  link.id = MAPLIBRE_CSS_ID;
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  document.head.appendChild(link);
}

// Inject CSS for pulsing animation on selected node and preview card
const PULSING_CSS_ID = 'pulsing-node-css';
if (typeof document !== 'undefined' && !document.getElementById(PULSING_CSS_ID)) {
  const style = document.createElement('style');
  style.id = PULSING_CSS_ID;
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
        transform: scale(1);
        opacity: 0.8;
      }
      50% {
        transform: scale(1.4);
        opacity: 0.4;
      }
      100% {
        transform: scale(1);
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
      width: 24px;
      height: 24px;
    }
    .selected-marker-pulse {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background-color: #3B82F6;
      opacity: 0.4;
      animation: pulse-ring 1.5s ease-in-out infinite;
    }
    .selected-marker-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background-color: #3B82F6;
      border: 3px solid #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
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

/**
 * Convert a Property (or BatchProperty) to GroupPreviewProperty for the unified preview card.
 */
function toGroupPreviewProperty(
  p: {
    id: string;
    address: string;
    city: string;
    postalCode?: string | null;
    wozValue?: number | null;
    askingPrice?: number | null;
    geometry?: { type: 'Point'; coordinates: [number, number] } | null;
    bouwjaar?: number | null;
    oppervlakte?: number | null;
  },
  activityScore?: number
): GroupPreviewProperty {
  const level: 'hot' | 'warm' | 'cold' =
    activityScore != null
      ? activityScore >= 50
        ? 'hot'
        : activityScore > 0
          ? 'warm'
          : 'cold'
      : 'cold';
  return {
    id: p.id,
    address: p.address,
    city: p.city,
    postalCode: p.postalCode,
    wozValue: p.wozValue,
    askingPrice: p.askingPrice,
    thumbnailUrl: getPropertyThumbnailFromGeometry(
      (p.geometry as { type: 'Point'; coordinates: [number, number] }) ?? null
    ),
    activityLevel: level,
    activityScore,
    bouwjaar: p.bouwjaar ?? null,
    oppervlakte: p.oppervlakte ?? null,
  };
}

export default function MapScreen() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);

  // Unified preview state: null = no preview, array of 1 = single, >1 = cluster
  const [previewGroup, setPreviewGroup] = useState<{
    properties: GroupPreviewProperty[];
    coordinate: [number, number];
  } | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [arrowDirection, setArrowDirection] = useState<'up' | 'down'>('down');

  // Refs for building single-property preview when useProperty data arrives
  const pendingSinglePreview = useRef(false);
  const clickCoordRef = useRef<[number, number] | null>(null);
  const clickActivityRef = useRef(0);

  // Gesture tracking refs to prevent preview card from closing during map gestures
  const isDragging = useRef(false);
  const isZooming = useRef(false);
  const isRotating = useRef(false);

  // Flag to prevent general click handler from overriding layer-specific click handler
  const propertyClickHandled = useRef(false);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState('Sign in to continue');

  // Track bottom sheet index for preview card persistence logic
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef<number>(-1);

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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    // Fetch the merged style from our API (which already includes property layers,
    // 3D buildings, self-hosted font glyphs, self-hosted sprites, and pre-filtered
    // layers with missing sprite references removed).
    async function initMap() {
      let style: maplibregl.StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        style = await res.json();
      } catch {
        // If fetch fails, fall back to the URL and let MapLibre handle it
        style = STYLE_URL;
      }

      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: EINDHOVEN_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        maxPitch: 70,
      });

      // Add zoom controls (no compass)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

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

        // Enhance base map colors (imperative overrides on top of server-provided style)
        enhanceBaseMapColors(map);
        enhanceVegetationColors(map);
        add3DTreeSymbols(map);
        // NOTE: 3D buildings and property layers are already provided by /tiles/style.json

        setTimeout(() => {
          map.resize();
        }, 100);
      });

      // Track zoom level
      map.on('zoom', () => {
        setCurrentZoom(map.getZoom());
      });

      // Track map gestures to prevent preview card from closing during pan/zoom/rotate
      map.on('dragstart', () => {
        isDragging.current = true;
      });
      map.on('dragend', () => {
        // Small delay to prevent the click event that follows dragend from closing the preview
        setTimeout(() => {
          isDragging.current = false;
        }, 100);
      });
      map.on('zoomstart', () => {
        isZooming.current = true;
      });
      map.on('zoomend', () => {
        setTimeout(() => {
          isZooming.current = false;
        }, 100);
      });
      map.on('rotatestart', () => {
        isRotating.current = true;
      });
      map.on('rotateend', () => {
        setTimeout(() => {
          isRotating.current = false;
        }, 100);
      });

      // Handle click on property points
      const handlePropertyClick = async (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] }
      ) => {
        if (!e.features?.length) return;

        // Mark click as handled so the general click handler doesn't override our state
        propertyClickHandled.current = true;

        const feature = e.features[0];
        const properties = feature.properties;

        if (!properties) return;

        // Check if cluster
        const isCluster =
          properties.point_count !== undefined && properties.point_count > 1;

        if (isCluster) {
          const pointCount = properties.point_count as number;
          const propertyIdsStr = properties.property_ids as string | undefined;

          if (pointCount <= LARGE_CLUSTER_THRESHOLD && propertyIdsStr) {
            // Small cluster: batch fetch and show GroupPreviewCard
            const propertyIds = propertyIdsStr.split(',').filter(Boolean);
            const geom = feature.geometry;
            const coord = geom.type === 'Point'
              ? (geom.coordinates as [number, number])
              : null;

            if (coord) {
              pendingSinglePreview.current = false;
              try {
                const batchProps = await fetchBatchProperties(propertyIds);
                const gpps = batchProps.map((p) => toGroupPreviewProperty(p));
                if (gpps.length > 0) {
                  setPreviewGroup({ properties: gpps, coordinate: coord });
                  setPreviewIndex(0);
                  setSelectedPropertyId(gpps[0].id);
                }
              } catch (err) {
                console.warn('[HuisHype] Failed to fetch cluster:', err);
              }
            }
          } else {
            // Large cluster: zoom in
            const geom = feature.geometry;
            if (geom.type === 'Point') {
              const newZoom = Math.min(map.getZoom() + 2, 18);
              map.easeTo({
                center: geom.coordinates as [number, number],
                zoom: newZoom,
              });
            }
          }
        } else {
          // Individual property — at z>=17, features have `id` directly.
          // At z<17, single-point clusters (point_count=1) from the
          // `single-active-points` layer only have `property_ids`.
          const propertyId =
            (properties.id as string) ||
            (properties.property_ids as string | undefined)?.split(',')[0];
          // z17+ tiles use activityScore/hasListing; z0-z16 clustered tiles use max_activity/has_active_children
          const activityScore = (properties.activityScore as number) ??
            (properties.max_activity as number) ?? 0;

          if (propertyId) {
            // Get the coordinate from the feature geometry
            const geom = feature.geometry;
            if (geom.type === 'Point') {
              const coord = geom.coordinates as [number, number];
              clickCoordRef.current = coord;
              clickActivityRef.current = activityScore;
              pendingSinglePreview.current = true;
            }

            setSelectedPropertyId(propertyId);
          }
        }
      };

      // Handle map click to close preview - only on true background taps
      // CRITICAL: Preview card should only close when:
      // 1. User taps on empty map background AND
      // 2. Bottom sheet is NOT expanded (i.e., in peek state index 0 or closed index -1)
      map.on('click', (e) => {
        // If a layer-specific handler already processed this click, skip
        if (propertyClickHandled.current) {
          propertyClickHandled.current = false;
          return;
        }

        // Don't close preview if a gesture just ended (pan, zoom, or rotate)
        if (isDragging.current || isZooming.current || isRotating.current) {
          return;
        }

        // Only query layers that exist to avoid MapLibre errors
        const layerIds = [
          'property-clusters',
          'single-active-points',
          'active-nodes',
          'ghost-nodes',
        ].filter((layerId) => map.getLayer(layerId));

        // If no layers exist yet, don't query
        if (layerIds.length === 0) return;

        const features = map.queryRenderedFeatures(e.point, {
          layers: layerIds,
        });

        // Only close preview on true empty background tap (no features at click point)
        // AND only if bottom sheet is NOT expanded (peek or closed state)
        if (features.length === 0) {
          // Check if bottom sheet is expanded (index > 0 means partial or full)
          // If expanded, don't close preview - user intent is to dismiss sheet, not deselect property
          // Use window global as backup since closure might not capture ref updates
          const currentSheetIndex = typeof window !== 'undefined' && (window as unknown as { __sheetIndex?: number }).__sheetIndex !== undefined
            ? (window as unknown as { __sheetIndex: number }).__sheetIndex
            : sheetIndexRef.current;
          if (currentSheetIndex <= 0) {
            // Sheet is in peek (0) or closed (-1) state - safe to close preview
            setPreviewGroup(null);
          }
          // If sheet is expanded (1 or 2), the backdrop click will close the sheet
          // but we DON'T close the preview card - it should persist
        }
      });

      // Named cursor handlers so they can be properly removed/re-added
      const handleMouseEnter = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const handleMouseLeave = () => {
        map.getCanvas().style.cursor = '';
      };

      // Wait for layers to be added
      let layerHandlersAttached = new Set<string>();
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
            if (!layerHandlersAttached.has(layerId)) {
              layerHandlersAttached.add(layerId);
            }
            // Remove existing handlers before re-adding
            map.off('click', layerId, handlePropertyClick);
            map.off('mouseenter', layerId, handleMouseEnter);
            map.off('mouseleave', layerId, handleMouseLeave);
            // Add handlers
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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Handle bottom sheet index changes for preview card persistence logic
  const handleSheetIndexChange = useCallback((index: number) => {
    sheetIndexRef.current = index;
    // Expose for testing
    if (typeof window !== 'undefined') {
      (window as unknown as { __sheetIndex: number }).__sheetIndex = index;
    }
  }, []);

  // Handle bottom sheet close - called when sheet index changes to -1 (fully closed)
  // CRITICAL: Preview card should STAY OPEN when sheet is dismissed.
  // The preview only closes when user explicitly taps empty map background while sheet is in peek/closed state.
  const handleSheetClose = useCallback(() => {
    // Don't clear previewGroup — preview card stays visible
  }, []);

  // Close the GroupPreviewCard (dismiss geo-anchored card)
  const handleClosePreview = useCallback(() => {
    setPreviewGroup(null);
  }, []);

  // GroupPreviewCard: property tap → open side panel
  const handlePreviewPropertyTap = useCallback((property: GroupPreviewProperty) => {
    setSelectedPropertyId(property.id);
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  // GroupPreviewCard: like button
  const handlePreviewLike = useCallback((_property: GroupPreviewProperty) => {
    toggleLike();
  }, [toggleLike]);

  // GroupPreviewCard: comment button
  const handlePreviewComment = useCallback((_property: GroupPreviewProperty) => {
    bottomSheetRef.current?.scrollToComments();
  }, []);

  // GroupPreviewCard: guess button
  const handlePreviewGuess = useCallback((_property: GroupPreviewProperty) => {
    bottomSheetRef.current?.scrollToGuess();
  }, []);

  // GroupPreviewCard: index change (cluster navigation)
  const handlePreviewIndexChange = useCallback((index: number) => {
    setPreviewIndex(index);
    if (previewGroup && previewGroup.properties[index]) {
      setSelectedPropertyId(previewGroup.properties[index].id);
    }
  }, [previewGroup]);

  const handleSave = useCallback((_propertyId?: string) => {
    toggleSave();
  }, [toggleSave]);

  const handleShare = useCallback((_propertyId: string) => {
    // Sharing not yet implemented on web
  }, []);

  const handleLike = useCallback((_propertyId?: string) => {
    toggleLike();
  }, [toggleLike]);

  const handleGuessPress = useCallback((_propertyId: string) => {
    // TODO: Open full guess modal
  }, []);

  const handleCommentPress = useCallback((_propertyId: string) => {
    // TODO: Open comments section
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

  // Search bar callbacks
  const handlePropertyResolved = useCallback((property: PropertyResolveResult) => {
    const map = mapRef.current;
    if (!map) return;

    const { lon, lat } = property.coordinates;
    const coord: [number, number] = [lon, lat];

    map.flyTo({
      center: coord,
      zoom: 17,
      duration: 1000,
    });

    // Set up for single property preview (builds when useProperty data arrives)
    setSelectedPropertyId(property.id);
    pendingSinglePreview.current = true;
    clickCoordRef.current = coord;
    clickActivityRef.current = 0;
  }, []);

  const handleLocationResolved = useCallback((coordinates: { lon: number; lat: number }, _address: string) => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [coordinates.lon, coordinates.lat],
      zoom: 17,
      duration: 1000,
    });
  }, []);

  // Build previewGroup from selectedProperty when single-property click data arrives
  useEffect(() => {
    if (selectedProperty && pendingSinglePreview.current && clickCoordRef.current) {
      const gpp = toGroupPreviewProperty(selectedProperty, clickActivityRef.current);
      setPreviewGroup({ properties: [gpp], coordinate: clickCoordRef.current });
      setPreviewIndex(0);
      pendingSinglePreview.current = false;
    }
  }, [selectedProperty]);

  // Manage selected marker with pulsing animation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing selected marker
    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.remove();
      selectedMarkerRef.current = null;
    }

    // Add new selected marker if we have a coordinate
    if (previewGroup) {
      const markerElement = createSelectedMarkerElement();
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat(previewGroup.coordinate)
        .addTo(map);

      selectedMarkerRef.current = marker;
    }

    return () => {
      if (selectedMarkerRef.current) {
        selectedMarkerRef.current.remove();
        selectedMarkerRef.current = null;
      }
    };
  }, [previewGroup]);

  // Manage the GroupPreviewCard via MapLibre Marker + React Portal
  useEffect(() => {
    const map = mapRef.current;

    // Clean up previous preview marker
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
      previewMarkerRef.current = null;
    }
    setPortalTarget(null);

    if (!map || !previewGroup) return;

    // Calculate anchor direction based on screen position
    const screenPoint = map.project(previewGroup.coordinate);
    const cardHeight = 200;
    const topMargin = 80;
    const shouldShowBelow = screenPoint.y < (cardHeight + topMargin);

    setArrowDirection(shouldShowBelow ? 'up' : 'down');

    // Create container element for the React Portal
    // IMPORTANT: Do NOT apply CSS animations with `transform` on this element.
    // MapLibre Marker positions it via inline `transform: translate(...)`.
    // A CSS animation with `forwards` fill mode would override that transform,
    // breaking geo-anchoring. Animation is applied to inner wrapper instead.
    const container = document.createElement('div');
    container.style.pointerEvents = 'auto';
    container.style.zIndex = '1000';
    container.setAttribute('data-testid', 'group-preview-marker-container');

    // Prevent map interaction when interacting with the preview card
    ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'dblclick'].forEach(evt => {
      container.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Create MapLibre Marker anchored to the coordinate
    const marker = new maplibregl.Marker({
      element: container,
      anchor: shouldShowBelow ? 'top' : 'bottom',
      offset: shouldShowBelow ? [0, 20] : [0, -20],
    })
      .setLngLat(previewGroup.coordinate)
      .addTo(map);

    previewMarkerRef.current = marker;
    setPortalTarget(container);

    return () => {
      marker.remove();
      previewMarkerRef.current = null;
    };
  }, [previewGroup]);

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

        {/* Map Loading Indicator */}
        {!mapLoaded && (
          <View
            className="absolute inset-0 items-center justify-center bg-gray-100"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 10,
              transition: 'opacity 0.3s ease-out',
            } as any}
            testID="map-loading-indicator"
          >
            <View className="items-center">
              <View
                className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full"
                style={{
                  animation: 'spin 1s linear infinite',
                } as any}
              />
              <Text className="text-gray-600 mt-3 text-base">Loading map...</Text>
            </View>
          </View>
        )}

        {/* Search Bar */}
        <SearchBar
          onPropertyResolved={handlePropertyResolved}
          onLocationResolved={handleLocationResolved}
        />

        {/* Zoom level indicator (dev only) */}
        {__DEV__ && (
          <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
            <Text className="text-sm text-gray-700">Zoom: {currentZoom.toFixed(1)}</Text>
          </View>
        )}

        {/* GroupPreviewCard rendered via MapLibre Marker + React Portal (geo-anchored) */}
        {/* Inner div carries the popIn animation so the marker container's transform is free for MapLibre */}
        {portalTarget && previewGroup && createPortal(
          <div style={{ animation: 'popIn 0.3s ease-out forwards' }}>
            <GroupPreviewCard
              properties={previewGroup.properties}
              currentIndex={previewIndex}
              onIndexChange={handlePreviewIndexChange}
              onClose={handleClosePreview}
              onPropertyTap={handlePreviewPropertyTap}
              onLike={handlePreviewLike}
              onComment={handlePreviewComment}
              onGuess={handlePreviewGuess}
              isLiked={isLiked}
              showArrow
              arrowDirection={arrowDirection}
            />
          </div>,
          portalTarget
        )}

      </View>

      {/* Property details side panel (unified PropertyBottomSheet resolves to .web.tsx) */}
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

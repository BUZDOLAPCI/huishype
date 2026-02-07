import { useRef, useCallback, useState, useEffect } from 'react';
import { Text, View } from 'react-native';
import maplibregl from 'maplibre-gl';

import {
  PropertyBottomSheet,
  ClusterPreviewCard,
  AuthModal,
} from '@/src/components';
import type { PropertyBottomSheetRef } from '@/src/components';
import { useProperty, type Property } from '@/src/hooks/useProperties';
import { getPropertyThumbnailFromGeometry } from '@/src/lib/propertyThumbnail';
import { API_URL } from '@/src/utils/api';

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
    .maplibregl-popup-content {
      padding: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    .maplibregl-popup-tip {
      display: none !important;
    }
    /* Preview card popup styles */
    .property-preview-popup {
      z-index: 1000;
    }
    .property-preview-popup .maplibregl-popup-content {
      padding: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      overflow: visible !important;
    }
    .property-preview-card-container {
      position: relative;
      animation: popIn 0.3s ease-out forwards;
    }
    .property-preview-card {
      background: white;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      width: 300px;
      max-width: 85vw;
    }
    .property-preview-arrow {
      position: absolute;
      bottom: -10px;
      left: 50%;
      margin-left: -10px;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid white;
      filter: drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.1));
    }
    .property-preview-arrow-up {
      position: absolute;
      top: -10px;
      left: 50%;
      margin-left: -10px;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-bottom: 10px solid white;
      filter: drop-shadow(0px -2px 4px rgba(0, 0, 0, 0.1));
    }
    .preview-top-row {
      display: flex;
      flex-direction: row;
      margin-bottom: 12px;
      align-items: flex-start;
    }
    .preview-thumbnail {
      width: 64px;
      height: 64px;
      min-width: 64px;
      min-height: 64px;
      margin-right: 12px;
      border-radius: 8px;
      background-color: #E5E7EB;
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .preview-thumbnail img {
      width: 64px;
      height: 64px;
      object-fit: cover;
    }
    .preview-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .preview-header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .preview-address {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .preview-activity {
      display: flex;
      flex-direction: row;
      align-items: center;
      margin-left: 8px;
    }
    .preview-activity-dot {
      width: 8px;
      height: 8px;
      border-radius: 4px;
      margin-right: 4px;
    }
    .preview-activity-dot.hot {
      background-color: #EF4444;
      box-shadow: 0 0 4px rgba(239, 68, 68, 0.8);
    }
    .preview-activity-dot.warm {
      background-color: #FB923C;
    }
    .preview-activity-dot.cold {
      background-color: #D1D5DB;
    }
    .preview-activity-label {
      font-size: 12px;
      color: #9CA3AF;
    }
    .preview-city {
      font-size: 14px;
      color: #6B7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-price-row {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      margin-top: 4px;
    }
    .preview-price {
      font-size: 18px;
      font-weight: 700;
      color: #2563EB;
    }
    .preview-price-label {
      font-size: 12px;
      color: #9CA3AF;
      margin-left: 4px;
    }
    .preview-actions {
      display: flex;
      flex-direction: row;
      justify-content: space-around;
      border-top: 1px solid #F3F4F6;
      padding-top: 8px;
    }
    .preview-action-btn {
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 8px 16px;
      min-height: 44px;
      cursor: pointer;
      background: none;
      border: none;
      font-family: inherit;
    }
    .preview-action-btn:hover {
      background-color: #F9FAFB;
      border-radius: 8px;
    }
    .preview-action-btn svg {
      margin-right: 4px;
    }
    .preview-action-btn span {
      font-size: 14px;
      color: #4B5563;
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

// Get activity level from score
function getActivityLevel(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 50) return 'hot';
  if (score > 0) return 'warm';
  return 'cold';
}

// Activity level labels
function getActivityLabel(level: 'hot' | 'warm' | 'cold'): string {
  const labels = { hot: 'Hot', warm: 'Active', cold: 'Quiet' };
  return labels[level];
}

// Heart icon SVG
const HEART_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

// Comment icon SVG
const COMMENT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

// Price tag icon SVG
const PRICE_TAG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;

// Home icon SVG for placeholder
const HOME_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;

/**
 * Create the preview card popup HTML
 * @param property - Property data to display
 * @param activityScore - Activity score for the property
 * @param arrowPointsUp - If true, arrow points up (card is below marker); if false, arrow points down (card is above marker)
 */
function createPreviewCardHTML(
  property: {
    id: string;
    address: string;
    city: string;
    postalCode?: string | null;
    wozValue?: number | null;
    thumbnailUrl?: string | null;
  },
  activityScore: number,
  arrowPointsUp: boolean = false
): string {
  const activityLevel = getActivityLevel(activityScore);
  const activityLabel = getActivityLabel(activityLevel);
  const displayPrice = property.wozValue;

  const thumbnailHtml = property.thumbnailUrl
    ? `<img src="${property.thumbnailUrl}" alt="Property thumbnail" />`
    : HOME_ICON;

  const priceHtml = displayPrice !== undefined && displayPrice !== null
    ? `<div class="preview-price-row">
        <span class="preview-price">\u20AC${displayPrice.toLocaleString('nl-NL')}</span>
        <span class="preview-price-label">WOZ</span>
      </div>`
    : '';

  // Arrow pointing up (card below marker) or down (card above marker)
  const arrowClass = arrowPointsUp ? 'property-preview-arrow-up' : 'property-preview-arrow';
  const arrowHtml = `<div class="${arrowClass}" data-testid="property-preview-arrow"></div>`;

  // If arrow points up, put it before the card; otherwise after
  const cardHtml = `
    <div class="property-preview-card" data-testid="property-preview-card">
      <div class="preview-top-row">
        <div class="preview-thumbnail" data-testid="property-thumbnail-container">
          ${thumbnailHtml}
        </div>
        <div class="preview-info">
          <div class="preview-header">
            <span class="preview-address">${property.address}</span>
            <div class="preview-activity">
              <div class="preview-activity-dot ${activityLevel}"></div>
              <span class="preview-activity-label">${activityLabel}</span>
            </div>
          </div>
          <span class="preview-city">${property.city}${property.postalCode ? `, ${property.postalCode}` : ''}</span>
          ${priceHtml}
        </div>
      </div>
      <div class="preview-actions">
        <button class="preview-action-btn" data-action="like">
          ${HEART_ICON}
          <span>Like</span>
        </button>
        <button class="preview-action-btn" data-action="comment">
          ${COMMENT_ICON}
          <span>Comment</span>
        </button>
        <button class="preview-action-btn" data-action="guess">
          ${PRICE_TAG_ICON}
          <span>Guess</span>
        </button>
      </div>
    </div>
  `;

  return `
    <div class="property-preview-card-container" data-testid="property-preview-popup">
      ${arrowPointsUp ? arrowHtml : ''}
      ${cardHtml}
      ${arrowPointsUp ? '' : arrowHtml}
    </div>
  `;
}

export default function MapScreen() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const bottomSheetRef = useRef<PropertyBottomSheetRef>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);

  // Gesture tracking refs to prevent preview card from closing during map gestures
  const isDragging = useRef(false);
  const isZooming = useRef(false);
  const isRotating = useRef(false);

  // Selected property coordinate for positioning the preview card
  const [selectedCoordinate, setSelectedCoordinate] = useState<[number, number] | null>(null);

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

  // Track bottom sheet index for preview card persistence logic
  // -1 = closed, 0 = peek, 1 = partial, 2 = full
  const sheetIndexRef = useRef<number>(-1);

  // Fetch selected property details
  const { data: selectedProperty, isLoading: propertyLoading } =
    useProperty(selectedPropertyId);

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
            // Get the coordinate from the feature geometry
            const geom = feature.geometry;
            if (geom.type === 'Point') {
              const coord = geom.coordinates as [number, number];
              setSelectedCoordinate(coord);
            }

            setSelectedPropertyId(propertyId);
            setSelectedActivityScore(activityScore);
            setSelectedHasListing(hasListing);
            setShowPreview(true);
            setIsClusterPreview(false);
          }
        }
      };

      // Handle map click to close preview - only on true background taps
      // CRITICAL: Preview card should only close when:
      // 1. User taps on empty map background AND
      // 2. Bottom sheet is NOT expanded (i.e., in peek state index 0 or closed index -1)
      map.on('click', (e) => {
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
            setShowPreview(false);
            setIsClusterPreview(false);
          }
          // If sheet is expanded (1 or 2), the backdrop click will close the sheet
          // but we DON'T close the preview card - it should persist
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
  // CRITICAL: Per expectation 0023, preview card should STAY OPEN when sheet is dismissed
  // The preview only closes when user explicitly taps empty map background while sheet is in peek/closed state
  // Dismissing the sheet via backdrop should NOT close the preview
  const handleSheetClose = useCallback(() => {
    // This is called from PropertyBottomSheet onChange when index === -1
    // Sheet has been dismissed (e.g., via backdrop tap or swipe down)
    // BUT we do NOT close the preview card here - user intention is to "return to map view"
    // not to deselect the property. Preview card remains visible showing the selected property.
    // The preview will only close when user taps on empty map background (handled in map click handler)

    // We also don't clear selectedPropertyId here - the property remains selected
    // Only close cluster preview since that doesn't have the same persistence rules
    setIsClusterPreview(false);
    // Don't clear selectedCoordinate - we want the marker/popup to stay visible
    // setSelectedPropertyId(null);  // DON'T do this
    // setShowPreview(false);        // DON'T do this
    // setSelectedCoordinate(null);  // DON'T do this
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
    // Snap to partial (index 1 = 50%) when selecting from cluster
    bottomSheetRef.current?.snapToIndex(1);
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
    if (selectedCoordinate && showPreview) {
      const markerElement = createSelectedMarkerElement();
      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat(selectedCoordinate)
        .addTo(map);

      selectedMarkerRef.current = marker;
    }

    return () => {
      if (selectedMarkerRef.current) {
        selectedMarkerRef.current.remove();
        selectedMarkerRef.current = null;
      }
    };
  }, [selectedCoordinate, showPreview]);

  // Manage the preview card popup using MapLibre's Popup class for proper geo-anchoring
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing popup
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    // Create new popup if we have a coordinate and property data
    if (selectedCoordinate && showPreview && selectedProperty && !isClusterPreview) {
      // Calculate screen position to determine if popup should be above or below
      const screenPoint = map.project(selectedCoordinate);
      const containerHeight = map.getContainer().clientHeight;
      const cardHeight = 180; // Approximate card height including arrow
      const topMargin = 80; // Header area + margin

      // If marker is in top portion of screen, show popup below; otherwise above
      const shouldShowBelow = screenPoint.y < (cardHeight + topMargin);
      const anchor = shouldShowBelow ? 'top' : 'bottom';

      const popupHTML = createPreviewCardHTML(
        {
          id: selectedProperty.id,
          address: selectedProperty.address,
          city: selectedProperty.city,
          postalCode: selectedProperty.postalCode,
          wozValue: selectedProperty.wozValue,
          thumbnailUrl: getPropertyThumbnailFromGeometry(selectedProperty.geometry),
        },
        selectedActivityScore,
        shouldShowBelow // Pass flag to flip arrow direction
      );

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        anchor: anchor,
        offset: shouldShowBelow ? [0, 20] : [0, -20], // Offset from the marker
        className: 'property-preview-popup',
        maxWidth: 'none',
      })
        .setLngLat(selectedCoordinate)
        .setHTML(popupHTML)
        .addTo(map);

      // Add event listeners for the popup buttons
      const popupElement = popup.getElement();
      if (popupElement) {
        // Handle card body click (opens bottom sheet)
        // CRITICAL: Preview card should STAY OPEN when clicked - only expand the sheet
        const cardElement = popupElement.querySelector('.property-preview-card');
        if (cardElement) {
          cardElement.addEventListener('click', (e) => {
            // Don't trigger if clicking on a button
            if ((e.target as HTMLElement).closest('.preview-action-btn')) return;
            // Do NOT close preview - just expand the bottom sheet
            // Preview card persists until user explicitly dismisses it
            bottomSheetRef.current?.snapToIndex(1);
          });
        }

        // Handle action buttons
        const likeBtn = popupElement.querySelector('[data-action="like"]');
        const commentBtn = popupElement.querySelector('[data-action="comment"]');
        const guessBtn = popupElement.querySelector('[data-action="guess"]');

        if (likeBtn) {
          likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Like property:', selectedProperty.id);
          });
        }
        if (commentBtn) {
          commentBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Preview card stays open - user can still see the property while commenting
            bottomSheetRef.current?.scrollToComments();
          });
        }
        if (guessBtn) {
          guessBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Preview card stays open - user can still see the property while guessing
            bottomSheetRef.current?.scrollToGuess();
          });
        }
      }

      popupRef.current = popup;
    }

    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [selectedCoordinate, showPreview, selectedProperty, isClusterPreview, selectedActivityScore]);

  // Clear selected coordinate when preview is hidden
  useEffect(() => {
    if (!showPreview) {
      setSelectedCoordinate(null);
      // Also remove popup
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    }
  }, [showPreview]);

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
            }}
            testID="map-loading-indicator"
          >
            <View className="items-center">
              <View
                className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full"
                style={{
                  animation: 'spin 1s linear infinite',
                }}
              />
              <Text className="text-gray-600 mt-3 text-base">Loading map...</Text>
            </View>
          </View>
        )}

        {/* Zoom level indicator */}
        <View className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-full shadow-md">
          <Text className="text-sm text-gray-700">Zoom: {currentZoom.toFixed(1)}</Text>
        </View>

        {/* Property Preview Card is rendered as a MapLibre popup in the useEffect above */}
        {/* The popup is geo-anchored and floats above the selected property marker */}

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
        onSheetChange={handleSheetIndexChange}
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

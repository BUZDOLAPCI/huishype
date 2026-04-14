import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as maplibregl from 'maplibre-gl';

import { SearchBar, PropertyBottomSheet } from '@/src/components';
import { MapGradient } from '@/src/components/navigation/MapGradient';
import { MapHeaderRow } from '@/src/components/navigation/MapHeaderRow';
import { LocationButton } from '@/src/components/navigation/LocationButton';
import { WebPreviewMarkerPortal } from '@/src/components/WebPreviewMarkerPortal';
import { useMapCityName } from '@/src/hooks/useMapCityName';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import {
  DEFAULT_CENTER,
  DEFAULT_BEARING,
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  DEBUG_CAMERA,
} from '@/src/lib/mapDefaults';
import { getPitchForZoom } from '@/src/lib/mapPitch';
import { buildPropertyRoute } from '@/src/utils/property-route';
import { API_URL } from '@/src/utils/api';
import type { ResolvedAddress } from '@/src/services/address-resolver';
import { useMapInteraction, type MapCameraCommands } from '@/src/hooks/useMapInteraction';
import { Pressable, StyleSheet, Text, View } from '../dom';
import { colors } from '../theme';

const STYLE_URL = `${API_URL}/tiles/style.json`;
const INTERACTIVE_LAYER_IDS = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'] as const;
const SELECTED_MARKER_STYLE_ID = 'selected-map-marker-styles';

if (typeof document !== 'undefined' && !document.getElementById(SELECTED_MARKER_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = SELECTED_MARKER_STYLE_ID;
  style.textContent = `
    @keyframes selected-marker-pulse {
      0% {
        transform: translate(-50%, -50%) scale(0.45);
        opacity: 0.7;
      }
      70% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0;
      }
      100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

export function MapRoute() {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [cityFallback, setCityFallback] = useState<string | null>('Eindhoven');
  const currentZoomRef = useRef(DEFAULT_ZOOM);

  const interaction = useMapInteraction();
  const {
    previewGroup,
    highlightedCoordinate,
    currentPreviewIndex,
    handlePreviewPropertyTap,
    handleClosePreview,
    isLiked,
    handleFeaturePress,
    handleEmptyMapTap,
  } = interaction;

  const { cityName, setSearchCity, onViewportCenterChanged } = useMapCityName();
  const displayCity = cityName ?? cityFallback;

  const camera: MapCameraCommands = useMemo(() => ({
    flyTo: ({ center, zoom, duration }) => {
      mapRef.current?.flyTo({
        center,
        zoom,
        duration,
        essential: true,
      });
    },
    fitBounds: (bounds, opts) => {
      mapRef.current?.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: opts.padding, duration: opts.duration, maxZoom: 18 },
      );
    },
    estimateZoomForBounds: () => null,
  }), []);

  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (selectedMarkerRef.current) {
      selectedMarkerRef.current.remove();
      selectedMarkerRef.current = null;
    }

    if (!mapLoaded || !mapRef.current || !highlightedCoordinate) {
      return;
    }

    const markerElement = document.createElement('div');
    markerElement.setAttribute('data-testid', 'selected-marker');
    markerElement.style.position = 'relative';
    markerElement.style.width = '44px';
    markerElement.style.height = '44px';
    markerElement.style.pointerEvents = 'none';
    markerElement.style.display = 'flex';
    markerElement.style.alignItems = 'center';
    markerElement.style.justifyContent = 'center';

    const pulse = document.createElement('div');
    pulse.className = 'selected-marker-pulse';
    pulse.style.position = 'absolute';
    pulse.style.left = '50%';
    pulse.style.top = '50%';
    pulse.style.width = '44px';
    pulse.style.height = '44px';
    pulse.style.borderRadius = '999px';
    pulse.style.background = 'rgba(245, 166, 35, 0.18)';
    pulse.style.border = '2px solid rgba(245, 166, 35, 0.44)';
    pulse.style.animation = 'selected-marker-pulse 1.8s ease-out infinite';
    pulse.style.transformOrigin = 'center center';

    const dot = document.createElement('div');
    dot.className = 'selected-marker-dot';
    dot.style.position = 'absolute';
    dot.style.left = '50%';
    dot.style.top = '50%';
    dot.style.width = '14px';
    dot.style.height = '14px';
    dot.style.borderRadius = '999px';
    dot.style.background = '#F5A623';
    dot.style.border = '2px solid #FFFFFF';
    dot.style.boxShadow = '0 4px 10px rgba(245, 166, 35, 0.28)';
    dot.style.transform = 'translate(-50%, -50%)';

    markerElement.appendChild(pulse);
    markerElement.appendChild(dot);

    const marker = new maplibregl.Marker({
      element: markerElement,
      anchor: 'center',
    })
      .setLngLat(highlightedCoordinate)
      .addTo(mapRef.current);

    selectedMarkerRef.current = marker;

    return () => {
      marker.remove();
      if (selectedMarkerRef.current === marker) {
        selectedMarkerRef.current = null;
      }
    };
  }, [highlightedCoordinate, mapLoaded]);

  const handlePropertyResolved = useCallback(
    (property: any, resolvedAddress?: ResolvedAddress) => {
      if (resolvedAddress?.details.city) {
        setSearchCity(resolvedAddress.details.city, [resolvedAddress.lon, resolvedAddress.lat]);
        setCityFallback(resolvedAddress.details.city);
      }
      navigate(buildPropertyRoute(property.id, '/feed'));
    },
    [navigate, setSearchCity],
  );

  const handleLocationResolved = useCallback(
    (coordinates: { lon: number; lat: number }, address: string, resolvedAddress?: ResolvedAddress) => {
      const city = resolvedAddress?.details.city ?? null;
      if (city) {
        setSearchCity(city, [coordinates.lon, coordinates.lat]);
        setCityFallback(city);
      }
      mapRef.current?.flyTo({
        center: [coordinates.lon, coordinates.lat],
        zoom: Math.max(currentZoomRef.current, 15),
        duration: 900,
        essential: true,
      });
      if (!city) {
        setCityFallback(address);
      }
    },
    [setSearchCity],
  );

  const handleCurrentLocationPress = useCallback(async () => {
    try {
      const { longitude, latitude } = await getCurrentLocation();
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: Math.max(currentZoomRef.current, 16),
        duration: 800,
        essential: true,
      });
    } catch (error) {
      console.warn('[MapRoute] Current location failed:', error);
    }
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    let cancelled = false;

    async function initMap() {
      let style: maplibregl.StyleSpecification | string = STYLE_URL;
      try {
        const response = await fetch(STYLE_URL);
        style = await response.json();
      } catch {
        style = STYLE_URL;
      }

      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        maxPitch: 70,
        touchPitch: false,
        pitchWithRotate: false,
        transformCameraUpdate: ({ zoom }) => ({
          pitch: getPitchForZoom(Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM),
        }),
      });

      mapRef.current = map;
      const mapWindow = window as Window & { __mapInstance?: maplibregl.Map };
      mapWindow.__mapInstance = map;

      map.on('load', () => {
        if (cancelled) return;
        setMapLoaded(true);
      });

      map.on('move', () => {
        const center = map.getCenter();
        currentZoomRef.current = map.getZoom();
        onViewportCenterChanged(center.lng, center.lat, map.getZoom());
      });

      map.on('zoom', () => {
        currentZoomRef.current = map.getZoom();
      });

      map.on('error', (event) => {
        console.warn('[MapRoute] MapLibre error:', event.error);
      });

      map.on('click', async (event) => {
        const interactiveLayerIds = INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
        const renderedFeatures = interactiveLayerIds.length > 0
          ? (map.queryRenderedFeatures(event.point, { layers: interactiveLayerIds }) as GeoJSON.Feature[])
          : [];

        const handled = await handleFeaturePress(renderedFeatures, map.getZoom(), camera);
        if (!handled) {
          handleEmptyMapTap();
        }
      });
    }

    void initMap();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      delete (window as Window & { __mapInstance?: maplibregl.Map }).__mapInstance;
      setMapLoaded(false);
    };
  }, [camera, handleEmptyMapTap, handleFeaturePress, onViewportCenterChanged]);

  useEffect(() => {
    return () => {
      setSearchResetToken((value) => value + 1);
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View ref={mapContainerRef as any} style={styles.mapContainer} testID="map-view" />
      <MapGradient position="top" />
      <MapGradient position="bottom" />

      <MapHeaderRow cityName={displayCity ?? undefined} />

      <View style={styles.searchWrap}>
        <SearchBar
          onPropertyResolved={handlePropertyResolved}
          onLocationResolved={handleLocationResolved}
          transientResetKey={searchResetToken}
        />
      </View>

      <View style={styles.locationWrap}>
        <LocationButton onPress={handleCurrentLocationPress} />
      </View>

      <View style={styles.statusPill}>
        <Text style={styles.statusText}>{DEBUG_CAMERA ? 'Debug camera enabled' : mapLoaded ? 'Map loaded' : 'Loading map...'}</Text>
      </View>

      {previewGroup ? (
        <WebPreviewMarkerPortal
          map={mapRef.current}
          previewGroup={previewGroup}
          currentIndex={currentPreviewIndex}
          markerOffsetPx={46}
          onIndexChange={(index) => interaction.setCurrentPreviewIndex(index)}
          onClose={handleClosePreview}
          onPropertyTap={handlePreviewPropertyTap}
          onLike={interaction.handleLike}
          onComment={interaction.handleComment}
          onGuess={interaction.handleGuess}
          isLiked={isLiked}
        />
      ) : null}

      <PropertyBottomSheet
        ref={interaction.bottomSheetRef}
        property={interaction.selectedPropertyForSheet ?? null}
        isPreviewCardVisible={!!previewGroup}
        onClose={interaction.handleSheetClose}
        onSheetChange={interaction.handleSheetIndexChange}
        onLike={interaction.handleLike}
        onSave={interaction.handleSave}
        onShare={interaction.handleShare}
        onGuessPress={interaction.handleGuessPress}
        onCommentPress={interaction.handleCommentPress}
        onAuthRequired={interaction.handleAuthRequired}
      />

      <Pressable
        style={styles.footnote}
        onPress={() => navigate('/feed')}
      >
        <Text style={styles.footnoteText}>Open the feed</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mapContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  searchWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 72,
    zIndex: 12,
  },
  locationWrap: {
    position: 'absolute',
    right: 16,
    bottom: 156,
    zIndex: 12,
  },
  statusPill: {
    position: 'absolute',
    left: 16,
    bottom: 156,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 12,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  footnote: {
    position: 'absolute',
    left: 16,
    right: 72,
    bottom: 18,
    zIndex: 12,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  footnoteText: {
    color: colors.text,
    fontWeight: '600',
  },
});

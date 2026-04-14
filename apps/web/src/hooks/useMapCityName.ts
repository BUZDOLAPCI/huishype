/**
 * useMapCityName — Derives a zoom-aware location label for the map header.
 *
 * Priority:
 * 1. Search context — if the user searched and navigated to a location, keep the
 *    searched city sticky while the camera remains nearby.
 * 2. Reverse geocode — debounced (500ms after last viewport change) reverse
 *    geocode of the viewport center via `GET /geocode/reverse`.
 * 3. Fallback — null (header hides the location label).
 *
 * The returned label adapts to zoom level so the header reflects the scale of
 * what the user is looking at: country -> region -> city -> district -> locality.
 * Each tier resolves to a single label rather than a breadcrumb-like hierarchy.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { apiGeocoder, type ReverseGeocodeResult } from '@/src/services/api-geocoder';

/**
 * Extract city name from a formatted geocoder address string.
 * Addresses are formatted as "Street Number, PostalCode City" or "Name, City".
 * Returns the city portion or null.
 *
 * Handles European postal code formats:
 *   NL: "5641 HN" (digits + space + letters)
 *   FR: "75001" (5 digits)
 *   DE: "10115" (5 digits)
 *   SE: "211 22" (3 digits + space + 2 digits)
 *   PL: "90-001" (digits + hyphen + digits)
 *   CH: "8001" (4 digits)
 *
 * Uses Unicode-aware matching so city names with non-ASCII capitals
 * (München, Zürich, Malmö, Łódź, etc.) are handled correctly.
 */
export function extractCityFromAddress(address: string): string | null {
  const parts = address.split(',').map(p => p.trim());
  if (parts.length < 2) return null;
  const lastPart = parts[parts.length - 1];
  const stripped = lastPart.replace(
    /^(?:\d[\d\w\s-]*|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s+(?=\p{L})/iu,
    '',
  ).trim();
  return stripped || lastPart;
}

/** How long to wait after the last viewport change before reverse geocoding. */
const REVERSE_GEOCODE_DEBOUNCE_MS = 500;

/**
 * If the viewport center moves more than this many degrees from the search
 * location, the sticky search label is cleared.
 * ~0.05 degrees ≈ 5.5 km at European latitudes.
 */
const SEARCH_CITY_CLEAR_THRESHOLD_DEG = 0.05;

/** Skip reverse geocoding if the center barely moved. ~0.005 degrees ≈ 500m. */
const REVERSE_GEOCODE_MIN_MOVE_DEG = 0.005;

/** Zoom thresholds for the header label hierarchy. */
const COUNTRY_LABEL_MAX_ZOOM = 6;
const REGION_LABEL_MAX_ZOOM = 8.5;
const CITY_LABEL_MAX_ZOOM = 13;
const DISTRICT_LABEL_MAX_ZOOM = 15.5;
const DEFAULT_HEADER_ZOOM = 12;

function normalizeLabelPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getMapHeaderLocationLabel(
  location: ReverseGeocodeResult | null,
  zoom: number | null | undefined,
  searchCity?: string | null,
): string | null {
  const effectiveZoom = zoom ?? DEFAULT_HEADER_ZOOM;
  const city = normalizeLabelPart(searchCity) ?? normalizeLabelPart(location?.city);
  const county = normalizeLabelPart(location?.county);
  const district = normalizeLabelPart(location?.district);
  const locality = normalizeLabelPart(location?.locality);
  const state = normalizeLabelPart(location?.state);
  const country = normalizeLabelPart(location?.country);

  if (effectiveZoom < COUNTRY_LABEL_MAX_ZOOM) {
    return country ?? state ?? city ?? county ?? district ?? locality ?? null;
  }

  if (effectiveZoom < REGION_LABEL_MAX_ZOOM) {
    return state ?? county ?? city ?? country ?? district ?? locality ?? null;
  }

  if (effectiveZoom < CITY_LABEL_MAX_ZOOM) {
    return city ?? county ?? state ?? country ?? district ?? locality ?? null;
  }

  if (effectiveZoom < DISTRICT_LABEL_MAX_ZOOM) {
    return district ?? county ?? city ?? state ?? country ?? locality ?? null;
  }

  return locality ?? district ?? county ?? city ?? state ?? country ?? null;
}

export interface UseMapCityNameReturn {
  /** The current zoom-aware location label to display, or null if unknown. */
  cityName: string | null;
  /** Call when the user searches and navigates to a location. */
  setSearchCity: (city: string, coordinate: [number, number]) => void;
  /** Call when the map viewport center or zoom changes. */
  onViewportCenterChanged: (lon: number, lat: number, zoom?: number) => void;
}

export function useMapCityName(): UseMapCityNameReturn {
  const [searchCity, setSearchCityState] = useState<string | null>(null);
  const searchCoordRef = useRef<[number, number] | null>(null);

  const [reverseLocation, setReverseLocation] = useState<ReverseGeocodeResult | null>(null);
  const [viewportZoom, setViewportZoom] = useState<number>(DEFAULT_HEADER_ZOOM);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReversedRef = useRef<{ lon: number; lat: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const setSearchCity = useCallback(
    (city: string, coordinate: [number, number]) => {
      setSearchCityState(city);
      searchCoordRef.current = coordinate;
    },
    [],
  );

  const onViewportCenterChanged = useCallback(
    (lon: number, lat: number, zoom?: number) => {
      if (zoom !== undefined && Number.isFinite(zoom)) {
        setViewportZoom(prev => (Math.abs(prev - zoom) < 0.05 ? prev : zoom));
      }

      if (searchCoordRef.current) {
        const [searchLon, searchLat] = searchCoordRef.current;
        const dLon = Math.abs(lon - searchLon);
        const dLat = Math.abs(lat - searchLat);
        if (
          dLon > SEARCH_CITY_CLEAR_THRESHOLD_DEG ||
          dLat > SEARCH_CITY_CLEAR_THRESHOLD_DEG
        ) {
          setSearchCityState(null);
          searchCoordRef.current = null;
        }
      }

      if (lastReversedRef.current) {
        const dLon = Math.abs(lon - lastReversedRef.current.lon);
        const dLat = Math.abs(lat - lastReversedRef.current.lat);
        if (dLon < REVERSE_GEOCODE_MIN_MOVE_DEG && dLat < REVERSE_GEOCODE_MIN_MOVE_DEG) {
          return;
        }
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        if (abortRef.current) {
          abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const requestSeq = ++requestSeqRef.current;

        try {
          const result = await apiGeocoder.reverse(lon, lat, {
            signal: controller.signal,
          });

          if (
            controller.signal.aborted ||
            requestSeq !== requestSeqRef.current
          ) {
            return;
          }

          setReverseLocation(result);
          if (result) {
            lastReversedRef.current = { lon, lat };
          }
        } catch {
          // Silently fail — keep showing the last known label.
        }
      }, REVERSE_GEOCODE_DEBOUNCE_MS);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const cityName = getMapHeaderLocationLabel(reverseLocation, viewportZoom, searchCity);

  return {
    cityName,
    setSearchCity,
    onViewportCenterChanged,
  };
}

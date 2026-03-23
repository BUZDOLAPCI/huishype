/**
 * useMapCityName — Derives a dynamic city name for the map header.
 *
 * Priority:
 * 1. Search context — if the user searched and navigated to a location, show
 *    the city from the search result (sticky until the map moves significantly).
 * 2. Reverse geocode — debounced (500ms after last viewport change) reverse
 *    geocode of the viewport center via `GET /geocode/reverse`.
 * 3. Fallback — null (header hides the city label).
 *
 * The hook tracks the viewport center and debounces reverse geocode calls
 * to avoid hammering the backend during pan/zoom gestures.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { apiGeocoder } from '@/src/services/api-geocoder';

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
  // Strip a leading postal code: starts with a digit, followed by any combination
  // of digits, letters, hyphens, and spaces that form the postal code, then a
  // space before the city name (which starts with a Unicode letter).
  // The greedy quantifier in the postal code portion ensures we consume the
  // entire postal code (e.g. "5641 HN " not just "5641 ").
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
 * location, the search city name is cleared (user has panned away).
 * ~0.05 degrees ≈ 5.5 km at European latitudes.
 */
const SEARCH_CITY_CLEAR_THRESHOLD_DEG = 0.05;

export interface UseMapCityNameReturn {
  /** The current city name to display, or null if unknown. */
  cityName: string | null;
  /** Call when the user searches and navigates to a location. */
  setSearchCity: (city: string, coordinate: [number, number]) => void;
  /** Call when the map viewport center changes. */
  onViewportCenterChanged: (lon: number, lat: number) => void;
}

export function useMapCityName(): UseMapCityNameReturn {
  // City name from search (highest priority while nearby)
  const [searchCity, setSearchCityState] = useState<string | null>(null);
  const searchCoordRef = useRef<[number, number] | null>(null);

  // City name from reverse geocoding
  const [reverseCity, setReverseCity] = useState<string | null>(null);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track last reverse-geocoded center to avoid redundant calls
  const lastReversedRef = useRef<{ lon: number; lat: number } | null>(null);

  // Abort controller for in-flight reverse geocode requests
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
    (lon: number, lat: number) => {
      // Check if the search city should be cleared (user panned away)
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

      // Skip if center hasn't moved significantly from last reverse geocode
      // (~0.005 degrees ≈ ~500m, avoids redundant calls on tiny viewport shifts)
      if (lastReversedRef.current) {
        const dLon = Math.abs(lon - lastReversedRef.current.lon);
        const dLat = Math.abs(lat - lastReversedRef.current.lat);
        if (dLon < 0.005 && dLat < 0.005) {
          return;
        }
      }

      // Debounce the reverse geocode call
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        // Cancel any in-flight request
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

          if (result?.city) {
            setReverseCity(result.city);
            lastReversedRef.current = { lon, lat };
          } else {
            setReverseCity(null);
          }
        } catch {
          // Silently fail — keep showing the last known city
        }
      }, REVERSE_GEOCODE_DEBOUNCE_MS);
    },
    [],
  );

  // Cleanup on unmount
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

  // Search city takes priority over reverse-geocoded city
  const cityName = searchCity ?? reverseCity;

  return {
    cityName,
    setSearchCity,
    onViewportCenterChanged,
  };
}

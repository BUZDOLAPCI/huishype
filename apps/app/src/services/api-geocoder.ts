/**
 * ApiGeocoder — Calls the backend /geocode/search proxy.
 *
 * The backend proxies to Photon and reformats the response.
 * This keeps Photon behind the API (not publicly exposed) and
 * works on native where only port 3100 is reachable.
 */

import { API_URL } from '../utils/api';
import type { IGeocoder, GeocodeSearchOptions, GeocodeSuggestion } from './geocoder';

/** Reverse geocode result — city/town name for the map header. */
export interface ReverseGeocodeResult {
  locality: string | null;
  district: string | null;
  county: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
}

export class ApiGeocoder implements IGeocoder {
  async search(
    query: string,
    options?: GeocodeSearchOptions,
  ): Promise<GeocodeSuggestion[]> {
    if (!query || query.length < 2) return [];

    const params = new URLSearchParams({ q: query });
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.countryCode) params.set('countrycode', options.countryCode);
    if (options?.countryMode) params.set('countrymode', options.countryMode);
    if (options?.lon !== undefined) params.set('lon', String(options.lon));
    if (options?.lat !== undefined) params.set('lat', String(options.lat));

    try {
      const response = await fetch(
        `${API_URL}/geocode/search?${params.toString()}`,
      );

      if (!response.ok) return [];

      const data: GeocodeSuggestion[] = await response.json();
      return data;
    } catch {
      return [];
    }
  }

  /**
   * Reverse geocode a coordinate to get the city/town name.
   * Returns null if geocoding fails or no result found.
   */
  async reverse(
    lon: number,
    lat: number,
    options?: { lang?: string; signal?: AbortSignal },
  ): Promise<ReverseGeocodeResult | null> {
    const params = new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
    });
    if (options?.lang) params.set('lang', options.lang);

    try {
      const response = await fetch(
        `${API_URL}/geocode/reverse?${params.toString()}`,
        { signal: options?.signal },
      );

      if (!response.ok) return null;

      const data: ReverseGeocodeResult | null = await response.json();
      return data;
    } catch {
      return null;
    }
  }
}

/** Singleton instance for app-wide use */
export const apiGeocoder = new ApiGeocoder();

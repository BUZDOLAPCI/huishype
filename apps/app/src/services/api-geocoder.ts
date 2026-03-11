/**
 * ApiGeocoder — Calls the backend /geocode/search proxy.
 *
 * The backend proxies to Photon and reformats the response.
 * This keeps Photon behind the API (not publicly exposed) and
 * works on native where only port 3100 is reachable.
 */

import { API_URL } from '../utils/api';
import type { IGeocoder, GeocodeSuggestion } from './geocoder';

export class ApiGeocoder implements IGeocoder {
  async search(
    query: string,
    options?: { limit?: number; countryCode?: string },
  ): Promise<GeocodeSuggestion[]> {
    if (!query || query.length < 2) return [];

    const params = new URLSearchParams({ q: query });
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.countryCode) params.set('countrycode', options.countryCode);

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
}

/** Singleton instance for app-wide use */
export const apiGeocoder = new ApiGeocoder();

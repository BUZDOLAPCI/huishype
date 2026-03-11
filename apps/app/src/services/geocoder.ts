/**
 * Geocoder adapter interface.
 *
 * Abstracts the underlying geocoding provider (Photon, etc.)
 * so the app can switch providers without changing callers.
 */

import type { GeocodeSuggestion } from '@huishype/shared';

export type { GeocodeSuggestion };

export interface IGeocoder {
  search(query: string, options?: { limit?: number; countryCode?: string }): Promise<GeocodeSuggestion[]>;
}

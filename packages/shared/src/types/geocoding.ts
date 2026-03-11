/**
 * Geocoding-related types for HuisHype
 * Used by the backend geocode proxy, frontend geocoder adapter, and mocks.
 */

/**
 * Geocode suggestion returned by the geocoding backend.
 * Reformatted from Photon's GeoJSON response into a provider-agnostic shape.
 */
export interface GeocodeSuggestion {
  id: string;
  displayName: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  region?: string;
  countryCode?: string;
  coordinates: [number, number]; // [lng, lat]
}

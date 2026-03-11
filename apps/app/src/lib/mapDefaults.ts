import { getCountryConfig, type CountryCode, isValidCountryCode } from '@huishype/shared/config';

// Debug camera: set to true to start zoomed into Beeldbuisring 41 for shader/building debugging
export const DEBUG_CAMERA = __DEV__ && false;

// Default production camera values (from country config)
const PRODUCTION_PITCH = 50;
const PRODUCTION_BEARING = 0;

// Debug camera (Beeldbuisring 41 close-up for shader/building iteration)
const DEBUG_CENTER: [number, number] = [5.4780, 51.4395];
const DEBUG_ZOOM = 18;
const DEBUG_PITCH = 55;
const DEBUG_BEARING = -20;

/** Get default map center for a country. Falls back to NL. */
export function getDefaultCenter(countryCode?: string): [number, number] {
  if (DEBUG_CAMERA) return DEBUG_CENTER;
  const code = countryCode && isValidCountryCode(countryCode) ? countryCode : 'NL';
  return getCountryConfig(code).defaultCenter;
}

/** Get default map zoom for a country. Falls back to NL. */
export function getDefaultZoom(countryCode?: string): number {
  if (DEBUG_CAMERA) return DEBUG_ZOOM;
  const code = countryCode && isValidCountryCode(countryCode) ? countryCode : 'NL';
  return getCountryConfig(code).defaultZoom;
}

// Backward-compatible constants (default to NL)
export const DEFAULT_CENTER: [number, number] = DEBUG_CAMERA ? DEBUG_CENTER : getCountryConfig('NL').defaultCenter;
export const DEFAULT_ZOOM = DEBUG_CAMERA ? DEBUG_ZOOM : getCountryConfig('NL').defaultZoom;
export const DEFAULT_PITCH = DEBUG_CAMERA ? DEBUG_PITCH : PRODUCTION_PITCH;
export const DEFAULT_BEARING = DEBUG_CAMERA ? DEBUG_BEARING : PRODUCTION_BEARING;

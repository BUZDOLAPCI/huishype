import { getCountryConfig, isValidCountryCode } from '@huishype/shared/config';

const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

// Debug camera: set to true to start zoomed into Beeldbuisring 41 for shader/building debugging
export const DEBUG_CAMERA = IS_DEV && false;

// Default production camera values (from country config)
const PRODUCTION_PITCH = 50;
const PRODUCTION_BEARING = 0;

// ── Debug camera locations ──────────────────────────────────────────
// Switch DEBUG_LOCATION below to jump to a different spot on launch.
const DEBUG_LOCATIONS = {
  /** Beeldbuisring 41, Eindhoven — dense row-houses, shader/building iteration */
  beeldbuisring: { center: [5.44566, 51.45230] as [number, number], zoom: 20.1 },
  /** Fosforstraat, Eindhoven — 3 story single wide apartment building, shader/building iteration */
  fosforstraat: { center: [5.44866, 51.4501] as [number, number], zoom: 18.5 },
  /** Amsterdam canal ring — tall narrow buildings, mixed heights */
  amsterdam: { center: [4.8897, 52.3703] as [number, number], zoom: 17 },
  /** Rotterdam Erasmusbrug — modern high-rises + waterfront */
  rotterdam: { center: [4.4869, 51.9094] as [number, number], zoom: 16.5 },
  /** Paris Haussmann — uniform 6-story blocks, tree-lined boulevards */
  paris: { center: [2.3364, 48.8708] as [number, number], zoom: 17 },
  /** Berlin Mitte — mixed Soviet + modern blocks */
  berlin: { center: [13.3889, 52.5170] as [number, number], zoom: 16.5 },
  /** Brussels Grand Place — dense medieval core */
  brussels: { center: [4.3517, 50.8467] as [number, number], zoom: 17 },
  /** London City — skyscrapers next to low-rise */
  london: { center: [-0.0833, 51.5134] as [number, number], zoom: 16 },
  /** row house shadows, shader/building iteration */
  shadow_debug: { center: [5.44773, 51.45050] as [number, number], zoom: 20.0 },
} as const;

type DebugLocationKey = keyof typeof DEBUG_LOCATIONS;

// ▸ Change this to switch debug start location
const DEBUG_LOCATION: DebugLocationKey = 'beeldbuisring';

const _dbg = DEBUG_LOCATIONS[DEBUG_LOCATION];
const DEBUG_CENTER = _dbg.center;
const DEBUG_ZOOM = _dbg.zoom;

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
export const DEFAULT_PITCH = PRODUCTION_PITCH;
export const DEFAULT_BEARING = PRODUCTION_BEARING;

// Debug camera: set to true to start zoomed into Beeldbuisring 41 for shader/building debugging
export const DEBUG_CAMERA = __DEV__ && false;

// Default camera (Eindhoven city center)
const PRODUCTION_CENTER: [number, number] = [5.4697, 51.4416];
const PRODUCTION_ZOOM = 13;
const PRODUCTION_PITCH = 50;
const PRODUCTION_BEARING = 0;

// Debug camera (Beeldbuisring 41 close-up for shader/building iteration)
const DEBUG_CENTER: [number, number] = [5.44672, 51.4496];
const DEBUG_ZOOM = 18.9;
const DEBUG_PITCH = 50;
const DEBUG_BEARING = 0;

export const DEFAULT_CENTER: [number, number] = DEBUG_CAMERA ? DEBUG_CENTER : PRODUCTION_CENTER;
export const DEFAULT_ZOOM = DEBUG_CAMERA ? DEBUG_ZOOM : PRODUCTION_ZOOM;
export const DEFAULT_PITCH = DEBUG_CAMERA ? DEBUG_PITCH : PRODUCTION_PITCH;
export const DEFAULT_BEARING = DEBUG_CAMERA ? DEBUG_BEARING : PRODUCTION_BEARING;

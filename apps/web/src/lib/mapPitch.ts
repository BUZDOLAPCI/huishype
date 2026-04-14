import { DEFAULT_PITCH } from './mapDefaults';

export const AUTO_PITCH_START_ZOOM = 14;
export const AUTO_PITCH_END_ZOOM = 20;

export function getPitchForZoom(zoom: number, maxPitch = DEFAULT_PITCH): number {
  if (!Number.isFinite(zoom)) return 0;
  if (zoom <= AUTO_PITCH_START_ZOOM) return 0;
  if (zoom >= AUTO_PITCH_END_ZOOM) return maxPitch;

  const progress = (zoom - AUTO_PITCH_START_ZOOM) / (AUTO_PITCH_END_ZOOM - AUTO_PITCH_START_ZOOM);
  return progress * maxPitch;
}

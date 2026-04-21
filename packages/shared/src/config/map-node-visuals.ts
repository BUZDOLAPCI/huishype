import { PROPERTY_MAP_FOOTPRINTS } from './property-map.js';

export type NumericStop = readonly [threshold: number, value: number];
export type ColorStop = readonly [threshold: number, value: string];

export interface ActiveSingleNodeVisualInput {
  activityScore: number;
  socialCount: number;
  activeListingCount: number;
  recentSocialCount?: number;
  recentSocialScoreTotal?: number;
}

export interface ActiveClusterNodeVisualInput {
  pointCount: number;
  listingShare: number;
  socialCount: number;
  recentSocialCount?: number;
  recentSocialScoreTotal?: number;
}

export interface GhostClusterNodeVisualInput {
  pointCount: number;
}

export interface MapNodeVisual {
  diameter: number;
  backgroundColor: string;
  backgroundOpacity: number;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  coreDiameter?: number;
  coreColor?: string;
  coreOpacity?: number;
  pulseDiameter?: number;
  pulseColor?: string;
  pulseOpacity?: number;
  labelColor?: string;
  labelHaloColor?: string;
  labelSize?: number;
}

const ACTIVE_SINGLE_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.active.singleRadiusStopsPx;
const ACTIVE_CLUSTER_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.active.clusterRadiusStopsPx;
const GHOST_CLUSTER_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.ghost.clusterRadiusStopsPx;
const MAP_NODE_LISTING_RING_ON_WIDTH = 1.8;
const MAP_NODE_LISTING_RING_ON_COLOR = '#2563EB';
const MAP_NODE_LISTING_RING_ON_OPACITY = 0.96;

export const MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS = [
  [0, 0],
  [0.000001, MAP_NODE_LISTING_RING_ON_WIDTH],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS = [
  [0, '#CBD5E1'],
  [0.000001, MAP_NODE_LISTING_RING_ON_COLOR],
] as const satisfies readonly ColorStop[];

export const MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS = [
  [0, 0],
  [0.000001, MAP_NODE_LISTING_RING_ON_OPACITY],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS = [
  [0, 0],
  [1, MAP_NODE_LISTING_RING_ON_WIDTH],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS = [
  [0, '#CBD5E1'],
  [1, MAP_NODE_LISTING_RING_ON_COLOR],
] as const satisfies readonly ColorStop[];

export const MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS = [
  [0, 0],
  [1, MAP_NODE_LISTING_RING_ON_OPACITY],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR = '#FF9765';
export const MAP_NODE_SOCIAL_IDLE_CORE_COLOR = '#DDE6F4';
export const MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY = 0.96;
export const MAP_NODE_SOCIAL_IDLE_CORE_OPACITY = 0.8;
export const MAP_NODE_NON_LISTING_OUTLINE_WIDTH = 1;
export const MAP_NODE_NON_LISTING_OUTLINE_COLOR = '#FFFFFF';
export const MAP_NODE_NON_LISTING_OUTLINE_OPACITY = 0.9;

export const MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD = 0.5;

export const MAP_NODE_RECENT_PULSE_SINGLE_COLOR_STOPS = [
  [0, '#FFD2A8'],
  [1, '#FF8FA5'],
  [5, '#E11D48'],
] as const satisfies readonly ColorStop[];

export const MAP_NODE_RECENT_PULSE_CLUSTER_COLOR_STOPS = [
  [0, '#FFD2A8'],
  [1, '#FF8FA5'],
  [10, '#E11D48'],
] as const satisfies readonly ColorStop[];

export const MAP_NODE_RECENT_PULSE_OPACITY_STOPS = [
  [MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD, 0],
  [1, 0.16],
  [5, 0.28],
  [20, 0.42],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_RECENT_PULSE_SINGLE_RADIUS_DELTA_STOPS = [
  [MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD, 4],
  [1, 5],
  [5, 8],
  [20, 12],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_RECENT_PULSE_CLUSTER_RADIUS_DELTA_STOPS = [
  [MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD, 6],
  [1, 7],
  [5, 10],
  [20, 14],
] as const satisfies readonly NumericStop[];

export const MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR = '#FFFFFF';
export const MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR = 'rgba(0, 0, 0, 0.25)';
export const MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE = 11;

export const MAP_NODE_GHOST_CLUSTER_VISUAL = {
  fill: '#D3DAE6',
  opacity: 0.54,
  strokeWidth: 1,
  strokeColor: '#FFFFFF',
  strokeOpacity: 0.72,
  labelColor: '#475569',
  labelHaloColor: 'rgba(255, 255, 255, 0.85)',
  labelSize: 11,
} as const;

export const MAP_NODE_GHOST_SINGLE_VISUAL = {
  fill: '#AEBBCC',
  opacity: 0.38,
  strokeWidth: 1,
  strokeColor: '#FFFFFF',
  strokeOpacity: 0.54,
} as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeHex(color: string): string {
  const normalized = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (/^#[0-9A-Fa-f]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  throw new Error(`Expected hex color, received "${color}"`);
}

function hexToRgb(color: string): [number, number, number] {
  const hex = normalizeHex(color).slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function interpolateChannel(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function interpolateNumericStops(
  stops: readonly NumericStop[],
  input: number,
): number {
  if (stops.length === 0) {
    throw new Error('At least one numeric stop is required');
  }

  if (input <= stops[0][0]) {
    return stops[0][1];
  }

  for (let index = 1; index < stops.length; index += 1) {
    const [threshold, value] = stops[index];
    const [previousThreshold, previousValue] = stops[index - 1];

    if (input <= threshold) {
      const span = threshold - previousThreshold;
      if (span <= 0) {
        return value;
      }
      const progress = (input - previousThreshold) / span;
      return interpolateChannel(previousValue, value, progress);
    }
  }

  return stops[stops.length - 1][1];
}

export function interpolateColorStops(
  stops: readonly ColorStop[],
  input: number,
): string {
  if (stops.length === 0) {
    throw new Error('At least one color stop is required');
  }

  if (input <= stops[0][0]) {
    return normalizeHex(stops[0][1]);
  }

  for (let index = 1; index < stops.length; index += 1) {
    const [threshold, value] = stops[index];
    const [previousThreshold, previousValue] = stops[index - 1];

    if (input <= threshold) {
      const span = threshold - previousThreshold;
      if (span <= 0) {
        return normalizeHex(value);
      }

      const progress = (input - previousThreshold) / span;
      const startRgb = hexToRgb(previousValue);
      const endRgb = hexToRgb(value);

      return rgbToHex([
        interpolateChannel(startRgb[0], endRgb[0], progress),
        interpolateChannel(startRgb[1], endRgb[1], progress),
        interpolateChannel(startRgb[2], endRgb[2], progress),
      ]);
    }
  }

  return normalizeHex(stops[stops.length - 1][1]);
}

export function withAlpha(color: string, opacity: number): string {
  const [red, green, blue] = hexToRgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1).toFixed(3)})`;
}

function shouldShowRecentPulse(
  recentSocialCount: number,
  recentSocialScoreTotal: number,
): boolean {
  return (
    recentSocialCount > 0 &&
    recentSocialScoreTotal > MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD
  );
}

export function resolveActiveSingleNodeVisual(
  input: ActiveSingleNodeVisualInput,
): MapNodeVisual {
  const radius = interpolateNumericStops(ACTIVE_SINGLE_FOOTPRINT, input.activityScore);
  const recentSocialScoreTotal = input.recentSocialScoreTotal ?? 0;
  const hasSocial = input.socialCount > 0;
  const listingBorderWidth = interpolateNumericStops(
    MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS,
    input.activeListingCount,
  );
  const borderWidth = listingBorderWidth > 0 ? listingBorderWidth : MAP_NODE_NON_LISTING_OUTLINE_WIDTH;
  const pulseVisible = shouldShowRecentPulse(
    input.recentSocialCount ?? 0,
    recentSocialScoreTotal,
  );
  const pulseRadiusDelta = interpolateNumericStops(
    MAP_NODE_RECENT_PULSE_SINGLE_RADIUS_DELTA_STOPS,
    recentSocialScoreTotal,
  );

  return {
    diameter: radius * 2,
    backgroundColor: '#FFFFFF',
    backgroundOpacity: 0,
    borderWidth,
    borderColor: listingBorderWidth > 0
      ? interpolateColorStops(
        MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS,
        input.activeListingCount,
      )
      : MAP_NODE_NON_LISTING_OUTLINE_COLOR,
    borderOpacity: listingBorderWidth > 0
      ? interpolateNumericStops(
        MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS,
        input.activeListingCount,
      )
      : MAP_NODE_NON_LISTING_OUTLINE_OPACITY,
    coreDiameter: radius * 2,
    coreColor: hasSocial
      ? MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR
      : MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
    coreOpacity: hasSocial
      ? MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY
      : MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
    pulseColor: interpolateColorStops(
      MAP_NODE_RECENT_PULSE_SINGLE_COLOR_STOPS,
      input.recentSocialCount ?? 0,
    ),
    pulseDiameter: (radius + pulseRadiusDelta) * 2,
    pulseOpacity: pulseVisible
      ? interpolateNumericStops(MAP_NODE_RECENT_PULSE_OPACITY_STOPS, recentSocialScoreTotal)
      : 0,
    labelColor: '#FFFFFF',
    labelHaloColor: 'rgba(0, 0, 0, 0.25)',
    labelSize: 11,
  };
}

export function resolveActiveClusterNodeVisual(
  input: ActiveClusterNodeVisualInput,
): MapNodeVisual {
  const radius = interpolateNumericStops(ACTIVE_CLUSTER_FOOTPRINT, input.pointCount);
  const recentSocialScoreTotal = input.recentSocialScoreTotal ?? 0;
  const hasSocial = input.socialCount > 0;
  const listingBorderWidth = interpolateNumericStops(
    MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS,
    input.listingShare,
  );
  const borderWidth = listingBorderWidth > 0 ? listingBorderWidth : MAP_NODE_NON_LISTING_OUTLINE_WIDTH;
  const pulseVisible = shouldShowRecentPulse(
    input.recentSocialCount ?? 0,
    recentSocialScoreTotal,
  );
  const pulseRadiusDelta = interpolateNumericStops(
    MAP_NODE_RECENT_PULSE_CLUSTER_RADIUS_DELTA_STOPS,
    recentSocialScoreTotal,
  );

  return {
    diameter: radius * 2,
    backgroundColor: '#FFFFFF',
    backgroundOpacity: 0,
    borderWidth,
    borderColor: listingBorderWidth > 0
      ? interpolateColorStops(
        MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS,
        input.listingShare,
      )
      : MAP_NODE_NON_LISTING_OUTLINE_COLOR,
    borderOpacity: listingBorderWidth > 0
      ? interpolateNumericStops(
        MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS,
        input.listingShare,
      )
      : MAP_NODE_NON_LISTING_OUTLINE_OPACITY,
    coreDiameter: radius * 2,
    coreColor: hasSocial
      ? MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR
      : MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
    coreOpacity: hasSocial
      ? MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY
      : MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
    pulseColor: interpolateColorStops(
      MAP_NODE_RECENT_PULSE_CLUSTER_COLOR_STOPS,
      input.recentSocialCount ?? 0,
    ),
    pulseDiameter: (radius + pulseRadiusDelta) * 2,
    pulseOpacity: pulseVisible
      ? interpolateNumericStops(MAP_NODE_RECENT_PULSE_OPACITY_STOPS, recentSocialScoreTotal)
      : 0,
    labelColor: MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR,
    labelHaloColor: MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
    labelSize: MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE,
  };
}

export function resolveGhostSingleNodeVisual(): MapNodeVisual {
  const radius = PROPERTY_MAP_FOOTPRINTS.ghost.singleRadiusPx;

  return {
    diameter: radius * 2,
    backgroundColor: MAP_NODE_GHOST_SINGLE_VISUAL.fill,
    backgroundOpacity: MAP_NODE_GHOST_SINGLE_VISUAL.opacity,
    borderWidth: MAP_NODE_GHOST_SINGLE_VISUAL.strokeWidth,
    borderColor: MAP_NODE_GHOST_SINGLE_VISUAL.strokeColor,
    borderOpacity: MAP_NODE_GHOST_SINGLE_VISUAL.strokeOpacity,
  };
}

export function resolveGhostClusterNodeVisual(
  input: GhostClusterNodeVisualInput,
): MapNodeVisual {
  const radius = interpolateNumericStops(GHOST_CLUSTER_FOOTPRINT, input.pointCount);

  return {
    diameter: radius * 2,
    backgroundColor: MAP_NODE_GHOST_CLUSTER_VISUAL.fill,
    backgroundOpacity: MAP_NODE_GHOST_CLUSTER_VISUAL.opacity,
    borderWidth: MAP_NODE_GHOST_CLUSTER_VISUAL.strokeWidth,
    borderColor: MAP_NODE_GHOST_CLUSTER_VISUAL.strokeColor,
    borderOpacity: MAP_NODE_GHOST_CLUSTER_VISUAL.strokeOpacity,
    labelColor: MAP_NODE_GHOST_CLUSTER_VISUAL.labelColor,
    labelHaloColor: MAP_NODE_GHOST_CLUSTER_VISUAL.labelHaloColor,
    labelSize: MAP_NODE_GHOST_CLUSTER_VISUAL.labelSize,
  };
}

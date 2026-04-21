import { describe, expect, it } from 'vitest';

import {
  interpolateColorStops,
  interpolateNumericStops,
  MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
  resolveActiveClusterNodeVisual,
  resolveActiveSingleNodeVisual,
  resolveGhostClusterNodeVisual,
  resolveGhostSingleNodeVisual,
  withAlpha,
} from '../config/map-node-visuals.js';

describe('map-node-visuals', () => {
  it('uses Sun as the active social core fill color', () => {
    expect(MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR).toBe('#FDAE10');
  });

  it('interpolates numeric stops linearly', () => {
    expect(interpolateNumericStops([
      [0, 0],
      [10, 20],
    ], 5)).toBe(10);
  });

  it('interpolates color stops linearly', () => {
    expect(interpolateColorStops([
      [0, '#000000'],
      [10, '#FFFFFF'],
    ], 5)).toBe('#808080');
  });

  it('formats rgba strings from hex colors', () => {
    expect(withAlpha('#2563EB', 0.5)).toBe('rgba(37, 99, 235, 0.500)');
  });

  it('resolves listing-backed active singles with ring and pulse visuals', () => {
    const quietVisual = resolveActiveSingleNodeVisual({
      activityScore: 0,
      socialCount: 4,
      activeListingCount: 1,
      recentSocialCount: 1,
      recentSocialScoreTotal: 1,
    });
    const visual = resolveActiveSingleNodeVisual({
      activityScore: 80,
      socialCount: 4,
      activeListingCount: 1,
      recentSocialCount: 3,
      recentSocialScoreTotal: 8,
    });

    expect(visual.borderWidth).toBeGreaterThan(0);
    expect(visual.borderOpacity).toBeGreaterThan(0.9);
    expect(visual.coreDiameter).toBe(visual.diameter);
    expect(visual.coreColor).toBe(MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR);
    expect(quietVisual.coreColor).toBe(MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR);
    expect(visual.pulseOpacity).toBeGreaterThan(0);
    expect(visual.pulseColor).not.toBe(quietVisual.pulseColor);
    expect(visual.diameter).toBeGreaterThan(0);
    expect(visual.diameter).toBe(quietVisual.diameter);
    expect(visual.pulseDiameter).toBeGreaterThan(quietVisual.pulseDiameter ?? 0);
  });

  it('keeps social-only active singles ringless', () => {
    const visual = resolveActiveSingleNodeVisual({
      activityScore: 20,
      socialCount: 3,
      activeListingCount: 0,
      recentSocialCount: 0,
      recentSocialScoreTotal: 0,
    });

    expect(visual.borderWidth).toBe(1);
    expect(visual.borderColor).toBe('#FFFFFF');
    expect(visual.borderOpacity).toBe(0.9);
    expect(visual.pulseOpacity).toBe(0);
  });

  it('resolves active clusters with label-ready styling', () => {
    const smallCluster = resolveActiveClusterNodeVisual({
      pointCount: 2,
      listingShare: 0.05,
      socialCount: 12,
      recentSocialCount: 1,
      recentSocialScoreTotal: 1,
    });
    const visual = resolveActiveClusterNodeVisual({
      pointCount: 24,
      listingShare: 0.5,
      socialCount: 12,
      recentSocialCount: 6,
      recentSocialScoreTotal: 16,
    });

    expect(visual.diameter).toBeGreaterThan(20);
    expect(visual.diameter).toBe(smallCluster.diameter);
    expect(visual.borderWidth).toBe(1.8);
    expect(smallCluster.borderWidth).toBe(1.8);
    expect(visual.borderColor).toBe('#2563EB');
    expect(visual.borderOpacity).toBe(0.96);
    expect(visual.coreDiameter).toBe(visual.diameter);
    expect(visual.coreColor).toBe(MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR);
    expect(smallCluster.coreColor).toBe(MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR);
    expect(visual.pulseColor).not.toBe(smallCluster.pulseColor);
    expect(visual.labelColor).toBe('#FFFFFF');
    expect(visual.labelSize).toBe(11);
    expect(visual.pulseOpacity).toBeGreaterThan(0);
    expect(visual.pulseDiameter).toBeGreaterThan(smallCluster.pulseDiameter ?? 0);
  });

  it('keeps no-listing active clusters ringless while preserving the fill footprint', () => {
    const visual = resolveActiveClusterNodeVisual({
      pointCount: 8,
      listingShare: 0,
      socialCount: 6,
      recentSocialCount: 0,
      recentSocialScoreTotal: 0,
    });

    expect(visual.borderWidth).toBe(1);
    expect(visual.borderColor).toBe('#FFFFFF');
    expect(visual.borderOpacity).toBe(0.9);
    expect(visual.coreDiameter).toBe(visual.diameter);
  });

  it('resolves ghost visuals as low-emphasis dots and clusters', () => {
    const single = resolveGhostSingleNodeVisual();
    const cluster = resolveGhostClusterNodeVisual({ pointCount: 16 });

    expect(single.backgroundOpacity).toBeLessThan(0.5);
    expect(cluster.backgroundOpacity).toBeGreaterThan(single.backgroundOpacity);
    expect(cluster.labelColor).toBe('#475569');
  });
});

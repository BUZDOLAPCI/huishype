/**
 * MapGradient — Fading gradient overlays for the map screen chrome.
 *
 * Design spec (Section 7.15):
 * - Top gradient: 180px, #FFFFFFBB (73% white) to transparent
 * - Bottom gradient: 140px, transparent to #FFFFFFCC (80% white)
 *
 * Implementation:
 * - Web: CSS linear-gradient via inline style (react-native-web supports it).
 * - Native: Multiple stacked semi-transparent View slices to approximate gradient.
 *   (expo-linear-gradient is not installed; these slices are lightweight and
 *   avoid adding a dependency for two simple fades.)
 */

import React from 'react';
import { View, Platform, StyleSheet } from 'react-native';

interface MapGradientProps {
  /** Which edge the gradient sits on. */
  position: 'top' | 'bottom';
  testID?: string;
}

/** Number of gradient slices on native. More = smoother. */
const SLICE_COUNT = 8;

/**
 * Top gradient: from ~73% white at top to transparent at bottom.
 * Bottom gradient: from transparent at top to ~80% white at bottom.
 */
const GRADIENT_CONFIG = {
  top: {
    height: 180,
    // Alpha values from top to bottom (73% -> 0%)
    alphas: [0.73, 0.64, 0.52, 0.40, 0.28, 0.16, 0.06, 0],
    webGradient: 'linear-gradient(180deg, rgba(255,255,255,0.73) 0%, rgba(255,255,255,0) 100%)',
  },
  bottom: {
    height: 140,
    // Alpha values from top to bottom (0% -> 80%)
    alphas: [0, 0.06, 0.16, 0.28, 0.42, 0.56, 0.68, 0.80],
    webGradient: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.80) 100%)',
  },
} as const;

export function MapGradient({ position, testID }: MapGradientProps) {
  const config = GRADIENT_CONFIG[position];
  const positionStyle = position === 'top'
    ? { top: 0 }
    : { bottom: 0 };

  if (Platform.OS === 'web') {
    return (
      <View
        testID={testID}
        style={[
          styles.base,
          positionStyle,
          { height: config.height },
          // Cast to any for web-only CSS property.
          { backgroundImage: config.webGradient } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        ]}
        pointerEvents="none"
      />
    );
  }

  // Native: render stacked semi-transparent slices.
  const sliceHeight = config.height / SLICE_COUNT;

  return (
    <View
      testID={testID}
      style={[styles.base, positionStyle, { height: config.height }]}
      pointerEvents="none"
    >
      {config.alphas.map((alpha, i) => (
        <View
          key={i}
          style={{
            height: sliceHeight,
            backgroundColor: `rgba(255, 255, 255, ${alpha})`,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
});

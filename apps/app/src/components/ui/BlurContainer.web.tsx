/**
 * BlurContainer — Web implementation using CSS backdrop-filter.
 */

import React, { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

export interface BlurContainerProps {
  /** Blur intensity (0-100). Mapped to CSS blur radius (intensity * 0.25px). Default 80 (20px). */
  intensity?: number;
  /** Tint style. Default 'light'. */
  tint?: 'light' | 'dark' | 'default';
  /** Additional styles applied to the container. */
  style?: ViewStyle;
  /** Children rendered inside the blur container. */
  children?: ReactNode;
  testID?: string;
}

/**
 * Map tint to a semi-transparent background so content behind the blur
 * picks up the expected colour tone.
 */
function tintToBackground(tint: 'light' | 'dark' | 'default'): string {
  switch (tint) {
    case 'dark':
      return 'rgba(0,0,0,0.4)';
    case 'light':
      return 'rgba(255,255,255,0.7)';
    default:
      return 'rgba(255,255,255,0.5)';
  }
}

export function BlurContainer({
  intensity = 80,
  tint = 'light',
  style,
  children,
  testID,
}: BlurContainerProps) {
  // Convert intensity (0-100) to a blur radius in pixels.
  // 80 intensity -> 20px blur (matches expo-blur's native mapping)
  const blurRadius = Math.round(intensity * 0.25);

  return (
    <View
      testID={testID}
      // Cast to any to allow web-only CSS properties (backdropFilter,
      // WebkitBackdropFilter) that are valid in react-native-web but
      // not typed in React Native's ViewStyle.
      style={[
        {
          overflow: 'hidden' as const,
          backdropFilter: `blur(${blurRadius}px)`,
          WebkitBackdropFilter: `blur(${blurRadius}px)`,
          backgroundColor: tintToBackground(tint),
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        style,
      ]}
    >
      {children}
    </View>
  );
}

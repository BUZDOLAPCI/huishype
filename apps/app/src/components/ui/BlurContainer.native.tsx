/**
 * BlurContainer — Native implementation using expo-blur.
 *
 * Android caveat: expo-blur uses RenderEffect (real blur) on SDK 31+.
 * On SDK 30 (e.g. Samsung S10e debug device), it falls back to a
 * semi-transparent overlay. This is expected behaviour.
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

export interface BlurContainerProps {
  /** Blur intensity (0-100). Default 80. */
  intensity?: number;
  /** Tint style. Default 'light'. */
  tint?: 'light' | 'dark' | 'default';
  /** Additional styles applied to the BlurView. */
  style?: ViewStyle;
  /** Children rendered inside the blur container. */
  children?: ReactNode;
  testID?: string;
}

export function BlurContainer({
  intensity = 80,
  tint = 'light',
  style,
  children,
  testID,
}: BlurContainerProps) {
  return (
    <BlurView
      intensity={intensity}
      tint={tint}
      style={[styles.container, style]}
      testID={testID}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

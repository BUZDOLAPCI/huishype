/**
 * LocationButton — Floating current-location button for the map screen.
 *
 * Design spec (Section 7.14):
 * - Size: 44x44px
 * - Corner radius: 22px (circle)
 * - Fill: #FFFFFFDD (~87% white, translucent)
 * - Backdrop blur: radius 12
 * - Shadow (primary): blur 8, color #00000018
 * - Shadow (secondary): blur 3, color #00000010
 * - Icon: Phosphor crosshair, 22px, $warm-700 (#504A42)
 * - Position: bottom-right of map viewport
 */

import React from 'react';
import { Pressable, Platform, StyleSheet, type ViewStyle } from 'react-native';

import { Icon } from '@/src/components/ui/Icon';
import { BlurContainer } from '@/src/components/ui/BlurContainer';
import { useT } from '@/src/i18n';

interface LocationButtonProps {
  onPress?: () => void;
  testID?: string;
}

const COLORS = {
  warm700: '#504A42',
  whiteTranslucent: 'rgba(255, 255, 255, 0.87)',
} as const;

const nativeShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 4,
  },
  android: { elevation: 4 },
  default: {},
}) ?? {};

export function LocationButton({ onPress, testID }: LocationButtonProps) {
  const t = useT();

  if (Platform.OS === 'web') {
    return (
      <Pressable
        onPress={onPress}
        testID={testID ?? 'location-button'}
        accessibilityLabel={t('nav.currentLocation.label')}
        accessibilityHint={t('nav.currentLocation.hint')}
        accessibilityRole="button"
        style={[styles.button, styles.webButton]}
      >
        <Icon name="Crosshair" size="lg" weight="regular" color={COLORS.warm700} />
      </Pressable>
    );
  }

  // Native: wrap in BlurContainer for backdrop blur.
  return (
    <Pressable
      onPress={onPress}
      testID={testID ?? 'location-button'}
      accessibilityLabel={t('nav.currentLocation.label')}
      accessibilityHint={t('nav.currentLocation.hint')}
      accessibilityRole="button"
      style={[styles.shadowWrapper, nativeShadow]}
    >
      <BlurContainer
        intensity={48}
        tint="light"
        style={styles.blurCircle}
      >
        <Icon name="Crosshair" size="lg" weight="regular" color={COLORS.warm700} />
      </BlurContainer>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadowWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  blurCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webButton: {
    // Web-only: backdrop-filter and background via casting.
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          backgroundColor: COLORS.whiteTranslucent,
          boxShadow: '0 2px 8px rgba(0,0,0,0.09), 0 1px 3px rgba(0,0,0,0.06)',
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      : {}),
  },
});

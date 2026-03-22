/**
 * MapHeaderRow — Floating header row for the map screen.
 *
 * Design spec (Section 8.1):
 * - Transparent background, no border
 * - Padding [0, 20]
 * - Left: HuisHype logo 28px + brand text Inter 22/700 $gold-500
 * - Right: city name Inter 18/600 $warm-800
 * - Status-bar-aware spacing (safe area top)
 *
 * The header floats over the map — the top gradient (MapGradient) sits behind it.
 */

import React from 'react';
import { View, Text, Image, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Import the logo. On native, require() returns a number (asset ID).
// On web, it returns a string (URL) or { default: string }.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logoSource = require('@/assets/images/icon.png');

interface MapHeaderRowProps {
  /** City or location name to display on the right side. */
  cityName?: string;
  testID?: string;
}

const COLORS = {
  /** Brand text uses gold-700 for AA contrast on white/warm-50 backgrounds. */
  gold700: '#B47712',
  warm800: '#3D3832',
} as const;

export function MapHeaderRow({ cityName, testID }: MapHeaderRowProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID ?? 'map-header-row'}
      style={[
        styles.container,
        {
          paddingTop: Platform.OS === 'web'
            ? 12
            : insets.top + 8,
        },
      ]}
      pointerEvents="none"
      accessibilityRole="header"
    >
      {/* Left: Logo + Brand Text */}
      <View style={styles.brandGroup} accessibilityLabel="HuisHype">
        <Image
          source={logoSource}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="HuisHype logo"
        />
        <Text style={styles.brandText} accessibilityRole="header">
          HuisHype
        </Text>
      </View>

      {/* Right: City Name */}
      {cityName ? (
        <Text
          style={styles.cityText}
          numberOfLines={1}
          accessibilityLabel={`Current location: ${cityName}`}
        >
          {cityName}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  brandText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: COLORS.gold700,
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  cityText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: COLORS.warm800,
    letterSpacing: 0,
    lineHeight: 25,
  },
});

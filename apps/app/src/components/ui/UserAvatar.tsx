/**
 * UserAvatar — Deterministic warm-toned avatar with initials fallback.
 *
 * Generates a stable background colour from a username hash using a
 * curated warm palette. Renders a profile photo when available, or
 * initials on a coloured circle.
 *
 * Size variants:
 *   xs  (28px) — nested replies
 *   sm  (32px) — inline mentions, comment lists
 *   md  (40px) — comment threads, card headers
 *   lg  (80px) — profile screens
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

// Warm-toned palette — 10 colours that harmonise with the gold/warm brand.
// Chosen for readability of white initials on each background.
const AVATAR_PALETTE = [
  '#D97706', // amber-600
  '#B45309', // amber-700
  '#C2410C', // orange-700
  '#9A3412', // orange-800
  '#A16207', // yellow-700
  '#4D7C0F', // lime-700
  '#15803D', // green-700
  '#0E7490', // cyan-700
  '#1D4ED8', // blue-700
  '#7C3AED', // violet-600
] as const;

const SIZE_MAP = {
  xs: 28,
  sm: 32,
  md: 40,
  lg: 80,
} as const;

const FONT_SCALE = {
  xs: 11,
  sm: 13,
  md: 16,
  lg: 32,
} as const;

export type AvatarSize = keyof typeof SIZE_MAP;

export interface UserAvatarProps {
  /** Username (used for colour hashing and initials). */
  username: string;
  /** Optional display name (preferred for initials). */
  displayName?: string;
  /** Profile photo URL. When provided and valid, the image is shown. */
  profilePhotoUrl?: string | null;
  /** Size variant. Default 'md'. */
  size?: AvatarSize;
  testID?: string;
}

/**
 * Simple FNV-1a-inspired hash for deterministic palette selection.
 * Not cryptographic — just needs to be stable and well-distributed.
 */
function hashUsername(username: string): number {
  let hash = 2166136261;
  for (let i = 0; i < username.length; i++) {
    hash ^= username.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/** Get 1-2 letter initials from a name. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Get a deterministic palette colour for a username. */
export function getAvatarColor(username: string): string {
  const index = hashUsername(username) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

export function UserAvatar({
  username,
  displayName,
  profilePhotoUrl,
  size = 'md',
  testID,
}: UserAvatarProps) {
  const dimension = SIZE_MAP[size];
  const fontSize = FONT_SCALE[size];
  const borderRadius = dimension / 2;
  const bgColor = getAvatarColor(username);
  const initials = getInitials(displayName || username || '?');

  if (profilePhotoUrl) {
    return (
      <Image
        source={{ uri: profilePhotoUrl }}
        style={[
          styles.image,
          {
            width: dimension,
            height: dimension,
            borderRadius,
            backgroundColor: bgColor,
          },
        ]}
        testID={testID ?? 'user-avatar'}
        accessibilityLabel={`Avatar for ${displayName || username}`}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: dimension,
          height: dimension,
          borderRadius,
          backgroundColor: bgColor,
        },
      ]}
      testID={testID ?? 'user-avatar'}
      accessibilityLabel={`Avatar for ${displayName || username}`}
    >
      <Text style={[styles.initials, { fontSize }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

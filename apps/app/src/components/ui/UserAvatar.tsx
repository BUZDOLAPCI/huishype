/**
 * UserAvatar — Deterministic initial avatar with profile-photo override.
 *
 * Renders a profile photo when available. Otherwise it falls back to a
 * deterministic pastel background with initials generated from the
 * username hash so the app gets a broad range of non-identifying default avatars.
 *
 * Size variants:
 *   xs  (28px) — nested replies
 *   sm  (32px) — inline mentions, comment lists
 *   comment (36px) — comment cells
 *   md  (40px) — comment threads, card headers
 *   lg  (80px) — profile screens
 */

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

import {
  DefaultAvatarArt,
  getAvatarColor,
  getAvatarVariantIndex,
} from './avatarArt';

const SIZE_MAP = {
  xs: 28,
  sm: 32,
  comment: 36,
  md: 40,
  lg: 80,
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
export { getAvatarColor, getAvatarVariantIndex };

export function getAvatarInitials(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    return '?';
  }

  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return normalized.slice(0, 2).toUpperCase();
}

export function UserAvatar({
  username,
  displayName,
  profilePhotoUrl,
  size = 'md',
  testID,
}: UserAvatarProps) {
  const dimension = SIZE_MAP[size];
  const borderRadius = dimension / 2;
  const avatarSeed = username || displayName || 'guest';
  const bgColor = getAvatarColor(avatarSeed);
  const initials = getAvatarInitials(displayName || username || '?');
  const resolvedTestID = testID ?? 'user-avatar';

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
        testID={resolvedTestID}
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
      testID={resolvedTestID}
      accessibilityLabel={`Avatar for ${displayName || username}`}
    >
      <DefaultAvatarArt
        seed={avatarSeed}
        initials={initials}
        size={dimension}
        testID={`${resolvedTestID}-art`}
      />
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
    overflow: 'hidden',
  },
});

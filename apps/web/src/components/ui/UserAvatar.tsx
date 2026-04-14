import React from 'react';

const AVATAR_PALETTE = [
  '#D97706',
  '#B45309',
  '#C2410C',
  '#9A3412',
  '#A16207',
  '#4D7C0F',
  '#15803D',
  '#0E7490',
  '#1D4ED8',
  '#7C3AED',
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
  username: string;
  displayName?: string;
  profilePhotoUrl?: string | null;
  size?: AvatarSize;
  testID?: string;
}

function hashUsername(username: string): number {
  let hash = 2166136261;
  for (let index = 0; index < username.length; index += 1) {
    hash ^= username.charCodeAt(index);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

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
  const bgColor = getAvatarColor(username);
  const initials = getInitials(displayName || username || '?');

  if (profilePhotoUrl) {
    return (
      <img
        src={profilePhotoUrl}
        alt={`Avatar for ${displayName || username}`}
        data-testid={testID ?? 'user-avatar'}
        style={{
          width: dimension,
          height: dimension,
          borderRadius: '50%',
          objectFit: 'cover',
          backgroundColor: bgColor,
          display: 'block',
        }}
      />
    );
  }

  return (
    <div
      data-testid={testID ?? 'user-avatar'}
      aria-label={`Avatar for ${displayName || username}`}
      style={{
        width: dimension,
        height: dimension,
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: FONT_SCALE[size],
        fontWeight: 600,
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
}

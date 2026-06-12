import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './ui/Icon';

export type ActivityLevel = 'hot' | 'warm' | 'cold';
export type ListingMarketState = 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';

type PillSize = 'sm' | 'md';
type ActivityTone = 'solid' | 'soft';

interface ActivityPillProps {
  level: ActivityLevel;
  hideCold?: boolean;
  tone?: ActivityTone;
  size?: PillSize;
  testID?: string;
}

interface ListingPillProps {
  marketState?: ListingMarketState | null;
  size?: PillSize;
  testID?: string;
}

const ACTIVITY_CONFIG = {
  hot: {
    label: 'Hot',
    solidBg: '#FF6B35',
    softBg: '#FFF5F0',
    dot: '#FF6B35',
    text: '#C43E00',
  },
  warm: {
    label: 'Active',
    solidBg: '#F5A623',
    softBg: '#FFFBEB',
    dot: '#F5A623',
    text: '#B47712',
  },
  cold: {
    label: 'Quiet',
    solidBg: '#C7BFB3',
    softBg: '#F5F0E8',
    dot: '#C7BFB3',
    text: '#8C8479',
  },
} as const;

const LISTING_CONFIG = {
  'for-sale': {
    label: 'For sale',
    bg: '#EAF6EF',
    dot: '#2F9E62',
    text: '#1F7A49',
  },
  'for-rent': {
    label: 'For rent',
    bg: '#EAF3FF',
    dot: '#2D7DD2',
    text: '#1F5F9F',
  },
  sold: {
    label: 'Sold',
    bg: '#F6F8F6',
    dot: '#9AA89E',
    text: '#6B776F',
  },
  rented: {
    label: 'Rented',
    bg: '#F6F7F9',
    dot: '#98A3B0',
    text: '#697280',
  },
} as const;

function getSizeStyle(size: PillSize) {
  return size === 'md' ? styles.pillMd : styles.pillSm;
}

export function ActivityPill({
  level,
  hideCold = false,
  tone = 'soft',
  size = 'sm',
  testID = 'activity-pill',
}: ActivityPillProps) {
  if (hideCold && level === 'cold') {
    return null;
  }

  const config = ACTIVITY_CONFIG[level];
  const isSolid = tone === 'solid';
  const iconSize = size === 'md' ? 13 : 12;

  return (
    <View
      style={[
        styles.pill,
        getSizeStyle(size),
        { backgroundColor: isSolid ? config.solidBg : config.softBg },
      ]}
      testID={testID}
    >
      {isSolid ? (
        <Icon name="Flame" size={iconSize} color="#FFFFFF" />
      ) : (
        <View style={[styles.dot, { backgroundColor: config.dot }]} />
      )}
      <Text
        style={[
          styles.label,
          size === 'md' && styles.labelMd,
          { color: isSolid ? '#FFFFFF' : config.text },
        ]}
      >
        {config.label}
      </Text>
    </View>
  );
}

export function ListingPill({
  marketState,
  size = 'sm',
  testID = 'listing-pill',
}: ListingPillProps) {
  const config = marketState && marketState !== 'not-listed' ? LISTING_CONFIG[marketState] : null;

  if (!config) {
    return null;
  }

  return (
    <View
      style={[styles.pill, getSizeStyle(size), styles.listingPill, { backgroundColor: config.bg }]}
      testID={testID}
    >
      <View style={[styles.dot, { backgroundColor: config.dot }]} />
      <Text style={[styles.label, size === 'md' && styles.labelMd, { color: config.text }]}>
        {config.label}
      </Text>
    </View>
  );
}

export function StatusPillRow({
  children,
  style,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={StyleSheet.flatten([styles.row, style])} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    gap: 4,
    flexShrink: 0,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillMd: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listingPill: {
    borderWidth: 1,
    borderColor: 'rgba(45, 41, 38, 0.06)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 15,
  },
});

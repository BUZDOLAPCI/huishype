import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/src/components/ui/Icon';
import type { FollowingViewportItem } from '@/src/hooks/useProperties';

const COLORS = {
  white: '#FFFFFF',
  warm100: '#FFF8F0',
  warm300: '#E8E0D4',
  warm600: '#736C62',
  warm900: '#2D2926',
  gold500: '#F5A623',
  gold600: '#D68B14',
  goldTint: 'rgba(245, 166, 35, 0.18)',
  shadow: 'rgba(65, 52, 36, 0.16)',
} as const;

function getActivityPresentation(activityTypes: FollowingViewportItem['activityTypes']): {
  icon: IconName;
  label: string;
} {
  const [firstType] = activityTypes;

  if (activityTypes.length > 1) {
    return { icon: 'Users', label: 'Mixed' };
  }

  if (firstType === 'comment') {
    return { icon: 'ChatCircle', label: 'Comment' };
  }

  if (firstType === 'price_guess') {
    return { icon: 'ChartLineUp', label: 'Guess' };
  }

  return { icon: 'Heart', label: 'Like' };
}

export interface FollowingMapMarkerProps {
  item: FollowingViewportItem;
  onPress: (item: FollowingViewportItem) => void;
  testID?: string;
}

export function FollowingMapMarker({
  item,
  onPress,
  testID,
}: FollowingMapMarkerProps) {
  const presentation = getActivityPresentation(item.activityTypes);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${presentation.label} activity for ${item.address}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.containerPressed,
      ]}
      testID={testID}
    >
      <View style={styles.iconBadge}>
        <Icon color={COLORS.gold600} name={presentation.icon} size="sm" />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.label}>
          {presentation.label}
        </Text>
        <Text style={styles.count}>
          {item.actorCount} {item.actorCount === 1 ? 'person' : 'people'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    borderColor: COLORS.gold500,
    borderRadius: 999,
    borderWidth: 1,
    elevation: 4,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
  },
  containerPressed: {
    transform: [{ scale: 0.98 }],
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.goldTint,
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  copy: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  label: {
    color: COLORS.warm900,
    fontSize: 12,
    fontWeight: '700',
  },
  count: {
    color: COLORS.warm600,
    fontSize: 11,
    fontWeight: '600',
  },
});

/**
 * NotificationBell — Bell icon with unread badge count.
 *
 * Used in Feed, Saved, Profile headers and the notifications screen.
 * Taps navigate to the notifications route.
 *
 * The badge shows the unread count (capped at 99+). When there are no
 * unread notifications the badge is hidden.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { useT } from '@/src/i18n';

export interface NotificationBellProps {
  /** Number of unread notifications. 0 hides the badge. */
  unreadCount?: number;
  /** Called when the bell is pressed. */
  onPress?: () => void;
  /** Icon size preset or px. Default 'lg' (22px). */
  size?: 'sm' | 'md' | 'lg';
  /** Icon colour. Default warm-700 (#504A42). */
  color?: string;
  testID?: string;
}

const SIZE_MAP = { sm: 16, md: 18, lg: 22 } as const;

export function NotificationBell({
  unreadCount = 0,
  onPress,
  size = 'lg',
  color = '#504A42',
  testID,
}: NotificationBellProps) {
  const t = useT();
  const iconSize = SIZE_MAP[size];
  const showBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      testID={testID ?? 'notification-bell'}
      accessibilityLabel={
        showBadge
          ? t('notifications.unreadLabel', { count: unreadCount })
          : t('common.notifications')
      }
      accessibilityHint={t('profile.notifications.hint')}
      accessibilityRole="button"
      style={styles.container}
    >
      <Icon name="Bell" size={iconSize} weight="regular" color={color} />
      {showBadge && (
        <View style={styles.badge} testID="notification-badge">
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF6B35', // hot-red-500
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
});

/**
 * ScreenHeader — In-screen header for non-map tabs (Feed, Saved, Profile).
 *
 * Replaces the system header (now disabled via headerShown: false).
 * Contains the screen title on the left and a NotificationBell on the right.
 * Status-bar-aware via safe area insets.
 *
 * The NotificationBell is wired to the real unread count from the API
 * and navigates to the /notifications route on press.
 */

import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';

interface ScreenHeaderProps {
  /** Title displayed in the header. */
  title: string;
  /** Whether to show the notification bell. Default true. */
  showNotificationBell?: boolean;
  /** Right-side action element (overrides notification bell). */
  rightAction?: React.ReactNode;
  testID?: string;
}

const COLORS = {
  headerBackground: 'rgba(255, 251, 245, 0.24)',
  warm900: '#2D2926',
} as const;

export function ScreenHeader({
  title,
  showNotificationBell = true,
  rightAction,
  testID,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const { data: unreadCount } = useUnreadNotificationCount();

  return (
    <View
      testID={testID ?? 'screen-header'}
      style={[
        styles.container,
        {
          paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8,
          backgroundColor: COLORS.headerBackground,
        },
      ]}
    >
      <Text
        style={styles.title}
        numberOfLines={1}
        testID="screen-header-title"
        accessibilityRole="header"
      >
        {title}
      </Text>

      {rightAction ?? (showNotificationBell ? (
        <NotificationBell
          unreadCount={unreadCount ?? 0}
          onPress={() => router.push('/notifications')}
        />
      ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: COLORS.warm900,
    letterSpacing: -0.2,
    lineHeight: 28,
    flex: 1,
  },
});

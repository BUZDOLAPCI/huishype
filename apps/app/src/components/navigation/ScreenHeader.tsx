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
import { View, Text, Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { Icon } from '@/src/components/ui/Icon';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { useT } from '@/src/i18n';

interface ScreenHeaderProps {
  /** Title displayed in the header. */
  title: string;
  /** Whether to show a back arrow before the title. Default false. */
  showBackButton?: boolean;
  /** Custom handler for the back arrow. Defaults to router.back(). */
  onBackPress?: () => void;
  /** Whether to show the notification bell. Default true. */
  showNotificationBell?: boolean;
  /** Right-side action element (overrides notification bell). */
  rightAction?: React.ReactNode;
  /** Accessible label for the back button. Defaults to localized "Go back". */
  backAccessibilityLabel?: string;
  testID?: string;
}

const COLORS = {
  headerBackground: 'rgba(255, 251, 245, 0.24)',
  warm900: '#2D2926',
} as const;

export function ScreenHeader({
  title,
  showBackButton = false,
  onBackPress,
  showNotificationBell = true,
  rightAction,
  backAccessibilityLabel,
  testID,
}: ScreenHeaderProps) {
  const t = useT();
  const insets = useSafeAreaInsets();

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
      {showBackButton ? (
        <Pressable
          onPress={onBackPress ?? (() => router.back())}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={backAccessibilityLabel ?? t('common.goBack')}
          style={styles.backButton}
          testID="screen-header-back-button"
        >
          <Icon name="ArrowLeft" size="lg" color={COLORS.warm900} />
        </Pressable>
      ) : null}

      <Text
        style={[styles.title, showBackButton ? styles.titleWithBackButton : null]}
        numberOfLines={1}
        testID="screen-header-title"
        accessibilityRole="header"
      >
        {title}
      </Text>

      {rightAction ?? (showNotificationBell ? <HeaderNotificationBell /> : null)}
    </View>
  );
}

function HeaderNotificationBell() {
  const { data: unreadCount } = useUnreadNotificationCount();

  return (
    <NotificationBell
      unreadCount={unreadCount ?? 0}
      onPress={() => router.push('/notifications')}
    />
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
  backButton: {
    width: 36,
    height: 36,
    marginLeft: -10,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: COLORS.warm900,
    letterSpacing: -0.2,
    lineHeight: 28,
    flex: 1,
  },
  titleWithBackButton: {
    flexShrink: 1,
  },
});

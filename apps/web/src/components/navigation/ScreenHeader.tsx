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
import { useNavigate } from 'react-router-dom';

import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import type { CSSProperties } from 'react';

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
  warm50: '#FFFBF5',
  warm900: '#2D2926',
} as const;

export function ScreenHeader({
  title,
  showNotificationBell = true,
  rightAction,
  testID,
}: ScreenHeaderProps) {
  const { data: unreadCount } = useUnreadNotificationCount();
  const navigate = useNavigate();

  return (
    <div
      data-testid={testID ?? 'screen-header'}
      style={{
        ...styles.container,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        backgroundColor: COLORS.warm50,
      }}
    >
      <span style={styles.title}>
        {title}
      </span>

      {rightAction ?? (showNotificationBell ? (
        <NotificationBell
          unreadCount={unreadCount ?? 0}
          onPress={() => navigate('/notifications')}
        />
      ) : null)}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.warm900,
    letterSpacing: -0.2,
    lineHeight: '28px',
    flex: 1,
  },
};

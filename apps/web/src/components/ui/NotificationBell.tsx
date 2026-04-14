import React from 'react';
import { Icon } from './Icon';

export interface NotificationBellProps {
  unreadCount?: number;
  onPress?: () => void;
  size?: 'sm' | 'md' | 'lg';
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
  const iconSize = SIZE_MAP[size];
  const showBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <button
      type="button"
      onClick={onPress}
      data-testid={testID ?? 'notification-bell'}
      aria-label={showBadge ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      style={{
        position: 'relative',
        padding: 4,
        minWidth: 44,
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <Icon name="Bell" size={iconSize} weight="regular" color={color} />
      {showBadge ? (
        <span
          data-testid="notification-badge"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: '#FF6B35',
            color: '#FFFFFF',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            fontSize: 9,
            fontWeight: 700,
            border: '1.5px solid #FFFFFF',
          }}
        >
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}

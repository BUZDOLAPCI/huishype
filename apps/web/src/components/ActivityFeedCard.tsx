/**
 * ActivityFeedCard — Card variant for the "Recent Activity" feed tab.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { Icon, type IconName } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';
import { Card } from './ui/Card';
import type { ActivityEventType } from '../hooks/useUserActivity';
import { PropertyImageSurface } from './PropertyImageSurface';

export interface ActivityFeedCardProps {
  id: string;
  eventType: ActivityEventType;
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  };
  property: {
    id: string;
    address: string;
    city: string;
    thumbnailUrl: string | null;
  };
  createdAt: string;
  onPress?: () => void;
}

interface ActionBadgeConfig {
  icon: IconName;
  label: string;
  bg: string;
  color: string;
}

const ACTION_CONFIGS: Record<ActivityEventType, ActionBadgeConfig> = {
  property_like: { icon: 'Heart', label: 'Liked', bg: '#FFF0F0', color: '#E53935' },
  comment: { icon: 'ChatCircle', label: 'Commented', bg: '#EFF6FF', color: '#42A5F5' },
  price_guess: { icon: 'Tag', label: 'Guessed', bg: '#ECFDF5', color: '#4CAF50' },
  save: { icon: 'BookmarkSimple', label: 'Saved', bg: '#FFFBEB', color: '#F5A623' },
};

function formatRelativeTime(isoDate: string): string {
  const diffMin = Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} ${diffHrs === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function ActivityFeedCard({ eventType, actor, property, createdAt, onPress }: ActivityFeedCardProps) {
  const config = ACTION_CONFIGS[eventType];

  return (
    <button type="button" onClick={onPress} style={styles.pressable} aria-label="Activity feed card">
      <Card shadow="card" testID="activity-feed-card">
        <div style={styles.imageWrapper}>
          <PropertyImageSurface
            source={{ listingPhotoUrl: property.thumbnailUrl }}
            style={styles.image}
            imageTestID="activity-feed-image"
            placeholder={<div style={styles.placeholder}><Icon name="HouseLine" size="2xl" color="#C7BFB3" /></div>}
          />
        </div>

        <div style={styles.body}>
          <div style={styles.address}>{property.address} · {property.city}</div>

          <div style={styles.userRow}>
            <UserAvatar username={actor.handle} displayName={actor.displayName} profilePhotoUrl={actor.profilePhotoUrl} size="sm" />
            <div style={styles.userInfo}>
              <div style={styles.userName}>{actor.displayName}</div>
              <div style={styles.timestamp}>{formatRelativeTime(createdAt)}</div>
            </div>

            <div style={{ ...styles.actionBadge, backgroundColor: config.bg }}>
              <Icon name={config.icon} size={14} weight="fill" color={config.color} />
              <span style={{ ...styles.actionBadgeText, color: config.color }}>{config.label}</span>
            </div>
          </div>

          <div style={styles.metricsRow}>
            <div style={styles.metric}><Icon name="Heart" size={15} color="#C7BFB3" /></div>
            <div style={styles.metric}><Icon name="ChatCircle" size={15} color="#42A5F5" /></div>
          </div>
        </div>
      </Card>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  pressable: {
    margin: '0 16px 16px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    width: 'calc(100% - 32px)',
    textAlign: 'inherit',
    cursor: 'pointer',
  },
  imageWrapper: { position: 'relative', overflow: 'hidden' },
  image: { width: '100%', height: 200 },
  placeholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#F5F0E8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  address: { fontSize: 13, color: '#9C958A' },
  userRow: { display: 'flex', alignItems: 'center', gap: 10 },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, fontWeight: 600, color: '#3D3832', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  timestamp: { fontSize: 12, color: '#9C958A', marginTop: 1 },
  actionBadge: { display: 'inline-flex', alignItems: 'center', borderRadius: 20, padding: '4px 10px', gap: 4 },
  actionBadgeText: { fontSize: 12, fontWeight: 600 },
  metricsRow: { display: 'flex', gap: 16 },
  metric: { display: 'inline-flex', alignItems: 'center', gap: 4 },
};

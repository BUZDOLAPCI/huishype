/**
 * ActivityFeedCard — Card variant for the "Recent Activity" feed tab.
 *
 * Shows social events (likes, comments, guesses) with actor info,
 * property context, and timestamp.
 *
 * Design spec: Section 7.12 (Social Activity Feed).
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon, type IconName } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';
import { Card } from './ui/Card';
import type { ActivityEventType } from '../hooks/useUserActivity';
import { PropertyImageSurface } from './PropertyImageSurface';

export interface ActivityFeedCardProps {
  /** Unique activity event ID. */
  id: string;
  /** Event type. */
  eventType: ActivityEventType;
  /** Actor who performed the action. */
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  };
  /** Property the action was performed on. */
  property: {
    id: string;
    address: string;
    city: string;
    thumbnailUrl: string | null;
  };
  /** ISO timestamp. */
  createdAt: string;
  /** Called when the property is pressed. */
  onPropertyPress?: () => void;
  /** Called when the actor row is pressed. */
  onActorPress?: () => void;
}

// --- Action badge config ---

interface ActionBadgeConfig {
  icon: IconName;
  label: string;
  bg: string;
  color: string;
}

const ACTION_CONFIGS: Record<ActivityEventType, ActionBadgeConfig> = {
  property_like: {
    icon: 'Heart',
    label: 'Liked',
    bg: '#FFF0F0',
    color: '#E53935',
  },
  comment: {
    icon: 'ChatCircle',
    label: 'Commented',
    bg: '#EFF6FF',
    color: '#42A5F5',
  },
  price_guess: {
    icon: 'Tag',
    label: 'Guessed',
    bg: '#ECFDF5',
    color: '#4CAF50',
  },
  save: {
    icon: 'BookmarkSimple',
    label: 'Saved',
    bg: '#FFFBEB',
    color: '#F5A623',
  },
};

// --- Relative time formatting ---

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / (1000 * 60));

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} ${diffHrs === 1 ? 'hour' : 'hours'} ago`;

  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// --- Component ---

export function ActivityFeedCard({
  eventType,
  actor,
  property,
  createdAt,
  onPropertyPress,
  onActorPress,
}: ActivityFeedCardProps) {
  const config = ACTION_CONFIGS[eventType];

  return (
    <Card shadow="card" testID="activity-feed-card" style={styles.pressable}>
      <Pressable
        onPress={onPropertyPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${property.address}`}
      >
        {/* Property image */}
        <View style={styles.imageWrapper}>
          <PropertyImageSurface
            source={{ listingPhotoUrl: property.thumbnailUrl }}
            style={styles.image}
            imageTestID="activity-feed-image"
            placeholder={(
              <View style={styles.placeholder}>
                <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
              </View>
            )}
          />
        </View>

        {/* Content */}
        <View style={styles.body}>
          {/* Address */}
          <Text style={styles.address} numberOfLines={1}>
            {property.address} · {property.city}
          </Text>
        </View>
      </Pressable>

      <View style={styles.body}>
        <Pressable
          onPress={onActorPress}
          accessibilityRole="button"
          accessibilityLabel={`Open ${actor.displayName}'s profile`}
          style={styles.userRow}
        >
            <UserAvatar
              username={actor.handle}
              displayName={actor.displayName}
              profilePhotoUrl={actor.profilePhotoUrl}
              size="sm"
            />
            <View style={styles.userInfo}>
              <Text style={styles.userName} numberOfLines={1}>
                {actor.displayName}
              </Text>
              <Text style={styles.timestamp}>
                {formatRelativeTime(createdAt)}
              </Text>
            </View>

            {/* Action badge */}
            <View style={[styles.actionBadge, { backgroundColor: config.bg }]}>
              <Icon
                name={config.icon}
                size={14}
                weight="fill"
                color={config.color}
              />
              <Text style={[styles.actionBadgeText, { color: config.color }]}>
                {config.label}
              </Text>
            </View>
        </Pressable>

        {/* Simple stats row */}
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Icon name="Heart" size={15} color="#C7BFB3" />
          </View>
          <View style={styles.metric}>
            <Icon name="ChatCircle" size={15} color="#42A5F5" />
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  imageWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 200,
  },
  placeholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  address: {
    fontSize: 13,
    color: '#9C958A', // warm-500
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3D3832', // warm-800
  },
  timestamp: {
    fontSize: 12,
    color: '#9C958A', // warm-500
    marginTop: 1,
  },
  actionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  actionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});

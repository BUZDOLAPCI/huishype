/**
 * ActivityFeedCard — Card variant for the "Recent Activity" feed tab.
 *
 * Shows social events (likes, comments, guesses) with actor info,
 * property context, and timestamp.
 *
 * Design spec: Section 7.12 (Social Activity Feed).
 */

import React, { memo, useMemo } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Icon, type IconName } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';
import { Card } from './ui/Card';
import type { ActivityEventType } from '../hooks/useUserActivity';
import { PropertyImageSurface } from './PropertyImageSurface';
import { toPropertyImageSource } from '../utils/property-image';

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
    countryCode: string;
    geometry: { type: 'Point'; coordinates: [number, number] } | null;
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

function ActivityFeedCardComponent({
  eventType,
  actor,
  property,
  createdAt,
  onPropertyPress,
  onActorPress,
}: ActivityFeedCardProps) {
  const config = ACTION_CONFIGS[eventType];
  const relativeTime = useMemo(() => formatRelativeTime(createdAt), [createdAt]);

  return (
    <Card shadow="card" testID="activity-feed-card" style={styles.card}>
      <Pressable
        onPress={onPropertyPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${property.address}`}
        testID="activity-feed-property-button"
      >
        <View style={styles.imageWrapper}>
          <PropertyImageSurface
            source={toPropertyImageSource(property)}
            style={styles.image}
            imageTestID="activity-feed-image"
            markerTestID="activity-feed-image-marker"
            placeholder={(
              <View style={styles.placeholder}>
                <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
              </View>
            )}
          />
        </View>

        <View style={styles.body}>
          <Text style={styles.address} numberOfLines={1}>
            {property.address}
          </Text>
        </View>
      </Pressable>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Pressable
            onPress={onActorPress}
            accessibilityRole="button"
            accessibilityLabel={`Open ${actor.displayName}'s profile`}
            style={styles.userRow}
            testID="activity-feed-actor-button"
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
            </View>
          </Pressable>

          <View style={styles.metaRight}>
            <Text style={styles.timestamp}>
              {relativeTime}
            </Text>
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
          </View>
        </View>
      </View>
    </Card>
  );
}

function areActivityFeedCardPropsEqual(
  prev: Readonly<ActivityFeedCardProps>,
  next: Readonly<ActivityFeedCardProps>,
) {
  return (
    prev.id === next.id &&
    prev.eventType === next.eventType &&
    prev.createdAt === next.createdAt &&
    prev.actor.id === next.actor.id &&
    prev.actor.displayName === next.actor.displayName &&
    prev.actor.handle === next.actor.handle &&
    prev.actor.profilePhotoUrl === next.actor.profilePhotoUrl &&
    prev.property.id === next.property.id &&
    prev.property.address === next.property.address &&
    prev.property.city === next.property.city &&
    prev.property.countryCode === next.property.countryCode &&
    prev.property.geometry?.coordinates[0] === next.property.geometry?.coordinates[0] &&
    prev.property.geometry?.coordinates[1] === next.property.geometry?.coordinates[1] &&
    prev.property.thumbnailUrl === next.property.thumbnailUrl
  );
}

export const ActivityFeedCard = memo(
  ActivityFeedCardComponent,
  areActivityFeedCardPropsEqual
);

const styles = StyleSheet.create({
  card: {
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
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
  metaRight: {
    alignItems: 'flex-end',
    gap: 8,
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
});

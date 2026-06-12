import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from './ui/Card';
import { Icon, type IconName } from './ui/Icon';
import { PropertyImageSurface } from './PropertyImageSurface';
import { UserAvatar } from './ui/UserAvatar';
import { toPropertyImageSource, withDerivedPropertyImageData } from '../utils/property-image';
import { useT } from '@/src/i18n';
import { buildUserProfileRoute } from '@/src/utils/user-route';
import type {
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
} from '../hooks/useActivityFeed';

export interface ActivityFeedCardProps {
  property: GroupedPropertyActivityItem['property'];
  lastActivityAt: string;
  recentActors: GroupedPropertyActivityItem['recentActors'];
  preview: GroupedActivityPreview;
  counts: GroupedPropertyActivityItem['counts'];
  onPress?: () => void;
}

const STAT_CONFIG = {
  likes: {
    icon: 'Heart' as const,
    color: '#E91E63',
    bg: 'rgba(233, 30, 99, 0.08)',
  },
  comments: {
    icon: 'ChatCircle' as const,
    color: '#42A5F5',
    bg: 'rgba(66, 165, 245, 0.08)',
  },
  guesses: {
    icon: 'Tag' as const,
    color: '#4CAF50',
    bg: 'rgba(76, 175, 80, 0.08)',
  },
} as const;

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / (1000 * 60));

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;

  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatActorHeadline(actors: GroupedPropertyActivityItem['recentActors']) {
  if (actors.length === 0) {
    return 'Recent activity';
  }

  if (actors.length === 1) {
    return actors[0].displayName;
  }

  if (actors.length === 2) {
    return `${actors[0].displayName} and ${actors[1].displayName}`;
  }

  return `${actors[0].displayName}, ${actors[1].displayName} and ${actors[2].displayName}`;
}

function renderPreviewText(preview: GroupedActivityPreview) {
  if (preview.kind === 'comment') {
    return `${preview.actor.displayName}: ${preview.contentPreview}`;
  }

  return preview.summary;
}

function StatChip({
  icon,
  value,
  color,
  backgroundColor,
  testID,
}: {
  icon: IconName;
  value: number;
  color: string;
  backgroundColor: string;
  testID: string;
}) {
  return (
    <View style={[styles.statChip, { backgroundColor }]} testID={testID}>
      <Icon name={icon} size={14} color={color} />
      <Text style={[styles.statChipText, { color }]}>{value}</Text>
    </View>
  );
}

function ActivityFeedCardComponent({
  property,
  lastActivityAt,
  recentActors,
  preview,
  counts,
  onPress,
}: ActivityFeedCardProps) {
  const t = useT();
  const propertyWithImages = useMemo(
    () => withDerivedPropertyImageData(property),
    [property],
  );
  const imageSource = useMemo(
    () => toPropertyImageSource(propertyWithImages),
    [propertyWithImages],
  );
  const relativeTime = useMemo(() => formatRelativeTime(lastActivityAt), [lastActivityAt]);
  const actorHeadline = useMemo(() => formatActorHeadline(recentActors), [recentActors]);
  const previewText = useMemo(() => renderPreviewText(preview), [preview]);
  const primaryActor = recentActors[0];
  const actorRowContent = (
    <>
      <View style={styles.facepile} testID="property-activity-facepile">
        {recentActors.map((actor, index) => (
          <View
            key={actor.id}
            style={[
              styles.facepileItem,
              index > 0 ? { marginLeft: -10 } : null,
              { zIndex: recentActors.length - index },
            ]}
          >
            <UserAvatar
              username={actor.handle}
              displayName={actor.displayName}
              profilePhotoUrl={actor.profilePhotoUrl}
              size="xs"
              testID={`property-activity-actor-${index}`}
            />
          </View>
        ))}
      </View>
      <Text style={styles.actorText} numberOfLines={1}>
        {actorHeadline}
      </Text>
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      style={styles.pressable}
      accessibilityRole="button"
      accessibilityLabel={`Open ${property.address}`}
      accessibilityHint={t('common.openPropertyDetails')}
      testID="property-activity-card"
    >
      <Card shadow="card">
        <View style={styles.imageWrapper}>
          <PropertyImageSurface
            source={imageSource}
            style={styles.image}
            imageTestID="property-activity-image"
            markerTestID="property-activity-image-marker"
            placeholder={(
              <View style={styles.placeholder}>
                <Icon name="HouseLine" size="2xl" color="#C7BFB3" />
                <Text style={styles.placeholderText}>{t('property.feed.noImage')}</Text>
              </View>
            )}
          />
        </View>

        <View style={styles.body}>
          <View style={styles.addressRow}>
            <View style={styles.addressContent}>
              <Text style={styles.address} numberOfLines={1}>
                {property.address}
              </Text>
              <Text style={styles.city} numberOfLines={1}>
                {property.city}
              </Text>
            </View>
            <Text style={styles.timestamp}>{relativeTime}</Text>
          </View>

          {primaryActor ? (
            <Pressable
              style={styles.actorRow}
              testID="property-activity-primary-actor-link"
              accessibilityRole="link"
              accessibilityLabel={`Open ${primaryActor.displayName}'s profile`}
              onPress={(event) => {
                event?.stopPropagation?.();
                router.push(buildUserProfileRoute(primaryActor.handle));
              }}
            >
              {actorRowContent}
            </Pressable>
          ) : (
            <View style={styles.actorRow}>{actorRowContent}</View>
          )}

          <View style={styles.previewBlock}>
            <Text style={styles.previewLabel}>
              {preview.kind === 'comment' ? 'Latest comment' : 'Latest activity'}
            </Text>
            <Text style={styles.previewText} numberOfLines={3}>
              {previewText}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.statRow} testID="property-activity-stats">
            <StatChip
              icon={STAT_CONFIG.likes.icon}
              color={STAT_CONFIG.likes.color}
              backgroundColor={STAT_CONFIG.likes.bg}
              value={counts.likeCount}
              testID="property-activity-stats-likes"
            />
            <StatChip
              icon={STAT_CONFIG.comments.icon}
              color={STAT_CONFIG.comments.color}
              backgroundColor={STAT_CONFIG.comments.bg}
              value={counts.commentCount}
              testID="property-activity-stats-comments"
            />
            <StatChip
              icon={STAT_CONFIG.guesses.icon}
              color={STAT_CONFIG.guesses.color}
              backgroundColor={STAT_CONFIG.guesses.bg}
              value={counts.guessCount}
              testID="property-activity-stats-guesses"
            />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function areActivityFeedCardPropsEqual(
  prev: Readonly<ActivityFeedCardProps>,
  next: Readonly<ActivityFeedCardProps>,
) {
  return (
    prev.property.id === next.property.id &&
    prev.property.address === next.property.address &&
    prev.property.city === next.property.city &&
    prev.property.countryCode === next.property.countryCode &&
    prev.property.thumbnailUrl === next.property.thumbnailUrl &&
    prev.property.geometry?.coordinates[0] === next.property.geometry?.coordinates[0] &&
    prev.property.geometry?.coordinates[1] === next.property.geometry?.coordinates[1] &&
    prev.lastActivityAt === next.lastActivityAt &&
    prev.counts.likeCount === next.counts.likeCount &&
    prev.counts.commentCount === next.counts.commentCount &&
    prev.counts.guessCount === next.counts.guessCount &&
    prev.preview.kind === next.preview.kind &&
    prev.recentActors.length === next.recentActors.length &&
    prev.recentActors.every((actor, index) => {
      const nextActor = next.recentActors[index];
      return (
        actor?.id === nextActor?.id &&
        actor?.displayName === nextActor?.displayName &&
        actor?.handle === nextActor?.handle &&
        actor?.profilePhotoUrl === nextActor?.profilePhotoUrl
      );
    })
  );
}

export const ActivityFeedCard = memo(
  ActivityFeedCardComponent,
  areActivityFeedCardPropsEqual,
);

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
    height: 188,
  },
  placeholder: {
    width: '100%',
    height: 188,
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#C7BFB3',
    fontSize: 13,
    marginTop: 8,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  addressContent: {
    flex: 1,
  },
  address: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D2926',
    fontFamily: 'Inter_600SemiBold',
  },
  city: {
    marginTop: 2,
    fontSize: 13,
    color: '#736C62',
  },
  timestamp: {
    fontSize: 12,
    color: '#9C958A',
    marginTop: 2,
  },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  facepile: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  facepileItem: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  actorText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#3D3832',
  },
  previewBlock: {
    backgroundColor: '#F8F5EF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#9C958A',
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3D3832',
  },
  divider: {
    height: 1,
    backgroundColor: '#EFE7DB',
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

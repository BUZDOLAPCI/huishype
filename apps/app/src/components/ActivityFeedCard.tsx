import React, { memo, useCallback, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { router } from 'expo-router';
import {
  formatAddress,
  formatPropertyPrice,
  getValuationLabel,
  type CountryCode,
} from '@huishype/shared';

import { Card } from './ui/Card';
import { Icon, type IconName } from './ui/Icon';
import { PropertyImageSurface } from './PropertyImageSurface';
import { UserAvatar } from './ui/UserAvatar';
import { toPropertyImageSource, withDerivedPropertyImageData } from '../utils/property-image';
import { useT } from '@/src/i18n';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useLikeComment } from '@/src/hooks/useComments';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { buildUserProfileRoute } from '@/src/utils/user-route';
import {
  buildPropertyCommentsRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';
import type {
  ActivityActor,
  ActivityProperty,
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
} from '../hooks/useActivityFeed';

type ActivityFeedProperty = ActivityProperty & {
  aerialImageUrl?: string | null;
  askingPrice?: number | null;
  floorAreaM2?: number | null;
  yearBuilt?: number | null;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  marketState?: string | string[] | null;
  isLiked?: boolean;
  isSaved?: boolean;
  likeCount?: number;
};

type ActivityFeedPreview = GroupedActivityPreview & {
  isLiked?: boolean;
  likeCount?: number;
};

export interface ActivityFeedCardProps {
  property: ActivityFeedProperty;
  lastActivityAt: string;
  recentActors: GroupedPropertyActivityItem['recentActors'];
  preview: ActivityFeedPreview;
  counts: GroupedPropertyActivityItem['counts'];
  onPress?: () => void;
  onAuthRequired?: () => void;
}

function stopNestedPress(event?: GestureResponderEvent): void {
  event?.stopPropagation?.();
}

function formatRelativeTime(isoDate: string, t: ReturnType<typeof useT>): string {
  const then = new Date(isoDate).getTime();
  const diffMs = Number.isFinite(then) ? Date.now() - then : 0;
  const diffMin = Math.max(0, Math.floor(diffMs / (1000 * 60)));

  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t('time.hoursAgo', { count: diffHrs });

  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  if (diffDays < 14) return t('time.weekAgo', { count: 1 });
  if (diffDays < 30) return t('time.weeksAgo', { count: Math.floor(diffDays / 7) });

  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths <= 1
    ? t('time.monthAgo', { count: 1 })
    : t('time.monthsAgo', { count: diffMonths });
}

function formatActorHeadline(
  actors: GroupedPropertyActivityItem['recentActors'],
  t: ReturnType<typeof useT>,
): string {
  if (actors.length === 0) {
    return t('activityFeed.actor.recentActivity');
  }

  if (actors.length === 1) {
    return actors[0].displayName;
  }

  if (actors.length === 2) {
    return t('activityFeed.actor.two', {
      first: actors[0].displayName,
      second: actors[1].displayName,
    });
  }

  return t('activityFeed.actor.threePlus', {
    first: actors[0].displayName,
    second: actors[1].displayName,
    count: actors.length - 2,
  });
}

function getPrimaryActor(
  recentActors: GroupedPropertyActivityItem['recentActors'],
): ActivityActor | null {
  return recentActors[0] ?? null;
}

function getMarketStateLabel(
  marketState: ActivityFeedProperty['marketState'],
  t: ReturnType<typeof useT>,
): string | null {
  const value = Array.isArray(marketState) ? marketState[0] : marketState;

  switch (value) {
    case 'for-sale':
      return t('property.marketStatus.forSale');
    case 'for-rent':
      return t('property.marketStatus.forRent');
    case 'sold':
      return t('property.marketStatus.sold');
    case 'rented':
      return t('property.marketStatus.rented');
    case 'not-listed':
      return t('property.marketStatus.notListed');
    default:
      return null;
  }
}

function getPriceLine(
  property: ActivityFeedProperty,
  t: ReturnType<typeof useT>,
): string | null {
  const countryCode = property.countryCode as CountryCode;

  if (property.askingPrice != null && property.askingPrice > 0) {
    return `${t('activityFeed.attachment.askingPrice')} ${formatPropertyPrice(
      property.askingPrice,
      countryCode,
      { compact: true },
    )}`;
  }

  if (property.officialValuation != null && property.officialValuation > 0) {
    return `${getValuationLabel(property.countryCode)} ${formatPropertyPrice(
      property.officialValuation,
      countryCode,
      { compact: true },
    )}`;
  }

  return null;
}

function getPropertyFacts(
  property: ActivityFeedProperty,
  t: ReturnType<typeof useT>,
): string[] {
  const facts: string[] = [];

  if (property.floorAreaM2 != null && property.floorAreaM2 > 0) {
    facts.push(t('activityFeed.attachment.floorArea', { count: property.floorAreaM2 }));
  }

  if (property.yearBuilt != null && property.yearBuilt > 0) {
    facts.push(t('activityFeed.attachment.yearBuilt', { year: property.yearBuilt }));
  }

  return facts;
}

function getPropertyTitleAddress(property: ActivityFeedProperty): string {
  const streetName = property.streetName?.trim();
  const houseNumber = property.houseNumber != null ? String(property.houseNumber).trim() : '';

  if (!streetName || !houseNumber) {
    return property.address;
  }

  return formatAddress({
    streetName,
    houseNumber,
    houseNumberAddition: property.houseNumberAddition ?? undefined,
    countryCode: property.countryCode as CountryCode,
  });
}

function EngagementSummary({
  likeCount,
  summaryText,
}: {
  likeCount: number;
  summaryText: string;
}) {
  return (
    <View style={styles.engagementSummary} testID="property-activity-engagement-summary">
      <View style={styles.engagementLeft}>
        <View style={styles.engagementBubble}>
          <Icon name="Heart" size={11} weight="fill" color="#FFFFFF" />
        </View>
        <Text style={styles.engagementText} testID="property-activity-like-count">
          {likeCount}
        </Text>
      </View>
      <Text style={styles.engagementText}>
        {summaryText}
      </Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  active,
  disabled,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: (event?: GestureResponderEvent) => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && !disabled ? styles.actionButtonPressed : null,
      ]}
      testID={testID}
    >
      <Icon
        name={icon}
        size={19}
        weight={active ? 'fill' : 'regular'}
        color={active ? '#DE911D' : '#736C62'}
      />
      <Text style={[styles.actionText, active ? styles.actionTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActivityFeedCardComponent({
  property,
  lastActivityAt,
  recentActors,
  preview,
  counts,
  onPress,
  onAuthRequired,
}: ActivityFeedCardProps) {
  const t = useT();
  const { isAuthenticated } = useAuthContext();
  const propertyWithImages = useMemo(
    () => withDerivedPropertyImageData(property),
    [property],
  );
  const imageSource = useMemo(
    () => toPropertyImageSource(propertyWithImages),
    [propertyWithImages],
  );
  const relativeTime = useMemo(
    () => formatRelativeTime(lastActivityAt, t),
    [lastActivityAt, t],
  );
  const actorHeadline = useMemo(
    () => formatActorHeadline(recentActors, t),
    [recentActors, t],
  );
  const primaryActor = getPrimaryActor(recentActors);
  const marketStateLabel = getMarketStateLabel(property.marketState, t);
  const priceLine = getPriceLine(property, t);
  const propertyFacts = getPropertyFacts(property, t);
  const titleAddress = getPropertyTitleAddress(property);
  const engagementSummaryText = t('activityFeed.engagement.summary', {
    comments: counts.commentCount,
    guesses: counts.guessCount,
  });
  const cityLine = [property.city, property.postalCode].filter(Boolean).join(' · ');
  const commentLikeMutation = useLikeComment(property.id);
  const previewCommentLiked = preview.kind === 'comment' ? (preview.isLiked ?? false) : false;
  const previewCommentLikeCount = preview.kind === 'comment' ? (preview.likeCount ?? 0) : 0;
  const propertyLike = usePropertyLike({
    propertyId: property.id,
    onAuthRequired,
    initialIsLiked: property.isLiked,
    initialLikeCount: property.likeCount ?? counts.likeCount,
  });
  const propertySave = usePropertySave({
    propertyId: property.id,
    onAuthRequired,
    initialIsSaved: property.isSaved,
  });
  const handleProfilePress = useCallback((actor: ActivityActor, event?: GestureResponderEvent) => {
    stopNestedPress(event);
    router.push(buildUserProfileRoute(actor.handle));
  }, []);
  const handleCommentPress = useCallback((event?: GestureResponderEvent) => {
    stopNestedPress(event);
    router.push(toInternalAppHref(buildPropertyCommentsRoute(property, '/feed')));
  }, [property]);
  const handlePropertyLikePress = useCallback((event?: GestureResponderEvent) => {
    stopNestedPress(event);
    propertyLike.toggleLike();
  }, [propertyLike]);
  const handleSavePress = useCallback((event?: GestureResponderEvent) => {
    stopNestedPress(event);
    void propertySave.toggleSave();
  }, [propertySave]);
  const handlePreviewCommentLikePress = useCallback((event?: GestureResponderEvent) => {
    stopNestedPress(event);

    if (preview.kind !== 'comment') {
      return;
    }

    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }

    commentLikeMutation.mutate({
      commentId: preview.commentId,
      isCurrentlyLiked: previewCommentLiked,
    });
  }, [
    commentLikeMutation,
    isAuthenticated,
    onAuthRequired,
    preview,
    previewCommentLiked,
  ]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.pressable}
      accessibilityLabel={`Open ${property.address}`}
      accessibilityHint={t('common.openPropertyDetails')}
      testID="property-activity-card"
    >
      <Card shadow="card" style={styles.card}>
        <View style={styles.header}>
          <Pressable
            style={styles.facepile}
            testID="property-activity-facepile"
            accessibilityRole={primaryActor ? 'link' : undefined}
            accessibilityLabel={
              primaryActor ? t('comments.openProfile', { name: primaryActor.displayName }) : undefined
            }
            onPress={(event) => {
              if (primaryActor) {
                handleProfilePress(primaryActor, event);
              }
            }}
          >
            {recentActors.length > 0 ? recentActors.slice(0, 3).map((actor, index) => (
              <View
                key={actor.id}
                style={[
                  styles.facepileItem,
                  index > 0 ? styles.facepileOverlap : null,
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
            )) : (
              <UserAvatar
                username="activity"
                displayName={t('activityFeed.actor.recentActivity')}
                anonymous
                size="xs"
                testID="property-activity-actor-fallback"
              />
            )}
          </Pressable>
          <View style={styles.headerText}>
            {primaryActor ? (
              <Pressable
                testID="property-activity-primary-actor-link"
                accessibilityRole="link"
                accessibilityLabel={t('comments.openProfile', { name: primaryActor.displayName })}
                onPress={(event) => handleProfilePress(primaryActor, event)}
              >
                <Text style={styles.actorText} numberOfLines={1}>
                  {actorHeadline}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.actorText} numberOfLines={1}>
                {actorHeadline}
              </Text>
            )}
            <Text style={styles.timestamp}>{relativeTime}</Text>
          </View>
        </View>

        <View style={styles.postBody} testID="property-activity-post-body">
          {preview.kind === 'comment' ? (
            <View style={styles.commentPreview} testID="property-activity-comment-preview">
              <Pressable
                style={styles.commentAvatarPress}
                testID="property-activity-comment-author-link"
                accessibilityRole="link"
                accessibilityLabel={t('comments.openProfile', { name: preview.actor.displayName })}
                onPress={(event) => handleProfilePress(preview.actor, event)}
              >
                <UserAvatar
                  username={preview.actor.handle}
                  displayName={preview.actor.displayName}
                  profilePhotoUrl={preview.actor.profilePhotoUrl}
                  size="sm"
                  testID="property-activity-comment-avatar"
                />
              </Pressable>
              <View style={styles.commentContent}>
                <Pressable
                  testID="property-activity-comment-author-name"
                  accessibilityRole="link"
                  accessibilityLabel={t('comments.openProfile', { name: preview.actor.displayName })}
                  onPress={(event) => handleProfilePress(preview.actor, event)}
                >
                  <Text style={styles.commentAuthor} numberOfLines={1}>
                    {preview.actor.displayName}
                  </Text>
                </Pressable>
                <Text style={styles.commentText} numberOfLines={4}>
                  {preview.contentPreview}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: previewCommentLiked }}
                  style={styles.inlineCommentLike}
                  onPress={handlePreviewCommentLikePress}
                  testID="property-activity-comment-like-button"
                >
                  <Text
                    style={[
                      styles.inlineCommentLikeText,
                      previewCommentLiked ? styles.inlineCommentLikeTextActive : null,
                    ]}
                  >
                    {previewCommentLiked ? t('comments.unlikeAction') : t('comments.likeAction')}
                  </Text>
                  {previewCommentLikeCount > 0 ? (
                    <Text style={styles.inlineCommentCount} testID="property-activity-comment-like-count">
                      {previewCommentLikeCount}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.summaryText} numberOfLines={3} testID="property-activity-summary">
              {preview.summary}
            </Text>
          )}
        </View>

        <Pressable
          onPress={onPress}
          style={styles.attachment}
          accessibilityRole="button"
          accessibilityLabel={`Open ${property.address}`}
          accessibilityHint={t('common.openPropertyDetails')}
          testID="property-activity-attachment"
        >
          <View style={styles.attachmentImageWrapper}>
            <PropertyImageSurface
              source={imageSource}
              style={styles.attachmentImage}
              markerSize={22}
              imageTestID="property-activity-image"
              markerTestID="property-activity-image-marker"
              placeholder={(
                <View style={styles.placeholder}>
                  <Icon name="HouseLine" size="xl" color="#C7BFB3" />
                </View>
              )}
            />
          </View>
          <View style={styles.attachmentContent}>
            <Text style={styles.address} numberOfLines={1}>
              {titleAddress}
            </Text>
            {cityLine ? (
              <Text style={styles.city} numberOfLines={1}>
                {cityLine}
              </Text>
            ) : null}
            <View style={styles.attachmentMeta}>
              {marketStateLabel ? (
                <Text style={styles.metaPill} testID="property-activity-market-state">
                  {marketStateLabel}
                </Text>
              ) : null}
              {priceLine ? (
                <Text style={styles.metaText} numberOfLines={1} testID="property-activity-price">
                  {priceLine}
                </Text>
              ) : null}
            </View>
            {propertyFacts.length > 0 ? (
              <Text style={styles.factsText} numberOfLines={1} testID="property-activity-facts">
                {propertyFacts.join(' · ')}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.divider} />

        <EngagementSummary
          likeCount={propertyLike.likeCount}
          summaryText={engagementSummaryText}
        />

        <View style={styles.actionRow} testID="property-activity-action-row">
          <ActionButton
            icon="Heart"
            label={propertyLike.isLiked ? t('activityFeed.action.liked') : t('activityFeed.action.like')}
            active={propertyLike.isLiked}
            disabled={propertyLike.isLoading}
            onPress={handlePropertyLikePress}
            testID="property-activity-like-button"
          />
          <ActionButton
            icon="ChatCircle"
            label={t('activityFeed.action.comment')}
            onPress={handleCommentPress}
            testID="property-activity-comment-button"
          />
          <ActionButton
            icon="BookmarkSimple"
            label={propertySave.isSaved ? t('activityFeed.action.saved') : t('activityFeed.action.save')}
            active={propertySave.isSaved}
            disabled={propertySave.isLoading}
            onPress={handleSavePress}
            testID="property-activity-save-button"
          />
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
    prev.property.postalCode === next.property.postalCode &&
    prev.property.countryCode === next.property.countryCode &&
    prev.property.thumbnailUrl === next.property.thumbnailUrl &&
    prev.property.aerialImageUrl === next.property.aerialImageUrl &&
    prev.property.askingPrice === next.property.askingPrice &&
    prev.property.officialValuation === next.property.officialValuation &&
    prev.property.floorAreaM2 === next.property.floorAreaM2 &&
    prev.property.yearBuilt === next.property.yearBuilt &&
    prev.property.marketState === next.property.marketState &&
    prev.property.isLiked === next.property.isLiked &&
    prev.property.isSaved === next.property.isSaved &&
    prev.property.likeCount === next.property.likeCount &&
    prev.property.geometry?.coordinates[0] === next.property.geometry?.coordinates[0] &&
    prev.property.geometry?.coordinates[1] === next.property.geometry?.coordinates[1] &&
    prev.lastActivityAt === next.lastActivityAt &&
    prev.counts.likeCount === next.counts.likeCount &&
    prev.counts.commentCount === next.counts.commentCount &&
    prev.counts.guessCount === next.counts.guessCount &&
    prev.preview.kind === next.preview.kind &&
    prev.preview.createdAt === next.preview.createdAt &&
    prev.onPress === next.onPress &&
    prev.onAuthRequired === next.onAuthRequired &&
    (prev.preview.kind !== 'comment' ||
      next.preview.kind !== 'comment' ||
      (prev.preview.commentId === next.preview.commentId &&
        prev.preview.contentPreview === next.preview.contentPreview &&
        prev.preview.isLiked === next.preview.isLiked &&
        prev.preview.likeCount === next.preview.likeCount)) &&
    (prev.preview.kind !== 'summary' ||
      next.preview.kind !== 'summary' ||
      prev.preview.summary === next.preview.summary) &&
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
  card: {
    borderRadius: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
  },
  facepile: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 30,
    minHeight: 30,
  },
  facepileItem: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  facepileOverlap: {
    marginLeft: -10,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actorText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#2D2926',
  },
  timestamp: {
    fontSize: 12,
    lineHeight: 15,
    color: '#8C8479',
  },
  postBody: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  commentPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  commentAvatarPress: {
    flexShrink: 0,
  },
  commentContent: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#F7F2EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
  },
  commentAuthor: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: '#2D2926',
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3D3832',
  },
  inlineCommentLike: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingTop: 4,
    minHeight: 28,
  },
  inlineCommentLikeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#736C62',
  },
  inlineCommentLikeTextActive: {
    color: '#DE911D',
  },
  inlineCommentCount: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8C8479',
    fontVariant: ['tabular-nums'],
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#3D3832',
  },
  attachment: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginBottom: 12,
    minHeight: 108,
    borderWidth: 1,
    borderColor: '#E8E0D4',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#FFFBF5',
  },
  attachmentImageWrapper: {
    width: 112,
    backgroundColor: '#F5F0E8',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    minHeight: 108,
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentContent: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  address: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    color: '#2D2926',
  },
  city: {
    fontSize: 13,
    lineHeight: 17,
    color: '#736C62',
  },
  attachmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaPill: {
    borderRadius: 999,
    backgroundColor: '#EAF6EF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#1F7A49',
    overflow: 'hidden',
  },
  metaText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#504A42',
  },
  factsText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#8C8479',
  },
  divider: {
    height: 1,
    backgroundColor: '#EFE7DB',
    marginHorizontal: 14,
  },
  engagementSummary: {
    minHeight: 36,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  engagementLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  engagementBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DE911D',
  },
  engagementText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#736C62',
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    minHeight: 46,
    borderTopWidth: 1,
    borderTopColor: '#EFE7DB',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },
  actionButtonPressed: {
    backgroundColor: '#F8F5EF',
  },
  actionText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: '#736C62',
  },
  actionTextActive: {
    color: '#DE911D',
  },
});

/**
 * Notifications Screen — Full-screen notification list.
 *
 * Design spec: Section 7.10 (Social Notifications Page), matches 8. Social Notifications.jpg.
 *
 * Features:
 *   - Grouped by time period (Today, This Week, Earlier)
 *   - Unread indicator (gold dot)
 *   - Mark-all-read button
 *   - Individual mark-read on tap
 *   - Property thumbnail + actor avatar overlay
 */

import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/src/components/ui/Icon';
import type { NotificationEventType } from '@huishype/shared';
import {
  useNotifications,
  useMarkAllRead,
  useMarkNotificationRead,
  type NotificationItem,
} from '@/src/hooks/useNotifications';
import { fetchPropertyById } from '@/src/hooks/useProperties';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';
import { buildUserProfileRoute } from '@/src/utils/user-route';
import { useT, type TranslationKey } from '@/src/i18n';

// --- Time grouping ---

type TimeGroup = 'today' | 'thisWeek' | 'earlier';

const TIME_GROUP_LABEL_KEYS: Record<TimeGroup, TranslationKey> = {
  today: 'notifications.group.today',
  thisWeek: 'notifications.group.thisWeek',
  earlier: 'notifications.group.earlier',
};

function getTimeGroup(isoDate: string): TimeGroup {
  const now = new Date();
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays < 7) return 'thisWeek';
  return 'earlier';
}

function formatRelativeTime(
  isoDate: string,
  t: (key: TranslationKey, values?: Record<string, string | number | Date>) => string
): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t('time.hoursAgo', { count: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return t(weeks === 1 ? 'time.weekAgo' : 'time.weeksAgo', { count: weeks });
  }
  return new Date(isoDate).toLocaleDateString();
}

// --- Notification description ---

interface NotificationDescriptionContext {
  actorName: string;
  propertyAddress: string;
  payload: Record<string, unknown>;
}

const NOTIFICATION_DESCRIPTION_BUILDERS: Record<
  NotificationEventType,
  (context: NotificationDescriptionContext, t: (key: TranslationKey, values?: Record<string, string | number | Date>) => string) => string
> = {
  property_comment: ({ actorName, propertyAddress }, t) =>
    t('notifications.description.propertyComment', { actor: actorName, property: propertyAddress }),
  comment_reply: ({ actorName, propertyAddress }, t) =>
    t('notifications.description.commentReply', { actor: actorName, property: propertyAddress }),
  comment_like: ({ actorName, propertyAddress }, t) =>
    t('notifications.description.commentLike', { actor: actorName, property: propertyAddress }),
  property_like: ({ actorName, propertyAddress }, t) =>
    t('notifications.description.propertyLike', { actor: actorName, property: propertyAddress }),
  property_guess: ({ actorName, propertyAddress }, t) =>
    t('notifications.description.propertyGuess', { actor: actorName, property: propertyAddress }),
  new_follower: ({ actorName }, t) =>
    t('notifications.description.newFollower', { actor: actorName }),
  achievement_unlocked: ({ payload }, t) => {
    const achievementName =
      typeof payload.achievementName === 'string' ? payload.achievementName : null;
    return t('notifications.description.achievementUnlocked', {
      achievement: achievementName ?? t('notifications.achievementFallback'),
    });
  },
};

function getNotificationDescription(
  item: NotificationItem,
  t: (key: TranslationKey, values?: Record<string, string | number | Date>) => string
): string {
  const actorName = item.actor?.displayName ?? t('notifications.actorSomeone');
  const payload = item.payload as Record<string, unknown>;
  const propertyAddress =
    typeof payload.propertyAddress === 'string'
      ? payload.propertyAddress
      : t('notifications.propertyFallback');

  return NOTIFICATION_DESCRIPTION_BUILDERS[item.eventType]({
    actorName,
    propertyAddress,
    payload,
  }, t);
}

// --- List item types ---

type ListItem =
  | { type: 'header'; title: TimeGroup; id: string }
  | { type: 'notification'; data: NotificationItem; id: string };

// --- Component ---

export default function NotificationsScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNotifications();

  const markAllRead = useMarkAllRead();
  const markOneRead = useMarkNotificationRead();

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Group notifications by time period
  const listItems = useMemo<ListItem[]>(() => {
    if (!data?.pages) return [];
    const allNotifications = data.pages.flatMap((page) => page.items);

    const groups = new Map<TimeGroup, NotificationItem[]>();
    const groupOrder: TimeGroup[] = ['today', 'thisWeek', 'earlier'];

    for (const n of allNotifications) {
      const group = getTimeGroup(n.createdAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(n);
    }

    const items: ListItem[] = [];
    for (const group of groupOrder) {
      const notifications = groups.get(group);
      if (notifications && notifications.length > 0) {
        items.push({ type: 'header', title: group, id: `header-${group}` });
        for (const n of notifications) {
          items.push({ type: 'notification', data: n, id: n.id });
        }
      }
    }

    return items;
  }, [data]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleNotificationPress = useCallback(
    async (notification: NotificationItem) => {
      // Mark as read
      if (!notification.readAt) {
        markOneRead.mutate(notification.id);
      }
      if (notification.propertyId) {
        const property = await fetchPropertyById(notification.propertyId);
        if (property) {
          router.push(
            toInternalAppHref(buildPropertyRoute(property, '/notifications')),
          );
        }
        return;
      }

      if (notification.actor?.handle) {
        router.push(buildUserProfileRoute(notification.actor.handle));
      }
    },
    [markOneRead]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{t(TIME_GROUP_LABEL_KEYS[item.title])}</Text>
          </View>
        );
      }

      const notification = item.data;
      const isUnread = !notification.readAt;
      const payload = notification.payload as Record<string, unknown>;
      const thumbnailUrl =
        typeof payload.thumbnailUrl === 'string' ? payload.thumbnailUrl : null;

      return (
        <Pressable
          style={[
            styles.notificationRow,
            isUnread && styles.notificationRowUnread,
          ]}
          onPress={() => handleNotificationPress(notification)}
          testID={`notification-${notification.id}`}
        >
          {/* Thumbnail with event icon overlay */}
          <View style={styles.thumbnailContainer}>
            {thumbnailUrl ? (
              <Image
                source={{ uri: thumbnailUrl }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                <Icon name="HouseLine" size="md" color="#C7BFB3" />
              </View>
            )}
            {notification.actor?.profilePhotoUrl && (
              <Image
                source={{ uri: notification.actor.profilePhotoUrl }}
                style={styles.actorOverlay}
              />
            )}
          </View>

          {/* Content */}
          <View style={styles.notificationContent}>
            <Text style={styles.notificationText} numberOfLines={2}>
              {getNotificationDescription(notification, t)}
            </Text>
            <Text style={styles.notificationTime}>
              {formatRelativeTime(notification.createdAt, t)}
            </Text>
          </View>

          {/* Unread indicator */}
          {isUnread && <View style={styles.unreadDot} />}
        </Pressable>
      );
    },
    [handleNotificationPress, t]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // Not authenticated
  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Icon name="ArrowLeft" size="lg" color="#2D2926" />
          </Pressable>
          <Text style={styles.headerTitle}>{t('common.notifications')}</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="2xl" color="#C7BFB3" />
          <Text style={styles.emptyText}>
            {t('notifications.auth')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Icon name="ArrowLeft" size="lg" color="#2D2926" />
        </Pressable>
        <Text style={styles.headerTitle}>{t('common.notifications')}</Text>
        <Pressable
          onPress={() => markAllRead.mutate()}
          hitSlop={8}
          testID="mark-all-read"
        >
          <Text style={styles.markAllRead}>{t('notifications.markAllRead')}</Text>
        </Pressable>
      </View>

      {/* Notification list */}
      {isLoading && !isRefreshing ? (
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="xl" color="#DE911D" />
          <Text style={styles.emptyText}>{t('notifications.loading')}</Text>
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="2xl" color="#C7BFB3" />
          <Text style={styles.emptyTitle}>{t('notifications.empty.title')}</Text>
          <Text style={styles.emptyText}>
            {t('notifications.empty.body')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#DE911D"
              colors={['#DE911D']}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          testID="notifications-list"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5', // warm-50
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2D2926',
    letterSpacing: -0.5,
  },
  markAllRead: {
    fontSize: 14,
    fontWeight: '500',
    color: '#B47712', // gold-700
  },

  // Section headers
  sectionHeader: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9C958A', // warm-500
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Notification row
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 12,
  },
  notificationRowUnread: {
    backgroundColor: '#FFF8F0', // warm-100
  },
  thumbnailContainer: {
    position: 'relative',
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailPlaceholder: {
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actorOverlay: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  notificationContent: {
    flex: 1,
  },
  notificationText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3D3832', // warm-800
    lineHeight: 19,
  },
  notificationTime: {
    fontSize: 12,
    color: '#C7BFB3', // warm-400
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F5A623', // gold-500
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D2926',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#9C958A',
    textAlign: 'center',
    marginTop: 8,
  },
});

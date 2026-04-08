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
import {
  useNotifications,
  useMarkAllRead,
  useMarkNotificationRead,
  type NotificationItem,
} from '@/src/hooks/useNotifications';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { buildPropertyRoute } from '@/src/utils/property-route';

// --- Time grouping ---

type TimeGroup = 'Today' | 'This Week' | 'Earlier';

function getTimeGroup(isoDate: string): TimeGroup {
  const now = new Date();
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays < 7) return 'This Week';
  return 'Earlier';
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
  return new Date(isoDate).toLocaleDateString();
}

// --- Notification description ---

function getNotificationDescription(item: NotificationItem): string {
  const actorName = item.actor?.displayName ?? 'Someone';
  const payload = item.payload as Record<string, string>;
  const propertyAddress = payload?.propertyAddress ?? 'a property';

  switch (item.eventType) {
    case 'comment_like':
      return `${actorName} liked your comment on ${propertyAddress}`;
    case 'new_comment':
      return payload?.count
        ? `${payload.count} new comments on ${propertyAddress}`
        : `${actorName} commented on ${propertyAddress}`;
    case 'price_guess':
      return `${actorName} guessed ${payload?.amount ?? ''} on your saved property`;
    case 'guess_liked':
      return payload?.count
        ? `${actorName} and ${Number(payload.count) - 1} others liked your price guess`
        : `${actorName} liked your price guess`;
    case 'reply':
      return `${actorName} replied to your comment on ${propertyAddress}`;
    case 'new_listing':
      return `New listing near your saved search: ${payload?.area ?? propertyAddress}`;
    case 'guess_result':
      return `Your price guess was closest! ${propertyAddress}`;
    default:
      return `${actorName} interacted with ${propertyAddress}`;
  }
}

// --- List item types ---

type ListItem =
  | { type: 'header'; title: TimeGroup; id: string }
  | { type: 'notification'; data: NotificationItem; id: string };

// --- Component ---

export default function NotificationsScreen() {
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
    const groupOrder: TimeGroup[] = ['Today', 'This Week', 'Earlier'];

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
    (notification: NotificationItem) => {
      // Mark as read
      if (!notification.readAt) {
        markOneRead.mutate(notification.id);
      }
      // Navigate to property if available
      if (notification.propertyId) {
        router.push(buildPropertyRoute(notification.propertyId, '/notifications'));
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
            <Text style={styles.sectionHeaderText}>{item.title}</Text>
          </View>
        );
      }

      const notification = item.data;
      const isUnread = !notification.readAt;
      const payload = notification.payload as Record<string, string>;

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
            {payload?.thumbnailUrl ? (
              <Image
                source={{ uri: payload.thumbnailUrl }}
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
              {getNotificationDescription(notification)}
            </Text>
            <Text style={styles.notificationTime}>
              {formatRelativeTime(notification.createdAt)}
            </Text>
          </View>

          {/* Unread indicator */}
          {isUnread && <View style={styles.unreadDot} />}
        </Pressable>
      );
    },
    [handleNotificationPress]
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
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="2xl" color="#C7BFB3" />
          <Text style={styles.emptyText}>
            Sign in to see your notifications
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
        <Text style={styles.headerTitle}>Notifications</Text>
        <Pressable
          onPress={() => markAllRead.mutate()}
          hitSlop={8}
          testID="mark-all-read"
        >
          <Text style={styles.markAllRead}>Mark all read</Text>
        </Pressable>
      </View>

      {/* Notification list */}
      {isLoading && !isRefreshing ? (
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="xl" color="#DE911D" />
          <Text style={styles.emptyText}>Loading notifications...</Text>
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="2xl" color="#C7BFB3" />
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyText}>
            Activity on your properties will show up here.
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

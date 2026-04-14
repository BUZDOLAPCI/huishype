import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import {
  useNotifications,
  useMarkAllRead,
  useMarkNotificationRead,
  type NotificationItem,
} from '@/src/hooks/useNotifications';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { buildPropertyRoute } from '@/src/utils/property-route';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  mergeStyles,
} from '../dom';
import { colors } from '../theme';

type TimeGroup = 'Today' | 'This Week' | 'Earlier';

function getTimeGroup(isoDate: string): TimeGroup {
  const now = new Date();
  const then = new Date(isoDate);
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
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

type ListItem =
  | { type: 'header'; title: TimeGroup; id: string }
  | { type: 'notification'; data: NotificationItem; id: string };

export function NotificationsRoute() {
  const navigate = useNavigate();
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const listItems = useMemo<ListItem[]>(() => {
    if (!data?.pages) return [];
    const allNotifications = data.pages.flatMap((page) => page.items);
    const groups = new Map<TimeGroup, NotificationItem[]>();
    const order: TimeGroup[] = ['Today', 'This Week', 'Earlier'];

    for (const notification of allNotifications) {
      const group = getTimeGroup(notification.createdAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(notification);
    }

    const items: ListItem[] = [];
    for (const group of order) {
      const notifications = groups.get(group);
      if (notifications && notifications.length > 0) {
        items.push({ type: 'header', title: group, id: `header-${group}` });
        for (const notification of notifications) {
          items.push({ type: 'notification', data: notification, id: notification.id });
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
      if (!notification.readAt) {
        markOneRead.mutate(notification.id);
      }
      if (notification.propertyId) {
        navigate(buildPropertyRoute(notification.propertyId, '/notifications'));
      }
    },
    [markOneRead, navigate],
  );

  if (!user) {
    return (
      <View style={mergeStyles(styles.container, { paddingTop: 16 })}>
        <View style={styles.header}>
          <Pressable onPress={() => navigate(-1)} hitSlop={8}>
            <Icon name="ArrowLeft" size="lg" color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="2xl" color={colors.textSoft} />
          <Text style={styles.emptyText}>Sign in to see your notifications</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={mergeStyles(styles.container, { paddingTop: 16 })}>
      <View style={styles.header}>
        <Pressable onPress={() => navigate(-1)} hitSlop={8}>
          <Icon name="ArrowLeft" size="lg" color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Button
          label="Mark all"
          variant="ghost"
          size="sm"
          onPress={() => markAllRead.mutate()}
        />
      </View>

      {isLoading && !isRefreshing ? (
        <View style={styles.emptyContainer}>
          <Icon name="Bell" size="xl" color={colors.goldDeep} />
          <Text style={styles.emptyText}>Loading notifications...</Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.goldDeep}
              colors={[colors.goldDeep]}
            />
          }
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <View style={styles.footerSpacer} /> : null}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionHeader}>{item.title}</Text>;
            }

            const notification = item.data;
            const isUnread = !notification.readAt;
            const payload = notification.payload as Record<string, string>;

            return (
              <Pressable
                style={mergeStyles(styles.notificationRow, isUnread ? styles.notificationRowUnread : null)}
                onPress={() => handleNotificationPress(notification)}
                testID={`notification-${notification.id}`}
              >
                <View style={styles.thumbnailContainer}>
                  {payload?.thumbnailUrl ? (
                    <Image source={{ uri: payload.thumbnailUrl }} style={styles.thumbnail} resizeMode="cover" />
                  ) : (
                    <View style={mergeStyles(styles.thumbnail, styles.thumbnailPlaceholder)}>
                      <Icon name="HouseLine" size="md" color={colors.textSoft} />
                    </View>
                  )}
                  {notification.actor?.profilePhotoUrl ? (
                    <Image source={{ uri: notification.actor.profilePhotoUrl }} style={styles.actorOverlay} />
                  ) : null}
                </View>
                <View style={styles.notificationContent}>
                  <Text style={styles.notificationText} numberOfLines={2}>{getNotificationDescription(notification)}</Text>
                  <Text style={styles.notificationTime}>{formatRelativeTime(notification.createdAt)}</Text>
                </View>
                {isUnread ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    marginTop: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  sectionHeader: {
    paddingTop: 14,
    paddingBottom: 10,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSoft,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  notificationRowUnread: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbnailContainer: {
    width: 56,
    height: 56,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  thumbnailPlaceholder: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actorOverlay: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  notificationContent: {
    flex: 1,
    gap: 4,
  },
  notificationText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  notificationTime: {
    color: colors.textMuted,
    fontSize: 12,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.gold,
  },
  footerSpacer: {
    height: 24,
  },
});

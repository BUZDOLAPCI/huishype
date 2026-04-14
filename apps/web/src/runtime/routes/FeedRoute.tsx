import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  ActivityFeedCard,
  FeedEmptyState,
  FeedErrorState,
  FeedFilterChips,
  FeedLoadingState,
  FeedLoadingMore,
  PropertyFeedCard,
} from '@/src/components';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Icon } from '@/src/components/ui/Icon';
import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import {
  useActivityFeed,
  useInfiniteFeed,
  type ActivityItem,
  type FeedProperty,
  type FeedTab,
  type PropertyFeedFilter,
} from '@/src/hooks';
import { buildPropertyRoute } from '@/src/utils/property-route';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from '../dom';
import { colors } from '../theme';

const FILTER_TITLES: Record<FeedTab, string> = {
  trending: 'Trending Properties',
  latest: 'Latest Properties',
  'recent-activity': 'Recent Activity',
};

export function FeedRoute() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FeedTab>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: unreadCount } = useUnreadNotificationCount();

  const headerRightAction = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Pressable
          onPress={() => navigate('/leaderboard')}
          hitSlop={8}
          style={styles.headerIconButton}
          accessibilityRole="button"
          accessibilityLabel="Leaderboard"
        >
          <Icon name="Trophy" size="lg" weight="regular" color="#504A42" />
        </Pressable>
        <NotificationBell
          unreadCount={unreadCount ?? 0}
          onPress={() => navigate('/notifications')}
        />
      </View>
    ),
    [navigate, unreadCount],
  );

  const isPropertyFeed = activeFilter !== 'recent-activity';
  const propertyFeedFilter: PropertyFeedFilter =
    activeFilter === 'latest' ? 'latest' : 'trending';

  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? propertyFeedFilter : 'trending',
  );
  const activityQuery = useActivityFeed();
  const activeQuery = isPropertyFeed ? feedQuery : activityQuery;

  const properties = useMemo(() => {
    if (!isPropertyFeed || !feedQuery.data?.pages) return [];
    return feedQuery.data.pages.flatMap((page) => page.properties);
  }, [feedQuery.data, isPropertyFeed]);

  const activities = useMemo(() => {
    if (isPropertyFeed || !activityQuery.data?.pages) return [];
    return activityQuery.data.pages.flatMap((page) => page.items);
  }, [activityQuery.data, isPropertyFeed]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await activeQuery.refetch();
    setIsRefreshing(false);
  }, [activeQuery]);

  const handlePropertyPress = useCallback(
    (propertyId: string) => navigate(buildPropertyRoute(propertyId, '/feed')),
    [navigate],
  );

  const handleLoadMore = useCallback(() => {
    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
      activeQuery.fetchNextPage();
    }
  }, [activeQuery]);

  const renderPropertyItem = useCallback(
    ({ item }: { item: FeedProperty }) => (
      <PropertyFeedCard
        id={item.id}
        address={item.address}
        city={item.city}
        postalCode={item.postalCode}
        countryCode={item.countryCode}
        thumbnailUrl={item.thumbnailUrl}
        aerialImageUrl={item.aerialImageUrl}
        officialValuation={item.officialValuation}
        askingPrice={item.askingPrice ?? undefined}
        fmvValue={item.fmvValue}
        activityLevel={item.activityLevel}
        likeCount={item.likeCount}
        commentCount={item.commentCount}
        guessCount={item.guessCount}
        viewCount={item.viewCount}
        yearBuilt={item.yearBuilt}
        floorAreaM2={item.floorAreaM2}
        onPress={() => handlePropertyPress(item.id)}
      />
    ),
    [handlePropertyPress],
  );

  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityItem }) => (
      <ActivityFeedCard
        id={item.id}
        eventType={item.eventType}
        actor={item.actor}
        property={item.property}
        createdAt={item.createdAt}
        onPress={() => handlePropertyPress(item.property.id)}
      />
    ),
    [handlePropertyPress],
  );

  if (activeQuery.isLoading && !isRefreshing) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips activeFilter={activeFilter} onFilterChange={setActiveFilter} />
        <FeedLoadingState />
      </View>
    );
  }

  if (activeQuery.isError) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips activeFilter={activeFilter} onFilterChange={setActiveFilter} />
        <FeedErrorState
          message={activeQuery.error?.message || 'Failed to load feed'}
          onRetry={activeQuery.refetch}
        />
      </View>
    );
  }

  const isEmpty = isPropertyFeed ? properties.length === 0 : activities.length === 0;
  if (isEmpty) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips activeFilter={activeFilter} onFilterChange={setActiveFilter} />
        <FeedEmptyState filter={activeFilter} />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="feed-screen">
      <View style={styles.listShell}>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        {isPropertyFeed ? (
          <FlatList
            data={properties}
            keyExtractor={(item) => item.id}
            renderItem={renderPropertyItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={colors.goldDeep}
                colors={[colors.goldDeep]}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={activeQuery.isFetchingNextPage ? <FeedLoadingMore /> : null}
            showsVerticalScrollIndicator={false}
            testID="feed-list"
          />
        ) : (
          <FlatList
            data={activities}
            keyExtractor={(item) => item.id}
            renderItem={renderActivityItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={colors.goldDeep}
                colors={[colors.goldDeep]}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={activeQuery.isFetchingNextPage ? <FeedLoadingMore /> : null}
            showsVerticalScrollIndicator={false}
            testID="activity-feed-list"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listShell: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 768,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 96,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

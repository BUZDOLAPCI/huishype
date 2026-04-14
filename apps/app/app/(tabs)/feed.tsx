/**
 * Feed Screen — Browse properties with Trending, Latest, and Recent Activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity uses the /activity endpoint via useActivityFeed.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';

import {
  ActivityFeedCard,
  FeedEmptyState,
  FeedErrorState,
  FeedFilterChips,
  FeedLoadingState,
  FeedLoadingMore,
  PropertyFeedCard,
} from '@/src/components';
import {
  useInfiniteFeed,
  useActivityFeed,
  type FeedTab,
  type PropertyFeedFilter,
  type FeedProperty,
  type ActivityItem,
} from '@/src/hooks';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Icon } from '@/src/components/ui/Icon';
import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import {
  buildPropertyRoute,
  toInternalAppHref,
  type PropertyRouteAddressLike,
} from '@/src/utils/property-route';

// --- Header title per filter ---

const FILTER_TITLES: Record<FeedTab, string> = {
  trending: 'Trending Properties',
  latest: 'Latest Properties',
  'recent-activity': 'Recent Activity',
};

export default function FeedScreen() {
  const [activeFilter, setActiveFilter] = useState<FeedTab>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: unreadCount } = useUnreadNotificationCount();

  const headerRightAction = useMemo(
    () => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable
          onPress={() => router.push('/leaderboard')}
          hitSlop={8}
          testID="feed-leaderboard-button"
          accessibilityRole="button"
          accessibilityLabel="Leaderboard"
          accessibilityHint="Opens the community leaderboard"
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="Trophy" size="lg" weight="regular" color="#504A42" />
        </Pressable>
        <NotificationBell
          unreadCount={unreadCount ?? 0}
          onPress={() => router.push('/notifications')}
        />
      </View>
    ),
    [unreadCount]
  );

  // Property feed (trending/latest)
  const isPropertyFeed = activeFilter !== 'recent-activity';
  const propertyFeedFilter: PropertyFeedFilter =
    activeFilter === 'latest' ? 'latest' : 'trending';
  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? propertyFeedFilter : 'trending'
  );

  // Activity feed
  const activityQuery = useActivityFeed();

  const properties = useMemo(() => {
    if (!isPropertyFeed) return [];
    if (!feedQuery.data?.pages) return [];
    return feedQuery.data.pages.flatMap((page) => page.properties);
  }, [feedQuery.data, isPropertyFeed]);

  const activities = useMemo(() => {
    if (isPropertyFeed) return [];
    if (!activityQuery.data?.pages) return [];
    return activityQuery.data.pages.flatMap((page) => page.items);
  }, [activityQuery.data, isPropertyFeed]);

  const activeQuery = isPropertyFeed ? feedQuery : activityQuery;

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await activeQuery.refetch();
    setIsRefreshing(false);
  }, [activeQuery]);

  const handleFilterChange = useCallback((filter: FeedTab) => {
    setActiveFilter(filter);
  }, []);

  const handlePropertyPress = useCallback((property: PropertyRouteAddressLike) => {
    router.push(toInternalAppHref(buildPropertyRoute(property, '/feed')));
  }, []);

  const handleLoadMore = useCallback(() => {
    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
      activeQuery.fetchNextPage();
    }
  }, [activeQuery]);

  // --- Property feed render ---

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
        onPress={() => handlePropertyPress(item)}
      />
    ),
    [handlePropertyPress]
  );

  // --- Activity feed render ---

  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityItem }) => (
      <ActivityFeedCard
        id={item.id}
        eventType={item.eventType}
        actor={item.actor}
        property={item.property}
        createdAt={item.createdAt}
        onPress={() => handlePropertyPress(item.property)}
      />
    ),
    [handlePropertyPress]
  );

  const propertyKeyExtractor = useCallback(
    (item: FeedProperty) => item.id,
    []
  );
  const activityKeyExtractor = useCallback(
    (item: ActivityItem) => item.id,
    []
  );

  const ListFooterComponent = useCallback(() => {
    if (activeQuery.isFetchingNextPage) {
      return <FeedLoadingMore />;
    }
    return null;
  }, [activeQuery.isFetchingNextPage]);

  const refreshControl = (
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      tintColor="#DE911D"
      colors={['#DE911D']}
    />
  );

  // Loading state
  if (activeQuery.isLoading && !isRefreshing) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedLoadingState />
      </View>
    );
  }

  // Error state
  if (activeQuery.isError) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedErrorState
          message={activeQuery.error?.message || 'Failed to load'}
          onRetry={activeQuery.refetch}
        />
      </View>
    );
  }

  // Empty state
  const isEmpty = isPropertyFeed
    ? properties.length === 0
    : activities.length === 0;

  if (isEmpty) {
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedEmptyState filter={activeFilter} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-warm-50 items-center" testID="feed-screen">
      <View style={{ width: '100%', maxWidth: 768, flex: 1 }}>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />

        {isPropertyFeed ? (
          <FlatList
            data={properties}
            keyExtractor={propertyKeyExtractor}
            renderItem={renderPropertyItem}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 96 }}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            testID="feed-list"
          />
        ) : (
          <FlatList
            data={activities}
            keyExtractor={activityKeyExtractor}
            renderItem={renderActivityItem}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 96 }}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            testID="activity-feed-list"
          />
        )}
      </View>
    </View>
  );
}

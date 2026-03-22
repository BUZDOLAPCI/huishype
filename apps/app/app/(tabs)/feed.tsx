/**
 * Feed Screen — Browse properties with Trending, Latest, and Recent Activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity uses the /activity endpoint via useActivityFeed.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
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
  type FeedFilter,
  type FeedProperty,
  type ActivityItem,
} from '@/src/hooks';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';

// --- Header title per filter ---

const FILTER_TITLES: Record<FeedFilter, string> = {
  trending: 'Trending Properties',
  recent: 'Latest Properties',
  activity: 'Recent Activity',
};

export default function FeedScreen() {
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Property feed (trending/recent)
  const isPropertyFeed = activeFilter !== 'activity';
  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? activeFilter : 'trending'
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

  const handleFilterChange = useCallback((filter: FeedFilter) => {
    setActiveFilter(filter);
  }, []);

  const handlePropertyPress = useCallback((propertyId: string) => {
    router.push(`/property/${propertyId}`);
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
        photoUrl={item.photoUrl}
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
        onPress={() => handlePropertyPress(item.property.id)}
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
        <ScreenHeader title={FILTER_TITLES[activeFilter]} />
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
        <ScreenHeader title={FILTER_TITLES[activeFilter]} />
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
        <ScreenHeader title={FILTER_TITLES[activeFilter]} />
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
        <ScreenHeader title={FILTER_TITLES[activeFilter]} />
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

import { FlatList, RefreshControl, View } from 'react-native';
import { useState, useCallback, useMemo } from 'react';
import { router } from 'expo-router';

import {
  FeedEmptyState,
  FeedErrorState,
  FeedFilterChips,
  FeedLoadingState,
  FeedLoadingMore,
  PropertyFeedCard,
} from '@/src/components';
import { useInfiniteFeed, type FeedFilter, type FeedProperty } from '@/src/hooks';

export default function FeedScreen() {
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteFeed(activeFilter);

  // Flatten paginated data into a single array
  const properties = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.properties);
  }, [data]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleFilterChange = useCallback((filter: FeedFilter) => {
    setActiveFilter(filter);
  }, []);

  const handlePropertyPress = useCallback((propertyId: string) => {
    router.push(`/property/${propertyId}`);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: FeedProperty }) => (
      <PropertyFeedCard
        id={item.id}
        address={item.address}
        city={item.city}
        postalCode={item.postalCode}
        photoUrl={item.photoUrl}
        wozValue={item.wozValue}
        askingPrice={item.askingPrice ?? undefined}
        fmvValue={item.fmvValue}
        activityLevel={item.activityLevel}
        commentCount={item.commentCount}
        guessCount={item.guessCount}
        viewCount={item.viewCount}
        bouwjaar={item.bouwjaar}
        oppervlakte={item.oppervlakte}
        coordinates={item.coordinates}
        onPress={() => handlePropertyPress(item.id)}
      />
    ),
    [handlePropertyPress]
  );

  const keyExtractor = useCallback((item: FeedProperty) => item.id, []);

  const ListFooterComponent = useCallback(() => {
    if (isFetchingNextPage) {
      return <FeedLoadingMore />;
    }
    return null;
  }, [isFetchingNextPage]);

  // Loading state
  if (isLoading && !isRefreshing) {
    return (
      <View className="flex-1 bg-gray-50">
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedLoadingState />
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View className="flex-1 bg-gray-50">
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedErrorState
          message={error?.message || 'Failed to load properties'}
          onRetry={refetch}
        />
      </View>
    );
  }

  // Empty state
  if (properties.length === 0) {
    return (
      <View className="flex-1 bg-gray-50">
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedEmptyState filter={activeFilter} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50" testID="feed-screen">
      <FeedFilterChips
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
      />
      <FlatList
        data={properties}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#2563eb"
            colors={['#2563eb']}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={ListFooterComponent}
        showsVerticalScrollIndicator={false}
        testID="feed-list"
      />
    </View>
  );
}

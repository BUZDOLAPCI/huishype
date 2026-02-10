import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useState, useCallback, useMemo } from 'react';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { PropertyFeedCard, FeedLoadingMore } from '@/src/components';
import { useSavedProperties } from '@/src/hooks/useSavedProperties';
import { useAuthContext } from '@/src/providers/AuthProvider';
import type { FeedProperty } from '@/src/hooks';

export default function SavedScreen() {
  const { user } = useAuthContext();
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
  } = useSavedProperties();

  const properties = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.properties);
  }, [data]);

  const totalCount = data?.pages[0]?.total ?? 0;

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

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
        askingPrice={item.askingPrice}
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

  // Not logged in state
  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6" testID="saved-auth-required">
        <View className="bg-blue-100 p-5 rounded-full mb-4">
          <FontAwesome name="bookmark" size={48} color="#2563eb" />
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          Sign in to see your saved properties
        </Text>
        <Text className="text-gray-500 text-center">
          Save properties while browsing the map and find them all here.
        </Text>
      </View>
    );
  }

  // Loading state
  if (isLoading && !isRefreshing) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50" testID="saved-loading">
        <View className="items-center">
          <FontAwesome name="bookmark" size={32} color="#2563eb" />
          <Text className="text-gray-500 mt-4">Loading saved properties...</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6" testID="saved-error">
        <View className="bg-red-100 p-4 rounded-full mb-4">
          <FontAwesome name="exclamation-circle" size={48} color="#EF4444" />
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          Oops!
        </Text>
        <Text className="text-gray-500 text-center mb-6">
          {error?.message || 'Failed to load saved properties'}
        </Text>
        <Pressable
          onPress={() => refetch()}
          className="bg-primary-600 px-6 py-3 rounded-full flex-row items-center"
          testID="saved-retry-button"
        >
          <FontAwesome name="refresh" size={14} color="white" />
          <Text className="text-white font-semibold ml-2">Try Again</Text>
        </Pressable>
      </View>
    );
  }

  // Empty state
  if (properties.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6" testID="saved-empty">
        <View className="bg-gray-200 p-5 rounded-full mb-4">
          <FontAwesome name="bookmark-o" size={48} color="#9CA3AF" />
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          No saved properties yet
        </Text>
        <Text className="text-gray-500 text-center">
          Browse the map and tap the bookmark icon to save properties you're interested in.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50" testID="saved-screen">
      {/* Header count */}
      <View className="px-4 py-3 bg-white border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          {totalCount} {totalCount === 1 ? 'property' : 'properties'} saved
        </Text>
      </View>

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
        testID="saved-list"
      />
    </View>
  );
}

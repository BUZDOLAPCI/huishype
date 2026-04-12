/**
 * Saved Screen — Displays the user's saved properties.
 *
 * Uses the same card system as the feed. Shows auth CTA for
 * unauthenticated users and an empty state for no saved properties.
 *
 * Design spec: matches 6. Saved Screen.jpg.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { PropertyFeedCard, FeedLoadingMore, AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { useSavedProperties } from '@/src/hooks/useSavedProperties';
import { useAuthContext } from '@/src/providers/AuthProvider';
import type { FeedProperty } from '@/src/hooks';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';
import { primePropertyDetailCache } from '@/src/utils/property-detail-cache';
import { api } from '@/src/utils/api';
import type { PropertyDetails } from '@/src/hooks/useProperties';

export default function SavedScreen() {
  const { user } = useAuthContext();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const queryClient = useQueryClient();

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

  const handlePropertyPress = useCallback(async (propertyId: string) => {
    try {
      const property = await api.get<PropertyDetails>(`/properties/${propertyId}`);
      primePropertyDetailCache(queryClient, property);
      router.push(toInternalAppHref(buildPropertyRoute(property, '/saved')));
    } catch (error) {
      console.error('Failed to resolve canonical property route from saved:', error);
    }
  }, [queryClient]);

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
        countryCode={item.countryCode}
        thumbnailUrl={item.thumbnailUrl}
        aerialImageUrl={item.aerialImageUrl}
        officialValuation={item.officialValuation}
        askingPrice={item.askingPrice ?? undefined}
        fmvValue={item.fmvValue}
        activityLevel={item.activityLevel}
        commentCount={item.commentCount}
        guessCount={item.guessCount}
        viewCount={item.viewCount}
        yearBuilt={item.yearBuilt}
        floorAreaM2={item.floorAreaM2}
        onPress={() => {
          void handlePropertyPress(item.id);
        }}
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

  // --- Not logged in state ---
  if (!user) {
    return (
      <View
        className="flex-1 bg-warm-50"
        testID="saved-auth-required"
        pointerEvents="box-none"
      >
        <ScreenHeader title="Saved Properties" />
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-primary-100 p-5 rounded-full mb-4">
            <Icon name="BookmarkSimple" size="2xl" color="#DE911D" />
          </View>
          <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
            Sign in to see your saved properties
          </Text>
          <Text className="text-warm-600 text-center mb-6">
            Save properties while browsing the map and find them all here.
          </Text>
          <Button
            label="Sign In"
            onPress={() => setShowAuth(true)}
            style={{ alignSelf: 'stretch', marginHorizontal: 24 }}
            testID="saved-sign-in-button"
          />
          <AuthModal
            visible={showAuth}
            onClose={() => setShowAuth(false)}
            message="Sign in to HuisHype"
            onSuccess={() => setShowAuth(false)}
          />
        </View>
      </View>
    );
  }

  // --- Loading state ---
  if (isLoading && !isRefreshing) {
    return (
      <View className="flex-1 bg-warm-50" testID="saved-loading">
        <ScreenHeader title="Saved Properties" />
        <View className="flex-1 items-center justify-center">
          <View className="items-center">
            <Icon name="BookmarkSimple" size="xl" color="#DE911D" />
            <Text className="text-warm-600 mt-4">
              Loading saved properties...
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <View className="flex-1 bg-warm-50" testID="saved-error">
        <ScreenHeader title="Saved Properties" />
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-error-red-50 p-4 rounded-full mb-4">
            <Icon name="WarningCircle" size="2xl" color="#E53935" />
          </View>
          <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
            Oops!
          </Text>
          <Text className="text-warm-600 text-center mb-6">
            {error?.message || 'Failed to load saved properties'}
          </Text>
          <Button
            label="Try Again"
            onPress={() => refetch()}
            style={{ paddingHorizontal: 24 }}
            testID="saved-retry-button"
          />
        </View>
      </View>
    );
  }

  // --- Empty state ---
  if (properties.length === 0) {
    return (
      <View className="flex-1 bg-warm-50" testID="saved-empty">
        <ScreenHeader title="Saved Properties" />
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-warm-200 p-5 rounded-full mb-4">
            <Icon name="BookmarkSimple" size="2xl" color="#C7BFB3" />
          </View>
          <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
            No saved properties yet
          </Text>
          <Text className="text-warm-600 text-center">
            Browse the map and tap the bookmark icon to save properties you are
            interested in.
          </Text>
        </View>
      </View>
    );
  }

  // --- Main list ---
  return (
    <View className="flex-1 bg-warm-50 items-center" testID="saved-screen">
      <View style={{ width: '100%', maxWidth: 768, flex: 1 }}>
        <ScreenHeader title="Saved Properties" />

        {/* Header count */}
        <View className="px-5 pb-2">
          <Text className="text-sm text-warm-600">
            {totalCount} {totalCount === 1 ? 'property' : 'properties'} saved
          </Text>
        </View>

        <FlatList
          data={properties}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 96 }}
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
          ListFooterComponent={ListFooterComponent}
          showsVerticalScrollIndicator={false}
          testID="saved-list"
        />
      </View>
    </View>
  );
}

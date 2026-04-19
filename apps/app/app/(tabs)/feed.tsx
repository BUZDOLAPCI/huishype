/**
 * Feed Screen — Browse properties with Trending, Latest, and Recent Activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity uses the /activity endpoint via useActivityFeed.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { isValidCountryCode } from '@huishype/shared/config';

import {
  ActivityFeedCard,
  AuthModal,
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
  useMyProfile,
  type FeedTab,
  type PropertyFeedFilter,
  type FeedProperty,
  type ActivityItem,
} from '@/src/hooks';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Icon } from '@/src/components/ui/Icon';
import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { emitSocialFollowAnalyticsEvent } from '@/src/hooks/useUserProfile';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { getDefaultCenter } from '@/src/lib/mapDefaults';
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
  following: 'Following',
};

export default function FeedScreen() {
  const { isAuthenticated } = useAuthContext();
  const { data: profile } = useMyProfile();
  const [activeFilter, setActiveFilter] = useState<FeedTab>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const { data: unreadCount } = useUnreadNotificationCount();
  const trackedFollowingEmptyViewRef = useRef(false);

  const feedCountryCode = useMemo(() => {
    const candidate = profile?.homeCountry?.toUpperCase();
    return candidate && isValidCountryCode(candidate) ? candidate : 'NL';
  }, [profile?.homeCountry]);

  const feedScope = useMemo(() => {
    const [lon, lat] = getDefaultCenter(feedCountryCode);
    return {
      country: feedCountryCode,
      lat,
      lon,
    };
  }, [feedCountryCode]);

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
  const isPropertyFeed = activeFilter === 'trending' || activeFilter === 'latest';
  const activityScope = activeFilter === 'following' ? 'following' : 'public';
  const propertyFeedFilter: PropertyFeedFilter =
    activeFilter === 'latest' ? 'latest' : 'trending';
  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? propertyFeedFilter : 'trending',
    feedScope,
  );

  // Activity feed
  const activityQuery = useActivityFeed(activityScope);

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

  useEffect(() => {
    if (activeFilter !== 'following' || !isAuthenticated) {
      trackedFollowingEmptyViewRef.current = false;
      return;
    }

    emitSocialFollowAnalyticsEvent('following_feed_opened', {});
  }, [activeFilter, isAuthenticated]);

  useEffect(() => {
    const shouldTrackFollowingEmpty =
      activeFilter === 'following' &&
      isAuthenticated &&
      !activityQuery.isLoading &&
      !activityQuery.isError &&
      activities.length === 0;

    if (!shouldTrackFollowingEmpty) {
      trackedFollowingEmptyViewRef.current = false;
      return;
    }

    if (trackedFollowingEmptyViewRef.current) {
      return;
    }

    trackedFollowingEmptyViewRef.current = true;
    emitSocialFollowAnalyticsEvent('following_feed_empty_viewed', {});
  }, [
    activeFilter,
    activities.length,
    activityQuery.isError,
    activityQuery.isLoading,
    isAuthenticated,
  ]);

  const activeQuery = isPropertyFeed ? feedQuery : activityQuery;

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await activeQuery.refetch();
    setIsRefreshing(false);
  }, [activeQuery]);

  const handleFilterChange = useCallback((filter: FeedTab) => {
    if (filter === 'following' && !isAuthenticated) {
      setShowAuth(true);
      return;
    }

    setActiveFilter(filter);
  }, [isAuthenticated]);

  const handlePropertyPress = useCallback((property: PropertyRouteAddressLike) => {
    router.push(toInternalAppHref(buildPropertyRoute(property, '/feed')));
  }, []);
  const handleActorPress = useCallback((actorId: string) => {
    router.push(`/user/${actorId}`);
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
        onPropertyPress={() => {
          if (activeFilter === 'following') {
            emitSocialFollowAnalyticsEvent('following_feed_item_clicked', {
              activityId: item.id,
              eventType: item.eventType,
              propertyId: item.property.id,
              target: 'property',
            });
          }

          handlePropertyPress(item.property);
        }}
        onActorPress={() => {
          if (activeFilter === 'following') {
            emitSocialFollowAnalyticsEvent('following_feed_item_clicked', {
              activityId: item.id,
              actorId: item.actor.id,
              eventType: item.eventType,
              target: 'actor',
            });
          }

          handleActorPress(item.actor.id);
        }}
      />
    ),
    [activeFilter, handleActorPress, handlePropertyPress]
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

  const authModal = (
    <AuthModal
      visible={showAuth}
      onClose={() => setShowAuth(false)}
      message="Sign in to see activity from people you follow"
      onSuccess={() => {
        setShowAuth(false);
        setActiveFilter('following');
      }}
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
        {authModal}
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
        {authModal}
      </View>
    );
  }

  // Empty state
  const isEmpty = isPropertyFeed
    ? properties.length === 0
    : activities.length === 0;

  if (isEmpty) {
    const signedInFollowing = activeFilter !== 'following' || isAuthenticated;
    return (
      <View className="flex-1 bg-warm-50">
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedEmptyState
          filter={activeFilter}
          signedIn={signedInFollowing}
          onPrimaryAction={
            activeFilter === 'following'
              ? () => {
                  if (signedInFollowing) {
                    setActiveFilter('recent-activity');
                    return;
                  }

                  setShowAuth(true);
                }
              : undefined
          }
        />
        {authModal}
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
      {authModal}
    </View>
  );
}

/**
 * Feed Screen — Browse properties with Trending, Latest, and grouped activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity and Following use grouped property posts from /activity/properties.
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
  type GroupedPropertyActivityItem,
} from '@/src/hooks';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { Icon } from '@/src/components/ui/Icon';
import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { emitSocialFollowAnalyticsEvent } from '@/src/hooks/useUserProfile';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { getDefaultCenter } from '@/src/lib/mapDefaults';
import { useBenchmarkRenderProbe } from '@/src/lib/benchmarkRenderProbe';
import {
  buildPropertyRoute,
  toInternalAppHref,
  type PropertyRouteAddressLike,
} from '@/src/utils/property-route';

const FEED_LIST_CONTENT_CONTAINER_STYLE = {
  paddingTop: 8,
  paddingBottom: 96,
};

const FEED_LIST_CONTAINER_STYLE = {
  width: '100%' as const,
  maxWidth: 768,
  flex: 1,
};

const FEED_LIST_WINDOW_SIZE = 5;
const FEED_LIST_INITIAL_NUM_TO_RENDER = 6;
const FEED_LIST_MAX_TO_RENDER_PER_BATCH = 4;
const FEED_LIST_BATCHING_PERIOD_MS = 50;

// --- Header title per filter ---

const FILTER_TITLES: Record<FeedTab, string> = {
  trending: 'Trending Properties',
  latest: 'Latest Properties',
  'recent-activity': 'Recent Activity',
  following: 'Following',
};

function FeedHeaderActions() {
  const { data: unreadCount } = useUnreadNotificationCount();

  return (
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
  );
}

export default function FeedScreen() {
  useBenchmarkRenderProbe('feed-screen');

  const { isAuthenticated } = useAuthContext();
  const { data: profile, isLoading: isProfileLoading } = useMyProfile();
  const [activeFilter, setActiveFilter] = useState<FeedTab>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const trackedFollowingEmptyViewRef = useRef(false);

  const feedCountryCode = useMemo(() => {
    const candidate = profile?.homeCountry?.toUpperCase();
    if (candidate && isValidCountryCode(candidate)) {
      return candidate;
    }

    if (isAuthenticated && isProfileLoading) {
      return null;
    }

    return 'NL';
  }, [isAuthenticated, isProfileLoading, profile?.homeCountry]);

  const feedScope = useMemo(() => {
    if (!feedCountryCode) {
      return undefined;
    }

    const [lon, lat] = getDefaultCenter(feedCountryCode);
    return {
      country: feedCountryCode,
      lat,
      lon,
    };
  }, [feedCountryCode]);

  const headerRightAction = useMemo(() => <FeedHeaderActions />, []);

  // Property feed (trending/latest)
  const isPropertyFeed = activeFilter === 'trending' || activeFilter === 'latest';
  const activityScope = activeFilter === 'following' ? 'following' : 'public';
  const propertyFeedFilter: PropertyFeedFilter =
    activeFilter === 'latest' ? 'latest' : 'trending';
  const isBootstrappingPropertyFeed = isPropertyFeed && !feedScope;
  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? propertyFeedFilter : 'trending',
    feedScope,
    isPropertyFeed && !!feedScope,
  );

  // Activity feed
  const activityQuery = useActivityFeed(activityScope, !isPropertyFeed);

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
    ({ item }: { item: GroupedPropertyActivityItem }) => (
      <ActivityFeedCard
        property={item.property}
        lastActivityAt={item.lastActivityAt}
        recentActors={item.recentActors}
        preview={item.preview}
        counts={item.counts}
        onPress={() => {
          if (activeFilter === 'following') {
            emitSocialFollowAnalyticsEvent('following_feed_post_clicked', {
              propertyId: item.property.id,
              likeCount: item.counts.likeCount,
              commentCount: item.counts.commentCount,
              guessCount: item.counts.guessCount,
              lastActivityAt: item.lastActivityAt,
              previewKind: item.preview.kind,
            });
          }

          handlePropertyPress(item.property);
        }}
      />
    ),
    [activeFilter, handlePropertyPress]
  );

  const propertyKeyExtractor = useCallback(
    (item: FeedProperty) => item.id,
    []
  );
  const activityKeyExtractor = useCallback(
    (item: GroupedPropertyActivityItem) => item.property.id,
    []
  );

  const ListFooterComponent = useCallback(() => {
    if (activeQuery.isFetchingNextPage) {
      return <FeedLoadingMore />;
    }
    return null;
  }, [activeQuery.isFetchingNextPage]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isRefreshing}
        onRefresh={onRefresh}
        tintColor="#DE911D"
        colors={['#DE911D']}
      />
    ),
    [isRefreshing, onRefresh]
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
  if ((isBootstrappingPropertyFeed || activeQuery.isLoading) && !isRefreshing) {
    return (
      <ScreenBackground>
        <ScreenHeader title={FILTER_TITLES[activeFilter]} rightAction={headerRightAction} />
        <FeedFilterChips
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
        <FeedLoadingState />
        {authModal}
      </ScreenBackground>
    );
  }

  // Error state
  if (activeQuery.isError) {
    return (
      <ScreenBackground>
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
      </ScreenBackground>
    );
  }

  // Empty state
  const isEmpty = isPropertyFeed
    ? properties.length === 0
    : activities.length === 0;

  if (isEmpty) {
    const signedInFollowing = activeFilter !== 'following' || isAuthenticated;
    return (
      <ScreenBackground>
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
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={{ alignItems: 'center' }} testID="feed-screen">
      <View style={FEED_LIST_CONTAINER_STYLE}>
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
            contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={FEED_LIST_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={FEED_LIST_MAX_TO_RENDER_PER_BATCH}
            updateCellsBatchingPeriod={FEED_LIST_BATCHING_PERIOD_MS}
            windowSize={FEED_LIST_WINDOW_SIZE}
            removeClippedSubviews
            testID="feed-list"
          />
        ) : (
          <FlatList
            data={activities}
            keyExtractor={activityKeyExtractor}
            renderItem={renderActivityItem}
            contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={FEED_LIST_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={FEED_LIST_MAX_TO_RENDER_PER_BATCH}
            updateCellsBatchingPeriod={FEED_LIST_BATCHING_PERIOD_MS}
            windowSize={FEED_LIST_WINDOW_SIZE}
            removeClippedSubviews
            testID="activity-feed-list"
          />
        )}
      </View>
      {authModal}
    </ScreenBackground>
  );
}

/**
 * Feed Screen — Browse properties with Trending, Latest, and grouped activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity and Following use grouped property posts from /activity/properties.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { serializeCanonicalCameraPath } from '@huishype/shared';
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
  SearchBar,
} from '@/src/components';
import { MapFilterBar } from '@/src/components/map/MapFilterBar';
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
import { useT, type TranslationKey } from '@/src/i18n';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { getDefaultCenter } from '@/src/lib/mapDefaults';
import { useBenchmarkRenderProbe } from '@/src/lib/benchmarkRenderProbe';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import {
  DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
  hasMapFilterQueryParams,
  parseMapFiltersFromSearchParams,
  serializeLocationFilterToken,
  type LocationFilterToken,
  type MapFilters,
} from '@/src/lib/sharedMapFilters';
import { useMapFilterController } from '@/src/hooks/useMapFilterController';
import { useMapSearchBias } from '@/src/hooks/useMapSearchBias';
import {
  appendSharedFeedFiltersToPath,
  buildFeedPath,
  isFeedBrowserPathname,
  parseFeedTabFromSearchParams,
} from '@/src/lib/feedUrlSync';
import { pushBrowserPath, replacePassiveBrowserPath } from '@/src/lib/webMapUrlSync';
import type { AddressSearchBias } from '@/src/services/address-resolver';
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

const FEED_LIST_WINDOW_SIZE = 3;
const FEED_LIST_INITIAL_NUM_TO_RENDER = 3;
const FEED_LIST_MAX_TO_RENDER_PER_BATCH = 2;
const FEED_LIST_BATCHING_PERIOD_MS = 100;
const FEED_DIRECT_ADDRESS_MAP_ZOOM = 17;

// --- Header title per filter ---

const FILTER_TITLE_KEYS: Record<FeedTab, TranslationKey> = {
  trending: 'feed.header.trending',
  latest: 'feed.header.latest',
  'recent-activity': 'feed.header.recentActivity',
  following: 'feed.header.following',
};

function FeedHeaderActions() {
  const { data: unreadCount } = useUnreadNotificationCount();
  const t = useT();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable
        onPress={() => router.push('/leaderboard')}
        hitSlop={8}
        testID="feed-leaderboard-button"
        accessibilityRole="button"
        accessibilityLabel={t('feed.action.leaderboard')}
        accessibilityHint={t('feed.action.leaderboardHint')}
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

  const t = useT();
  const { isAuthenticated } = useAuthContext();
  const isFeedTabActive = useIsFocused();
  const { data: profile, isLoading: isProfileLoading } = useMyProfile();
  const [activeFilter, setActiveFilter] = useState<FeedTab>('trending');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const activeFilterRef = useRef(activeFilter);
  activeFilterRef.current = activeFilter;
  const isFeedTabActiveRef = useRef(isFeedTabActive);
  isFeedTabActiveRef.current = isFeedTabActive;
  const feedBrowserSearchRef = useRef(
    typeof window === 'undefined' ? '' : window.location.search || ''
  );
  const canSyncFeedBrowserPath = useCallback(() => {
    if (!isFeedTabActiveRef.current || typeof window === 'undefined') {
      return false;
    }

    return isFeedBrowserPathname(window.location.pathname);
  }, []);
  const replaceFeedBrowserPath = useCallback((nextFilters: MapFilters, feedTab: FeedTab) => {
    if (!canSyncFeedBrowserPath()) {
      return false;
    }

    const currentSearch =
      typeof window === 'undefined' ? feedBrowserSearchRef.current : window.location.search || '';
    const nextPath = buildFeedPath(nextFilters, feedTab, currentSearch);
    const nextSearch = nextPath.includes('?') ? nextPath.slice(nextPath.indexOf('?')) : '';
    feedBrowserSearchRef.current = nextSearch;
    return replacePassiveBrowserPath(nextPath);
  }, [canSyncFeedBrowserPath]);
  const pushFeedBrowserPath = useCallback((nextFilters: MapFilters, feedTab: FeedTab) => {
    if (!canSyncFeedBrowserPath()) {
      return false;
    }

    const currentSearch =
      typeof window === 'undefined' ? feedBrowserSearchRef.current : window.location.search || '';
    const nextPath = buildFeedPath(nextFilters, feedTab, currentSearch);
    const nextSearch = nextPath.includes('?') ? nextPath.slice(nextPath.indexOf('?')) : '';
    feedBrowserSearchRef.current = nextSearch;
    return pushBrowserPath(nextPath);
  }, [canSyncFeedBrowserPath]);
  const handleAppliedFiltersChange = useCallback(
    (nextFilters: MapFilters) => {
      pushFeedBrowserPath(nextFilters, activeFilterRef.current);
    },
    [pushFeedBrowserPath]
  );
  const filterController = useMapFilterController({
    onAppliedFiltersChange: handleAppliedFiltersChange,
  });
  const { mapSearchBias } = useMapSearchBias();
  const trackedFollowingEmptyViewRef = useRef(false);
  const hasInteractedWithListRef = useRef(false);
  const appliedInitialFeedUrlRef = useRef(false);
  const [hydrationPropertyIds, setHydrationPropertyIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    if (!canSyncFeedBrowserPath()) {
      return;
    }

    if (!appliedInitialFeedUrlRef.current) {
      appliedInitialFeedUrlRef.current = true;
      if (typeof window === 'undefined') {
        return;
      }

      const initialSearchParams = new URLSearchParams(window.location.search);
      const nextTab = parseFeedTabFromSearchParams(initialSearchParams, { isAuthenticated });
      const hasInitialFilters = hasMapFilterQueryParams(initialSearchParams);
      const hasInitialFeedTab = initialSearchParams.has('feedTab');
      if (!hasInitialFilters && !hasInitialFeedTab) {
        return;
      }

      const nextFilters = hasInitialFilters
        ? parseMapFiltersFromSearchParams(initialSearchParams)
        : filterController.appliedFilters;

      if (nextTab !== activeFilter) {
        activeFilterRef.current = nextTab;
        setActiveFilter(nextTab);
      }
      if (hasInitialFilters) {
        filterController.replaceAppliedFilters(nextFilters);
      }
      replaceFeedBrowserPath(nextFilters, nextTab);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => replaceFeedBrowserPath(nextFilters, nextTab), 0);
      }
      return;
    }

    replaceFeedBrowserPath(filterController.appliedFilters, activeFilter);
  }, [
    activeFilter,
    canSyncFeedBrowserPath,
    filterController,
    isAuthenticated,
    isFeedTabActive,
    replaceFeedBrowserPath,
  ]);

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
  const countryDefaultSearchBias = useMemo<AddressSearchBias | undefined>(() => {
    if (!feedScope) {
      return undefined;
    }

    return {
      countryCode: feedScope.country,
      lat: feedScope.lat,
      lon: feedScope.lon,
    };
  }, [feedScope]);
  const feedSearchBias = mapSearchBias ?? countryDefaultSearchBias;

  const headerRightAction = useMemo(() => <FeedHeaderActions />, []);

  // Property feed (trending/latest)
  const isPropertyFeed = activeFilter === 'trending' || activeFilter === 'latest';
  const activityScope = activeFilter === 'following' ? 'following' : 'public';
  const propertyFeedFilter: PropertyFeedFilter = activeFilter === 'latest' ? 'latest' : 'trending';
  const hasAppliedAreaFilters = (filterController.appliedFilters.areas ?? []).length > 0;
  const propertyFeedScope = useMemo(() => {
    if (hasAppliedAreaFilters) {
      return undefined;
    }

    return feedScope;
  }, [feedScope, hasAppliedAreaFilters]);
  const isBootstrappingPropertyFeed = isPropertyFeed && !hasAppliedAreaFilters && !feedScope;
  const hydrationPropertyIdList = useMemo(
    () => [...hydrationPropertyIds],
    [hydrationPropertyIds]
  );
  const feedQuery = useInfiniteFeed(
    isPropertyFeed ? propertyFeedFilter : 'trending',
    propertyFeedScope,
    isPropertyFeed && (hasAppliedAreaFilters || !!feedScope),
    filterController.appliedFilters,
    {
      hydrationPropertyIds: hydrationPropertyIdList,
      initialHydrationItemCount: FEED_LIST_INITIAL_NUM_TO_RENDER,
    }
  );

  // Activity feed
  const activityQuery = useActivityFeed(
    activityScope,
    !isPropertyFeed,
    filterController.appliedFilters
  );

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

  const handleFilterChange = useCallback(
    (filter: FeedTab) => {
      if (filter === 'following' && !isAuthenticated) {
        setShowAuth(true);
        return;
      }

      setActiveFilter(filter);
      pushFeedBrowserPath(filterController.appliedFilters, filter);
    },
    [filterController.appliedFilters, isAuthenticated, pushFeedBrowserPath]
  );

  const handlePropertyPress = useCallback((property: PropertyRouteAddressLike) => {
    router.push(toInternalAppHref(buildPropertyRoute(property, '/feed')));
  }, []);
  const handleFeedSearchLocationResolved = useCallback(
    (coordinates: { lon: number; lat: number }) => {
      router.push(
        toInternalAppHref(
          appendSharedFeedFiltersToPath(
            serializeCanonicalCameraPath({
              lat: coordinates.lat,
              lng: coordinates.lon,
              zoom: FEED_DIRECT_ADDRESS_MAP_ZOOM,
            }),
            filterController.appliedFilters
          )
        )
      );
    },
    [filterController.appliedFilters]
  );
  const handleFeedAreaSelected = useCallback(
    (area: LocationFilterToken) => {
      const currentAreas = filterController.appliedFilters.areas ?? [];
      filterController.commitAppliedFilters({
        ...filterController.appliedFilters,
        areas: [
          ...(area.type === 'current-location'
            ? currentAreas.filter((currentArea) => currentArea.type !== 'current-location')
            : currentAreas),
          area,
        ],
      });
    },
    [filterController]
  );
  const handleFeedAreaRemoved = useCallback(
    (area: LocationFilterToken) => {
      const removeKey = serializeLocationFilterToken(area);
      filterController.commitAppliedFilters({
        ...filterController.appliedFilters,
        areas: (filterController.appliedFilters.areas ?? []).filter((candidate) => {
          const candidateKey = serializeLocationFilterToken(candidate);
          return removeKey == null ? candidate !== area : candidateKey !== removeKey;
        }),
      });
    },
    [filterController]
  );
  const handleClearFeedAreas = useCallback(() => {
    filterController.commitAppliedFilters({
      ...filterController.appliedFilters,
      areas: [],
    });
  }, [filterController]);
  const handleFeedCurrentLocation = useCallback(async () => {
    try {
      const { longitude, latitude } = await getCurrentLocation();
      const existingCurrentLocation = (filterController.appliedFilters.areas ?? []).find(
        (area) => area.type === 'current-location'
      );
      handleFeedAreaSelected({
        type: 'current-location',
        countryCode: null,
        value: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
        label: t('search.currentLocationLabel'),
        coordinates: [longitude, latitude],
        radiusMeters:
          existingCurrentLocation?.radiusMeters ?? DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('map.locationUnable');
      Alert.alert(t('map.locationUnavailable'), message);
    }
  }, [filterController.appliedFilters.areas, handleFeedAreaSelected, t]);
  const handleLoadMore = useCallback(() => {
    if (!hasInteractedWithListRef.current) {
      return;
    }

    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
      activeQuery.fetchNextPage();
    }
  }, [activeQuery]);
  const handleListInteraction = useCallback(() => {
    hasInteractedWithListRef.current = true;
  }, []);
  const handleViewablePropertyItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedProperty>[] }) => {
      if (viewableItems.length === 0) {
        return;
      }

      setHydrationPropertyIds((current) => {
        let next: Set<string> | null = null;
        for (const viewableItem of viewableItems) {
          const propertyId = viewableItem.isViewable ? viewableItem.item?.id : null;
          if (propertyId && !current.has(propertyId)) {
            next ??= new Set(current);
            next.add(propertyId);
          }
        }
        return next ?? current;
      });
    },
    []
  );
  const propertyViewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: 20,
    }),
    []
  );

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
        officialValuationYear={item.officialValuationYear}
        officialValuationSourceFetch={item.officialValuationSourceFetch}
        askingPrice={item.askingPrice ?? undefined}
        fmvValue={item.fmvValue}
        activityLevel={item.activityLevel}
        marketState={item.marketState}
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

  const propertyKeyExtractor = useCallback((item: FeedProperty) => item.id, []);
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
      message={t('feed.auth.following')}
      onSuccess={() => {
        setShowAuth(false);
        setActiveFilter('following');
        pushFeedBrowserPath(filterController.appliedFilters, 'following');
      }}
    />
  );

  const sharedFilterSection = (
    <View style={styles.sharedFilterSection} testID="feed-shared-filter-section">
      <SearchBar
        layout="inline"
        onPropertyResolved={handlePropertyPress}
        onLocationResolved={handleFeedSearchLocationResolved}
        searchBias={feedSearchBias}
        selectedAreas={filterController.appliedFilters.areas ?? []}
        onAreaSelected={handleFeedAreaSelected}
        onAreaRemoved={handleFeedAreaRemoved}
        onClearAreas={handleClearFeedAreas}
        onCurrentLocationSelected={handleFeedCurrentLocation}
      />
      <MapFilterBar
        controller={filterController}
        layout="inline"
        showActivityFilter={false}
        showFollowingFilter={false}
      />
    </View>
  );

  // Loading state
  if ((isBootstrappingPropertyFeed || activeQuery.isLoading) && !isRefreshing) {
    return (
      <ScreenBackground style={styles.screen}>
        <View style={FEED_LIST_CONTAINER_STYLE}>
          <ScreenHeader title={t(FILTER_TITLE_KEYS[activeFilter])} rightAction={headerRightAction} />
          <FeedFilterChips activeFilter={activeFilter} onFilterChange={handleFilterChange} />
          {sharedFilterSection}
          <FeedLoadingState />
        </View>
        {authModal}
      </ScreenBackground>
    );
  }

  // Error state
  if (activeQuery.isError) {
    return (
      <ScreenBackground style={styles.screen}>
        <View style={FEED_LIST_CONTAINER_STYLE}>
          <ScreenHeader title={t(FILTER_TITLE_KEYS[activeFilter])} rightAction={headerRightAction} />
          <FeedFilterChips activeFilter={activeFilter} onFilterChange={handleFilterChange} />
          {sharedFilterSection}
          <FeedErrorState
            message={activeQuery.error?.message || t('feed.error.default')}
            onRetry={activeQuery.refetch}
          />
        </View>
        {authModal}
      </ScreenBackground>
    );
  }

  // Empty state
  const isEmpty = isPropertyFeed ? properties.length === 0 : activities.length === 0;

  if (isEmpty) {
    const signedInFollowing = activeFilter !== 'following' || isAuthenticated;
    return (
      <ScreenBackground style={styles.screen}>
        <View style={FEED_LIST_CONTAINER_STYLE}>
          <ScreenHeader title={t(FILTER_TITLE_KEYS[activeFilter])} rightAction={headerRightAction} />
          <FeedFilterChips activeFilter={activeFilter} onFilterChange={handleFilterChange} />
          {sharedFilterSection}
          <FeedEmptyState
            filter={activeFilter}
            signedIn={signedInFollowing}
            onPrimaryAction={
              activeFilter === 'following'
                ? () => {
                    if (signedInFollowing) {
                      setActiveFilter('recent-activity');
                      pushFeedBrowserPath(filterController.appliedFilters, 'recent-activity');
                      return;
                    }

                    setShowAuth(true);
                  }
                : undefined
            }
          />
        </View>
        {authModal}
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={styles.screen} testID="feed-screen">
      <View style={FEED_LIST_CONTAINER_STYLE}>
        <ScreenHeader title={t(FILTER_TITLE_KEYS[activeFilter])} rightAction={headerRightAction} />
        <FeedFilterChips activeFilter={activeFilter} onFilterChange={handleFilterChange} />
        {sharedFilterSection}

        {isPropertyFeed ? (
          <FlatList
            key="property-feed"
            data={properties}
            keyExtractor={propertyKeyExtractor}
            renderItem={renderPropertyItem}
            contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            onScrollBeginDrag={handleListInteraction}
            onMomentumScrollBegin={handleListInteraction}
            onViewableItemsChanged={handleViewablePropertyItemsChanged}
            viewabilityConfig={propertyViewabilityConfig}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={FEED_LIST_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={FEED_LIST_MAX_TO_RENDER_PER_BATCH}
            updateCellsBatchingPeriod={FEED_LIST_BATCHING_PERIOD_MS}
            windowSize={FEED_LIST_WINDOW_SIZE}
            testID="feed-list"
          />
        ) : (
          <FlatList
            key="activity-feed"
            data={activities}
            keyExtractor={activityKeyExtractor}
            renderItem={renderActivityItem}
            contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
            refreshControl={refreshControl}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            onScrollBeginDrag={handleListInteraction}
            onMomentumScrollBegin={handleListInteraction}
            ListFooterComponent={ListFooterComponent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={FEED_LIST_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={FEED_LIST_MAX_TO_RENDER_PER_BATCH}
            updateCellsBatchingPeriod={FEED_LIST_BATCHING_PERIOD_MS}
            windowSize={FEED_LIST_WINDOW_SIZE}
            testID="activity-feed-list"
          />
        )}
      </View>
      {authModal}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
  },
  sharedFilterSection: {
    position: 'relative',
    zIndex: 200,
    elevation: 20,
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
  },
});

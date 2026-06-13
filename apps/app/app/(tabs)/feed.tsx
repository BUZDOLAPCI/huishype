/**
 * Feed Screen — Browse properties with Trending, Latest, and grouped activity tabs.
 *
 * Trending and Latest use the /feed endpoint via useInfiniteFeed.
 * Recent Activity and Following use grouped property posts from /activity/properties.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { serializeCanonicalCameraPath } from '@huishype/shared';
import { isValidCountryCode } from '@huishype/shared/config';

import {
  ActivityFeedCard,
  AuthModal,
  FeedEmptyState,
  FeedErrorState,
  FeedLoadingState,
  FeedLoadingMore,
  HuisHypeLogo,
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
import { FeedTabBar } from '@/src/components/FeedTabBar';
import { Icon } from '@/src/components/ui/Icon';
import { NotificationBell } from '@/src/components/ui/NotificationBell';
import { ScreenBackground } from '@/src/components/ui/ScreenBackground';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { emitSocialFollowAnalyticsEvent } from '@/src/hooks/useUserProfile';
import { useT } from '@/src/i18n';
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
const FILTER_HIDE_SCROLL_Y = 48;
const FILTER_SHOW_SCROLL_DELTA_Y = 8;
const CAUGHT_UP_FOOTER_EXTRA_HEIGHT = 180;
const FEED_SWIPE_TRAVEL_THRESHOLD = 64;
const FEED_SWIPE_VELOCITY_THRESHOLD = 0.65;
const FEED_TAB_ORDER: FeedTab[] = ['trending', 'latest', 'recent-activity', 'following'];
type FeedAuthMode = 'following' | 'interaction';

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

function FeedBrandHeader({ rightAction }: { rightAction: React.ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="feed-brand-header"
      style={[
        styles.brandHeader,
        {
          paddingTop: Platform.OS === 'web' ? 12 : insets.top + 8,
        },
      ]}
      accessibilityRole="header"
    >
      <HuisHypeLogo
        variant="lockup"
        size={28}
        wordmarkSize={22}
        style={styles.brandLogo}
        textStyle={styles.brandText}
      />
      {rightAction}
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
  const [authMode, setAuthMode] = useState<FeedAuthMode | null>(null);
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
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sharedFilterHeight, setSharedFilterHeight] = useState(0);
  const [areFiltersVisible, setAreFiltersVisible] = useState(true);
  const filtersVisibleRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const lastScrollMetricsRef = useRef<{
    viewportHeight?: number;
    contentHeight?: number;
  }>({});
  const upwardScrollStartYRef = useRef<number | null>(null);
  const filterVisibilityAnim = useRef(new Animated.Value(1)).current;
  const propertyFeedListRef = useRef<FlatList<FeedProperty> | null>(null);
  const activityFeedListRef = useRef<FlatList<GroupedPropertyActivityItem> | null>(null);

  const showSharedFilters = useCallback(
    (visible: boolean) => {
      if (visible === filtersVisibleRef.current) {
        return;
      }

      filtersVisibleRef.current = visible;
      setAreFiltersVisible(visible);
      Animated.timing(filterVisibilityAnim, {
        toValue: visible ? 1 : 0,
        duration: 180,
        useNativeDriver: false,
      }).start();
    },
    [filterVisibilityAnim]
  );

  useEffect(() => {
    if (isFilterPanelOpen || isSearchActive) {
      showSharedFilters(true);
    }
  }, [isFilterPanelOpen, isSearchActive, showSharedFilters]);

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
  const activeItemCount = isPropertyFeed ? properties.length : activities.length;

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
    showSharedFilters(true);
    setIsRefreshing(true);
    await activeQuery.refetch();
    setIsRefreshing(false);
  }, [activeQuery, showSharedFilters]);

  const handleFilterChange = useCallback(
    (filter: FeedTab) => {
      if (filter === 'following' && !isAuthenticated) {
        setAuthMode('following');
        return;
      }

      showSharedFilters(true);
      setActiveFilter(filter);
      pushFeedBrowserPath(filterController.appliedFilters, filter);
    },
    [filterController.appliedFilters, isAuthenticated, pushFeedBrowserPath, showSharedFilters]
  );
  const switchFeedTabByOffset = useCallback(
    (offset: 1 | -1) => {
      const currentIndex = FEED_TAB_ORDER.indexOf(activeFilterRef.current);
      const nextFilter = FEED_TAB_ORDER[currentIndex + offset];
      if (!nextFilter) {
        return;
      }

      handleFilterChange(nextFilter);
    },
    [handleFilterChange]
  );
  const feedPanResponder = useMemo(
    () =>
      PanResponder?.create({
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          const absDx = Math.abs(gestureState.dx);
          const absDy = Math.abs(gestureState.dy);
          return absDx > 12 && absDx > absDy;
        },
        onPanResponderRelease: (_event, gestureState) => {
          const absDx = Math.abs(gestureState.dx);
          const absDy = Math.abs(gestureState.dy);
          const absVx = Math.abs(gestureState.vx);
          if (absDy >= absDx) {
            return;
          }

          if (absDx < FEED_SWIPE_TRAVEL_THRESHOLD && absVx < FEED_SWIPE_VELOCITY_THRESHOLD) {
            return;
          }

          switchFeedTabByOffset(gestureState.dx < 0 ? 1 : -1);
        },
      }) ?? { panHandlers: {} },
    [switchFeedTabByOffset]
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
  const handleFeedBackToTop = useCallback(() => {
    lastScrollYRef.current = 0;
    lastScrollMetricsRef.current = {};
    upwardScrollStartYRef.current = null;
    showSharedFilters(true);

    if (activeFilterRef.current === 'trending' || activeFilterRef.current === 'latest') {
      propertyFeedListRef.current?.scrollToOffset({ offset: 0, animated: true });
      return;
    }

    activityFeedListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [showSharedFilters]);
  const handleFeedScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
      const previousY = lastScrollYRef.current;
      const deltaY = nextY - previousY;
      const viewportHeight = event.nativeEvent.layoutMeasurement?.height;
      const contentHeight = event.nativeEvent.contentSize?.height;
      const previousScrollMetrics = lastScrollMetricsRef.current;
      const didViewportHeightChange =
        typeof viewportHeight === 'number' &&
        typeof previousScrollMetrics.viewportHeight === 'number' &&
        Math.abs(viewportHeight - previousScrollMetrics.viewportHeight) > 1;
      const didContentHeightStayStable =
        typeof contentHeight === 'number' &&
        typeof previousScrollMetrics.contentHeight === 'number' &&
        Math.abs(contentHeight - previousScrollMetrics.contentHeight) <= 1;
      const isLayoutCompensationScroll =
        deltaY !== 0 && didViewportHeightChange && didContentHeightStayStable;
      const scrollableDistance =
        typeof viewportHeight === 'number' && typeof contentHeight === 'number'
          ? Math.max(0, contentHeight - viewportHeight)
          : null;
      const hasEnoughScrollableContentToCollapse =
        sharedFilterHeight > 0 &&
        (scrollableDistance == null ||
          scrollableDistance >
            FILTER_HIDE_SCROLL_Y + sharedFilterHeight + FILTER_SHOW_SCROLL_DELTA_Y);
      lastScrollYRef.current = nextY;
      lastScrollMetricsRef.current = { viewportHeight, contentHeight };

      if (isFilterPanelOpen || isSearchActive) {
        showSharedFilters(true);
        return;
      }

      if (isLayoutCompensationScroll) {
        upwardScrollStartYRef.current = null;
        return;
      }

      if (nextY <= FILTER_HIDE_SCROLL_Y) {
        upwardScrollStartYRef.current = null;
        showSharedFilters(true);
        return;
      }

      if (deltaY > 0) {
        if (!hasEnoughScrollableContentToCollapse) {
          upwardScrollStartYRef.current = null;
          showSharedFilters(true);
          return;
        }

        upwardScrollStartYRef.current = null;
        showSharedFilters(false);
        return;
      }

      if (deltaY < 0) {
        upwardScrollStartYRef.current ??= previousY;
        if (upwardScrollStartYRef.current - nextY >= FILTER_SHOW_SCROLL_DELTA_Y) {
          upwardScrollStartYRef.current = null;
          showSharedFilters(true);
        }
      }
    },
    [isFilterPanelOpen, isSearchActive, sharedFilterHeight, showSharedFilters]
  );
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
        onAuthRequired={() => setAuthMode('interaction')}
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

    if (activeQuery.hasNextPage || activeItemCount === 0) {
      return null;
    }

    return (
      <View
        testID="feed-caught-up-footer"
        style={[
          styles.caughtUpFooter,
          {
            minHeight:
              sharedFilterHeight +
              FILTER_HIDE_SCROLL_Y +
              FILTER_SHOW_SCROLL_DELTA_Y +
              CAUGHT_UP_FOOTER_EXTRA_HEIGHT,
          },
        ]}
      >
        <View style={styles.caughtUpCard} testID="feed-caught-up-card">
          <View style={styles.caughtUpIconBadge}>
            <Icon
              name="CheckCircle"
              size={40}
              weight="duotone"
              color="#0D8C6F"
              testID="feed-caught-up-icon"
            />
          </View>
          <View style={styles.caughtUpTitleRow} testID="feed-caught-up-title-row">
            <View style={styles.caughtUpTitleLine} />
            <Text style={styles.caughtUpTitle}>{t('feed.caughtUp.title')}</Text>
            <View style={styles.caughtUpTitleLine} />
          </View>
          <Text style={styles.caughtUpBody}>{t('feed.caughtUp.body')}</Text>
          <Pressable
            onPress={handleFeedBackToTop}
            testID="feed-back-to-top"
            accessibilityRole="button"
            accessibilityLabel={t('feed.caughtUp.backToTop')}
            style={({ pressed }) => [
              styles.caughtUpBackTop,
              pressed && styles.caughtUpBackTopPressed,
            ]}
          >
            <Icon name="ArrowUp" size={18} weight="bold" color="#5F574F" />
            <Text style={styles.caughtUpBackTopText}>{t('feed.caughtUp.backToTop')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [
    activeQuery.hasNextPage,
    activeQuery.isFetchingNextPage,
    activeItemCount,
    handleFeedBackToTop,
    sharedFilterHeight,
    t,
  ]);

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
      visible={authMode !== null}
      onClose={() => setAuthMode(null)}
      message={
        authMode === 'interaction'
          ? t('activityFeed.auth.interaction')
          : t('feed.auth.following')
      }
      onSuccess={() => {
        const completedAuthMode = authMode;
        setAuthMode(null);

        if (completedAuthMode === 'following') {
          showSharedFilters(true);
          setActiveFilter('following');
          pushFeedBrowserPath(filterController.appliedFilters, 'following');
        }
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
        onActiveChange={setIsSearchActive}
      />
      <MapFilterBar
        controller={filterController}
        layout="inline"
        showActivityFilter={false}
        showFollowingFilter={false}
        onPanelOpenChange={setIsFilterPanelOpen}
      />
    </View>
  );
  const canInterpolateFilterVisibility =
    typeof (filterVisibilityAnim as { interpolate?: unknown }).interpolate === 'function';
  const collapsibleFilterHeight =
    sharedFilterHeight > 0 && canInterpolateFilterVisibility
      ? filterVisibilityAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, sharedFilterHeight],
        })
      : undefined;
  const collapsibleFilterTranslateY = canInterpolateFilterVisibility
    ? filterVisibilityAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-12, 0],
      })
    : 0;
  const collapsibleFilterStyle = [
    styles.collapsibleFilterShell,
    isSearchActive && styles.collapsibleFilterShellSearchActive,
    {
      height: collapsibleFilterHeight,
      opacity: filterVisibilityAnim,
      transform: isSearchActive
        ? []
        : [
            {
              translateY: collapsibleFilterTranslateY,
            },
          ],
    },
  ];
  const feedHeader = (
    <>
      <FeedBrandHeader rightAction={headerRightAction} />
      <FeedTabBar activeFilter={activeFilter} onFilterChange={handleFilterChange} />
      <Animated.View
        testID="feed-collapsible-filter-shell"
        style={collapsibleFilterStyle}
        pointerEvents={areFiltersVisible ? 'auto' : 'none'}
      >
        <View
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height;
            if (nextHeight > 0 && Math.abs(nextHeight - sharedFilterHeight) > 1) {
              setSharedFilterHeight(nextHeight);
            }
          }}
        >
          {sharedFilterSection}
        </View>
      </Animated.View>
    </>
  );
  const renderBody = (children: React.ReactNode) => (
    <View style={styles.feedBody} testID="feed-body" {...feedPanResponder.panHandlers}>
      {children}
    </View>
  );

  // Loading state
  if ((isBootstrappingPropertyFeed || activeQuery.isLoading) && !isRefreshing) {
    return (
      <ScreenBackground style={styles.screen}>
        <View style={FEED_LIST_CONTAINER_STYLE}>
          {feedHeader}
          {renderBody(<FeedLoadingState />)}
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
          {feedHeader}
          {renderBody(
            <FeedErrorState
              message={activeQuery.error?.message || t('feed.error.default')}
              onRetry={activeQuery.refetch}
            />
          )}
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
          {feedHeader}
          {renderBody(
            <FeedEmptyState
              filter={activeFilter}
              signedIn={signedInFollowing}
              onPrimaryAction={
                activeFilter === 'following'
                  ? () => {
                      if (signedInFollowing) {
                        showSharedFilters(true);
                        setActiveFilter('recent-activity');
                        pushFeedBrowserPath(filterController.appliedFilters, 'recent-activity');
                        return;
                      }

                      setAuthMode('following');
                    }
                  : undefined
              }
            />
          )}
        </View>
        {authModal}
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={styles.screen} testID="feed-screen">
      <View style={FEED_LIST_CONTAINER_STYLE}>
        {feedHeader}

        {renderBody(
          isPropertyFeed ? (
            <FlatList
              ref={propertyFeedListRef}
              key="property-feed"
              data={properties}
              keyExtractor={propertyKeyExtractor}
              renderItem={renderPropertyItem}
              contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
              refreshControl={refreshControl}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              onScroll={handleFeedScroll}
              scrollEventThrottle={16}
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
              ref={activityFeedListRef}
              key="activity-feed"
              data={activities}
              keyExtractor={activityKeyExtractor}
              renderItem={renderActivityItem}
              contentContainerStyle={FEED_LIST_CONTENT_CONTAINER_STYLE}
              refreshControl={refreshControl}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              onScroll={handleFeedScroll}
              scrollEventThrottle={16}
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
          )
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
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  brandLogo: {
    flexShrink: 1,
  },
  brandText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F5A623',
    letterSpacing: 0,
    lineHeight: 28,
  },
  feedBody: {
    flex: 1,
    minHeight: 0,
  },
  collapsibleFilterShell: {
    overflow: 'hidden',
    position: 'relative',
    zIndex: 200,
    elevation: 20,
  },
  collapsibleFilterShellSearchActive: {
    overflow: 'visible',
    zIndex: 1000,
    elevation: 100,
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
  caughtUpFooter: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 96,
  },
  caughtUpCard: {
    width: '100%',
    maxWidth: 448,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(222, 145, 29, 0.14)',
    borderRadius: 18,
    backgroundColor: 'rgba(255, 253, 249, 0.92)',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: '#3F3020',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 22,
    elevation: 2,
  },
  caughtUpIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(222, 145, 29, 0.16)',
    backgroundColor: 'rgba(255, 244, 213, 0.72)',
  },
  caughtUpTitleRow: {
    width: '100%',
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  caughtUpTitleLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(122, 112, 102, 0.16)',
  },
  caughtUpTitle: {
    color: '#4B443D',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 0,
    textAlign: 'center',
    flexShrink: 0,
  },
  caughtUpBody: {
    marginTop: 6,
    color: '#8A8177',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: 'center',
  },
  caughtUpBackTop: {
    marginTop: 16,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 112, 102, 0.14)',
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.74)',
    paddingHorizontal: 16,
  },
  caughtUpBackTopPressed: {
    opacity: 0.72,
  },
  caughtUpBackTopText: {
    color: '#5F574F',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
});

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Animated, FlatList, StyleSheet } from 'react-native';
import type { QueryObserverSuccessResult } from '@tanstack/react-query';
import { router } from 'expo-router';

import FeedScreen from '../(tabs)/feed';
import { useActivityFeed, useInfiniteFeed, useMyProfile } from '@/src/hooks';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { getCurrentLocation } from '@/src/lib/currentLocation';
import type { MyProfile } from '@/src/hooks/useUserProfile';

const mockUseInfiniteFeed = useInfiniteFeed as jest.MockedFunction<typeof useInfiniteFeed>;
const mockUseActivityFeed = useActivityFeed as jest.MockedFunction<typeof useActivityFeed>;
const mockUseMyProfile = useMyProfile as jest.MockedFunction<typeof useMyProfile>;
const mockUseUnreadNotificationCount = useUnreadNotificationCount as jest.MockedFunction<
  typeof useUnreadNotificationCount
>;
const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockGetCurrentLocation = getCurrentLocation as jest.MockedFunction<typeof getCurrentLocation>;
const DEFAULT_MARKET_STATES = ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'];
let mockIsFeedFocused = true;
let mockSharedMapSearchBias: {
  countryCode?: string | null;
  lat?: number;
  lon?: number;
} | null = null;
let capturedSearchBarProps: {
  searchBias?: {
    countryCode?: string | null;
    lat?: number;
    lon?: number;
  };
  onAreaSelected?: (area: {
    type: 'city' | 'street';
    countryCode: string;
    value: string;
    label: string;
    city?: string;
  }) => void;
  onAreaRemoved?: (area: {
    type: 'city' | 'street';
    countryCode: string;
    value: string;
    label: string;
    city?: string;
  }) => void;
  onClearAreas?: () => void;
  onLocationResolved?: (coordinates: { lon: number; lat: number }, address: string) => void;
} | null = null;

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => mockIsFeedFocused),
}));

jest.mock('@/src/hooks', () => ({
  useInfiniteFeed: jest.fn(),
  useActivityFeed: jest.fn(),
  useMyProfile: jest.fn(),
}));

jest.mock('@/src/hooks/useNotifications', () => ({
  useUnreadNotificationCount: jest.fn(),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useMapSearchBias', () => ({
  useMapSearchBias: jest.fn(() => ({
    mapSearchBias: mockSharedMapSearchBias,
    setMapSearchBias: jest.fn(),
  })),
}));

jest.mock('@/src/lib/currentLocation', () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock('@/src/components', () => ({
  ActivityFeedCard: ({
    property,
    onPress,
    onAuthRequired,
  }: {
    property: { id: string };
    onPress: () => void;
    onAuthRequired?: () => void;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.View>
        <ReactNative.Pressable testID={`activity-card-${property.id}`} onPress={onPress}>
          <ReactNative.Text>Open property {property.id}</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID={`activity-auth-${property.id}`}
          onPress={onAuthRequired}
        >
          <ReactNative.Text>Auth property {property.id}</ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    );
  },
  AuthModal: ({
    visible,
    message,
    onSuccess,
  }: {
    visible: boolean;
    message?: string;
    onSuccess?: () => void;
  }) => {
    const ReactNative = require('react-native');
    if (!visible) {
      return null;
    }
    return (
      <ReactNative.View testID="feed-auth-modal">
        <ReactNative.Text>{message}</ReactNative.Text>
        <ReactNative.Pressable testID="feed-auth-success" onPress={onSuccess}>
          <ReactNative.Text>Auth success</ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    );
  },
  FeedEmptyState: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>Feed empty</ReactNative.Text>;
  },
  FeedErrorState: () => null,
  FeedLoadingState: () => null,
  FeedLoadingMore: () => null,
  HuisHypeLogo: ({ variant }: { variant?: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>HuisHype {variant}</ReactNative.Text>;
  },
  PropertyFeedCard: ({ id }: { id: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>Property {id}</ReactNative.Text>;
  },
  SearchBar: ({
    searchBias,
    selectedAreas,
    onAreaSelected,
    onAreaRemoved,
    onClearAreas,
    onLocationResolved,
    onActiveChange,
  }: {
    searchBias?: {
      countryCode?: string | null;
      lat?: number;
      lon?: number;
    };
    selectedAreas: Array<{
      type: 'city' | 'street';
      countryCode: string;
      value: string;
      label: string;
      city?: string;
    }>;
    onAreaSelected: (area: {
      type: 'city' | 'street';
      countryCode: string;
      value: string;
      label: string;
      city?: string;
    }) => void;
    onAreaRemoved: (area: {
      type: 'city' | 'street';
      countryCode: string;
      value: string;
      label: string;
      city?: string;
    }) => void;
    onClearAreas: () => void;
    onLocationResolved: (coordinates: { lon: number; lat: number }, address: string) => void;
    onActiveChange?: (active: boolean) => void;
  }) => {
    const ReactNative = require('react-native');
    capturedSearchBarProps = {
      searchBias,
      onAreaSelected,
      onAreaRemoved,
      onClearAreas,
      onLocationResolved,
    };
    return (
      <ReactNative.View testID="feed-search-bar">
        <ReactNative.Text>Areas {selectedAreas.length}</ReactNative.Text>
        <ReactNative.Pressable
          testID="feed-search-active"
          onPress={() => onActiveChange?.(true)}
        >
          <ReactNative.Text>Search active</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-search-inactive"
          onPress={() => onActiveChange?.(false)}
        >
          <ReactNative.Text>Search inactive</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-select-area"
          onPress={() =>
            onAreaSelected({
              type: 'city',
              countryCode: 'NL',
              value: 'eindhoven',
              label: 'Eindhoven',
              city: 'Eindhoven',
            })
          }
        >
          <ReactNative.Text>Select Eindhoven</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-select-centrum-eindhoven"
          onPress={() =>
            onAreaSelected({
              type: 'street',
              countryCode: 'NL',
              value: 'centrum',
              label: 'Centrum',
              city: 'Eindhoven',
            })
          }
        >
          <ReactNative.Text>Select Centrum Eindhoven</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-select-centrum-utrecht"
          onPress={() =>
            onAreaSelected({
              type: 'street',
              countryCode: 'NL',
              value: 'centrum',
              label: 'Centrum',
              city: 'Utrecht',
            })
          }
        >
          <ReactNative.Text>Select Centrum Utrecht</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-remove-first-area"
          onPress={() => selectedAreas[0] && onAreaRemoved(selectedAreas[0])}
        >
          <ReactNative.Text>Remove first area</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable testID="feed-clear-areas" onPress={onClearAreas}>
          <ReactNative.Text>Clear areas</ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    );
  },
}));

jest.mock('@/src/components/map/MapFilterBar', () => ({
  MapFilterBar: ({
    controller,
    showActivityFilter,
    showFollowingFilter,
    onPanelOpenChange,
  }: {
    controller: {
      appliedFilters: { salePriceFrom?: number | null };
      commitAppliedFilters: (filters: {
        salePriceFrom?: number | null;
        marketState?: string[];
      }) => void;
      toggleStatusPill: (state: 'for-sale') => void;
    };
    showActivityFilter?: boolean;
    showFollowingFilter?: boolean;
    onPanelOpenChange?: (open: boolean) => void;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.View testID="feed-shared-map-filter-bar">
        <ReactNative.Pressable
          testID="feed-toggle-for-sale"
          onPress={() => controller.toggleStatusPill('for-sale')}
        >
          <ReactNative.Text>For Sale</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable testID="feed-price-draft-sale-from">
          <ReactNative.Text>Draft sale price</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-open-filter-panel"
          onPress={() => onPanelOpenChange?.(true)}
        >
          <ReactNative.Text>Open filter panel</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-close-filter-panel"
          onPress={() => onPanelOpenChange?.(false)}
        >
          <ReactNative.Text>Close filter panel</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="feed-price-commit-sale-from"
          onPress={() =>
            controller.commitAppliedFilters({
              ...controller.appliedFilters,
              salePriceFrom: 600000,
            })
          }
        >
          <ReactNative.Text>Commit sale price</ReactNative.Text>
        </ReactNative.Pressable>
        {showActivityFilter ? (
          <ReactNative.Text testID="feed-map-activity-control">Activity</ReactNative.Text>
        ) : null}
        {showFollowingFilter ? (
          <ReactNative.Text testID="feed-map-following-control">Following</ReactNative.Text>
        ) : null}
      </ReactNative.View>
    );
  },
}));

jest.mock('@/src/components/navigation/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{title}</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/NotificationBell', () => ({
  NotificationBell: () => null,
}));

jest.mock('@/src/utils/property-route', () => ({
  buildPropertyRoute: jest.fn(() => '/property/test'),
  toInternalAppHref: jest.fn((href: string) => href),
}));

function createQueryResult<T>(pages: T[]) {
  return {
    data: { pages },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  };
}

function createMyProfileResult(
  overrides: Partial<MyProfile> = {}
): QueryObserverSuccessResult<MyProfile, Error> {
  return {
    data: {
      id: 'viewer-1',
      handle: 'viewer-1',
      displayName: 'Viewer',
      profilePhotoUrl: null,
      homeCountry: null,
      karma: 10,
      karmaRank: {
        title: 'Contributor',
        level: 2,
      },
      guessCount: 0,
      commentCount: 0,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 0,
      followingCount: 0,
      relationship: 'self',
      email: 'viewer@example.com',
      hasDisplayName: true,
      averageAccuracy: null,
      savedCount: 0,
      likedCount: 0,
      lastNameChangeAt: null,
      lastDisplayNameChangeAt: null,
      lastHandleChangeAt: null,
      displayNameChangeAvailableAt: null,
      handleChangeAvailableAt: null,
      ...overrides,
    },
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch: jest.fn(),
    status: 'success',
    fetchStatus: 'idle',
    promise: Promise.resolve({
      id: 'viewer-1',
      handle: 'viewer-1',
      displayName: 'Viewer',
      profilePhotoUrl: null,
      homeCountry: null,
      karma: 10,
      karmaRank: {
        title: 'Contributor',
        level: 2,
      },
      guessCount: 0,
      commentCount: 0,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 0,
      followingCount: 0,
      relationship: 'self',
      email: 'viewer@example.com',
      hasDisplayName: true,
      averageAccuracy: null,
      savedCount: 0,
      likedCount: 0,
      lastNameChangeAt: null,
      lastDisplayNameChangeAt: null,
      lastHandleChangeAt: null,
      displayNameChangeAvailableAt: null,
      handleChangeAvailableAt: null,
      ...overrides,
    }),
  };
}

function createMyProfileLoadingResult(): ReturnType<typeof useMyProfile> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: true,
    isLoading: true,
    isPending: true,
    isLoadingError: false,
    isInitialLoading: true,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: true,
    isSuccess: false,
    isEnabled: true,
    refetch: jest.fn(),
    status: 'pending',
    fetchStatus: 'fetching',
    promise: Promise.resolve(null as unknown as MyProfile),
  } as unknown as ReturnType<typeof useMyProfile>;
}

function seedAuth() {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'viewer-1',
      username: 'viewer-1',
      handle: 'viewer-1',
      displayName: 'Viewer',
      karma: 10,
      karmaRank: 'Contributor',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    isAuthenticated: true,
    isLoading: false,
    accessToken: 'viewer-token',
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    verifyEmailCode: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });
}

function seedUnauth() {
  mockUseAuthContext.mockReturnValue({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    verifyEmailCode: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });
}

describe('FeedScreen following surface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/feed');
    mockIsFeedFocused = true;
    mockSharedMapSearchBias = null;
    capturedSearchBarProps = null;
    mockGetCurrentLocation.mockRejectedValue(new Error('Location unavailable'));
    seedAuth();
    mockUseMyProfile.mockReturnValue(createMyProfileResult());
    mockUseUnreadNotificationCount.mockReturnValue({
      data: 0,
    } as ReturnType<typeof useUnreadNotificationCount>);
    mockUseInfiniteFeed.mockReturnValue(
      createQueryResult([
        {
          properties: [
            {
              id: 'property-1',
              address: 'Main 1',
              city: 'Eindhoven',
              postalCode: '5611 AA',
              countryCode: 'NL',
              thumbnailUrl: null,
              aerialImageUrl: null,
              officialValuation: null,
              askingPrice: null,
              fmvValue: null,
              activityLevel: 'warm',
              likeCount: 0,
              commentCount: 0,
              guessCount: 0,
              viewCount: 0,
              yearBuilt: null,
              floorAreaM2: null,
            },
          ],
        },
      ]) as unknown as ReturnType<typeof useInfiniteFeed>
    );
    (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__ = [];
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    delete (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;
  });

  it('uses the following activity scope and emits feed-opened plus empty-viewed analytics', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenLastCalledWith(
      'trending',
      {
        country: 'NL',
        lat: 51.4416,
        lon: 5.4697,
      },
      true,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES }),
      expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
    );
    expect(mockUseActivityFeed).toHaveBeenLastCalledWith(
      'public',
      false,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES })
    );

    fireEvent.press(getByTestId('feed-tab-following'));

    await waitFor(() => {
      expect(mockUseInfiniteFeed).toHaveBeenLastCalledWith(
        'trending',
        {
          country: 'NL',
          lat: 51.4416,
          lon: 5.4697,
        },
        false,
        expect.objectContaining({ marketState: DEFAULT_MARKET_STATES }),
        expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
      );
      expect(mockUseActivityFeed).toHaveBeenLastCalledWith(
        'following',
        true,
        expect.objectContaining({ marketState: DEFAULT_MARKET_STATES })
      );
    });

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{ name: string }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    await waitFor(() => {
      expect(analyticsEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'following_feed_opened' }),
          expect.objectContaining({ name: 'following_feed_empty_viewed' }),
        ])
      );
    });
  });

  it('scopes the property feed to the default country center', () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenCalledWith(
      'trending',
      {
        country: 'NL',
        lat: 51.4416,
        lon: 5.4697,
      },
      true,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES }),
      expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
    );
  });

  it('passes the feed country scope as search bias to shared search', () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(capturedSearchBarProps?.searchBias).toEqual({
      countryCode: 'NL',
      lat: 51.4416,
      lon: 5.4697,
    });
  });

  it('uses shared map viewport bias for feed search when available', () => {
    mockSharedMapSearchBias = {
      countryCode: 'FR',
      lat: 48.8566,
      lon: 2.3522,
    };
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(capturedSearchBarProps?.searchBias).toEqual({
      countryCode: 'FR',
      lat: 48.8566,
      lon: 2.3522,
    });
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });

  it('does not request current location for feed search bias fallback', () => {
    mockGetCurrentLocation.mockResolvedValue({
      latitude: 51.4523,
      longitude: 5.4457,
    });
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(capturedSearchBarProps?.searchBias).toEqual({
      countryCode: 'NL',
      lat: 51.4416,
      lon: 5.4697,
    });
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });

  it('scopes the property feed to the signed-in user profile country when available', () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );
    mockUseMyProfile.mockReturnValue(createMyProfileResult({ homeCountry: 'DE' }));

    render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenCalledWith(
      'trending',
      {
        country: 'DE',
        lat: 52.52,
        lon: 13.405,
      },
      true,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES }),
      expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
    );
  });

  it('waits for the authenticated profile scope before enabling the property feed query', () => {
    mockUseMyProfile.mockReturnValue(createMyProfileLoadingResult());
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenCalledWith(
      'trending',
      undefined,
      false,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES }),
      expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
    );
  });

  it('renders feed tabs separately from shared map/feed filters without map social controls', () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, queryByTestId } = render(<FeedScreen />);

    expect(getByTestId('feed-brand-header')).toBeTruthy();
    expect(getByTestId('feed-tab-trending')).toBeTruthy();
    expect(getByTestId('feed-tab-trending').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(StyleSheet.flatten(getByTestId('feed-shared-filter-section').props.style)).toEqual(
      expect.objectContaining({
        position: 'relative',
        zIndex: 200,
      })
    );
    expect(getByTestId('feed-search-bar')).toBeTruthy();
    expect(getByTestId('feed-shared-map-filter-bar')).toBeTruthy();
    expect(queryByTestId('feed-map-activity-control')).toBeNull();
    expect(queryByTestId('feed-map-following-control')).toBeNull();
  });

  it('auto-hides shared filters on downward feed scroll and reveals them on upward scroll', () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, UNSAFE_getByType } = render(<FeedScreen />);
    const feedList = UNSAFE_getByType(FlatList);

    fireEvent(getByTestId('feed-shared-filter-section').parent!, 'layout', {
      nativeEvent: { layout: { height: 120 } },
    });
    fireEvent.scroll(feedList, {
      nativeEvent: {
        contentOffset: { y: 80 },
        contentSize: { height: 1200 },
        layoutMeasurement: { height: 560 },
      },
    });

    expect(timingSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: 0,
        duration: 180,
        useNativeDriver: false,
      })
    );

    fireEvent.scroll(feedList, {
      nativeEvent: {
        contentOffset: { y: 70 },
        contentSize: { height: 1200 },
        layoutMeasurement: { height: 560 },
      },
    });

    expect(timingSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: 1,
        duration: 180,
        useNativeDriver: false,
      })
    );

    timingSpy.mockRestore();
  });

  it('adds a caught-up footer to short following feeds so shared filters can fully collapse', async () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items:
              scope === 'following'
                ? [
                    {
                      property: {
                        id: 'property-short-1',
                        address: 'Short 1',
                        streetName: 'Short',
                        houseNumber: 1,
                        houseNumberAddition: null,
                        city: 'Eindhoven',
                        postalCode: '5611 AA',
                        countryCode: 'NL',
                        geometry: null,
                        thumbnailUrl: null,
                      },
                      lastActivityAt: '2026-04-19T10:00:00.000Z',
                      recentActors: [],
                      preview: {
                        kind: 'summary',
                        eventType: 'property_like',
                        createdAt: '2026-04-19T09:30:00.000Z',
                        actor: null,
                        summary: 'Someone liked this property',
                      },
                      counts: {
                        likeCount: 1,
                        commentCount: 0,
                        guessCount: 0,
                      },
                    },
                  ]
                : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, UNSAFE_getByType } = render(<FeedScreen />);

    fireEvent(getByTestId('feed-shared-filter-section').parent!, 'layout', {
      nativeEvent: { layout: { height: 120 } },
    });
    fireEvent.press(getByTestId('feed-tab-following'));

    await waitFor(() => {
      expect(getByTestId('feed-tab-following').props.accessibilityState).toEqual({
        selected: true,
      });
    });

    const followingList = UNSAFE_getByType(FlatList);
    const footerElement = followingList.props.ListFooterComponent();
    expect(footerElement.props.testID).toBe('feed-following-caught-up-footer');
    expect(footerElement.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          minHeight: 356,
        }),
      ])
    );
    const footerChildren = React.Children.toArray(footerElement.props.children) as Array<
      React.ReactElement<{
        name?: string;
        style?: unknown;
        testID?: string;
      }>
    >;
    const footerIcon = footerChildren.find(
      (child) => child.props?.testID === 'feed-following-caught-up-icon'
    );
    const footerTitleRow = footerChildren.find(
      (child) => child.props?.testID === 'feed-following-caught-up-title-row'
    );
    expect(footerIcon?.props.name).toBe('CheckCircle');
    expect(footerTitleRow?.props.style).toEqual(
      expect.objectContaining({
        flexDirection: 'row',
      })
    );

    fireEvent.scroll(followingList, {
      nativeEvent: {
        contentOffset: { y: 80 },
        contentSize: { height: 920 },
        layoutMeasurement: { height: 560 },
      },
    });

    expect(timingSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: 0,
        duration: 180,
        useNativeDriver: false,
      })
    );

    timingSpy.mockRestore();
  });

  it('keeps shared filters visible while feed search is active', () => {
    const timingSpy = jest.spyOn(Animated, 'timing');
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, UNSAFE_getByType } = render(<FeedScreen />);
    const feedList = UNSAFE_getByType(FlatList);

    fireEvent.press(getByTestId('feed-search-active'));
    const activeShellStyle = getByTestId('feed-collapsible-filter-shell').props.style;
    expect(activeShellStyle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          overflow: 'visible',
          zIndex: 1000,
        }),
        expect.objectContaining({
          transform: [],
        }),
      ])
    );

    fireEvent.scroll(feedList, {
      nativeEvent: {
        contentOffset: { y: 80 },
      },
    });

    expect(timingSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: 0,
      })
    );

    timingSpy.mockRestore();
  });

  it('passes area filters to property feed queries without the default location scope', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-toggle-for-sale'));
    fireEvent.press(getByTestId('feed-select-area'));

    await waitFor(() => {
      const lastPropertyFeedCall = mockUseInfiniteFeed.mock.calls.at(-1);
      expect(lastPropertyFeedCall).toEqual([
        'trending',
        undefined,
        true,
        expect.objectContaining({
          marketState: ['for-sale'],
          areas: [
            expect.objectContaining({
              type: 'city',
              value: 'eindhoven',
            }),
          ],
        }),
        expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 }),
      ]);
      expect(mockUseActivityFeed).toHaveBeenLastCalledWith(
        'public',
        false,
        expect.objectContaining({
          marketState: ['for-sale'],
          areas: [
            expect.objectContaining({
              type: 'city',
              value: 'eindhoven',
            }),
          ],
        })
      );
    });

    expect(window.location.pathname + window.location.search).toBe(
      '/feed?marketState=for-sale&area=city%3ANL%3Aeindhoven%3Acity%3Deindhoven'
    );
  });

  it('removes feed area filters by serialized token metadata', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, getByText } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-select-centrum-eindhoven'));
    await waitFor(() => {
      expect(getByText('Areas 1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('feed-select-centrum-utrecht'));
    await waitFor(() => {
      expect(getByText('Areas 2')).toBeTruthy();
    });
    fireEvent.press(getByTestId('feed-remove-first-area'));

    await waitFor(() => {
      const lastPropertyFeedCall = mockUseInfiniteFeed.mock.calls.at(-1);
      expect(lastPropertyFeedCall?.[3]).toEqual(
        expect.objectContaining({
          areas: [
            expect.objectContaining({
              type: 'street',
              value: 'centrum',
              city: 'Utrecht',
            }),
          ],
        })
      );
      expect(lastPropertyFeedCall?.[3]).not.toEqual(
        expect.objectContaining({
          areas: expect.arrayContaining([
            expect.objectContaining({
              type: 'street',
              value: 'centrum',
              city: 'Eindhoven',
            }),
          ]),
        })
      );
      expect(lastPropertyFeedCall?.[4]).toEqual(
        expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
      );
    });
    expect(window.location.pathname + window.location.search).toBe(
      '/feed?area=street%3ANL%3Acentrum%3Acity%3Dutrecht'
    );
  });

  it('initializes the feed tab and shared query filters from the feed URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/feed?marketState=for-sale&area=street:NL:beeldbuisring:city=eindhoven&feedTab=latest'
    );
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    await waitFor(() => {
      expect(getByTestId('feed-tab-latest').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(mockUseInfiniteFeed).toHaveBeenLastCalledWith(
        'latest',
        undefined,
        true,
        expect.objectContaining({
          marketState: ['for-sale'],
          areas: [
            expect.objectContaining({
              type: 'street',
              value: 'beeldbuisring',
              city: 'Eindhoven',
            }),
          ],
        }),
        expect.objectContaining({ hydrationPropertyIds: [], initialHydrationItemCount: 3 })
      );
    });
    expect(window.location.pathname + window.location.search).toBe(
      '/feed?feedTab=latest&marketState=for-sale&area=street%3ANL%3Abeeldbuisring%3Acity%3Deindhoven'
    );
  });

  it('falls back from unauthorized following feedTab without opening auth', async () => {
    window.history.replaceState({}, '', '/feed?feedTab=following');
    seedUnauth();
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    await waitFor(() => {
      expect(getByTestId('feed-tab-trending').props.accessibilityState).toEqual({
        selected: true,
      });
    });
    expect(mockUseActivityFeed).toHaveBeenLastCalledWith(
      'public',
      false,
      expect.objectContaining({ marketState: DEFAULT_MARKET_STATES })
    );
    expect(window.location.pathname + window.location.search).toBe('/feed');
  });

  it('updates the feed URL when tab chips change and omits the default tab', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);
    const pushStateSpy = jest.spyOn(window.history, 'pushState');

    fireEvent.press(getByTestId('feed-tab-latest'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/feed?feedTab=latest');
    });
    expect(pushStateSpy).toHaveBeenLastCalledWith({}, '', '/feed?feedTab=latest');

    fireEvent.press(getByTestId('feed-toggle-for-sale'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        '/feed?feedTab=latest&marketState=for-sale'
      );
    });
    expect(pushStateSpy).toHaveBeenLastCalledWith(
      {},
      '',
      '/feed?feedTab=latest&marketState=for-sale'
    );

    fireEvent.press(getByTestId('feed-tab-trending'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/feed?marketState=for-sale');
    });
    expect(pushStateSpy).toHaveBeenLastCalledWith({}, '', '/feed?marketState=for-sale');

    pushStateSpy.mockRestore();
  });

  it('does not update the feed URL for price drafts until shared filters commit', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-price-draft-sale-from'));
    expect(window.location.pathname + window.location.search).toBe('/feed');

    fireEvent.press(getByTestId('feed-price-commit-sale-from'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/feed?salePriceFrom=600000');
    });
  });

  it('updates the feed URL with repeated area params when selecting, removing, and clearing areas', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-select-centrum-eindhoven'));
    fireEvent.press(getByTestId('feed-select-centrum-utrecht'));

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        '/feed?area=street%3ANL%3Acentrum%3Acity%3Deindhoven&area=street%3ANL%3Acentrum%3Acity%3Dutrecht'
      );
    });

    fireEvent.press(getByTestId('feed-remove-first-area'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        '/feed?area=street%3ANL%3Acentrum%3Acity%3Dutrecht'
      );
    });

    fireEvent.press(getByTestId('feed-clear-areas'));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/feed');
    });
  });

  it('does not overwrite a map-owned browser URL from the retained feed screen', () => {
    window.history.replaceState(
      {},
      '',
      '/@51.441642,5.469722,17z?marketState=for-sale'
    );
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { rerender } = render(<FeedScreen />);

    rerender(<FeedScreen />);

    expect(window.location.pathname + window.location.search).toBe(
      '/@51.441642,5.469722,17z?marketState=for-sale'
    );
  });

  it('does not carry stale map query params when feed later owns a clean URL', async () => {
    window.history.replaceState({}, '', '/@51.441642,5.469722,17z?debug=map');
    mockIsFeedFocused = false;
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, rerender } = render(<FeedScreen />);

    window.history.replaceState({}, '', '/feed');
    mockIsFeedFocused = true;
    rerender(<FeedScreen />);
    fireEvent.press(getByTestId('feed-tab-latest'));

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/feed?feedTab=latest');
    });
  });

  it('uses the unified activity card for recent activity and keeps interaction auth on the same tab', async () => {
    seedUnauth();
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items:
              scope === 'public'
                ? [
                    {
                      property: {
                        id: 'property-recent-1',
                        address: 'Recent 1',
                        streetName: 'Recent',
                        houseNumber: 1,
                        houseNumberAddition: null,
                        city: 'Eindhoven',
                        postalCode: '5611 AA',
                        countryCode: 'NL',
                        geometry: null,
                        thumbnailUrl: null,
                      },
                      lastActivityAt: '2026-04-19T10:00:00.000Z',
                      recentActors: [
                        {
                          id: 'actor-1',
                          displayName: 'Actor 1',
                          handle: 'actor-1',
                          profilePhotoUrl: null,
                        },
                      ],
                      preview: {
                        kind: 'summary',
                        eventType: 'property_like',
                        createdAt: '2026-04-19T09:30:00.000Z',
                        actor: {
                          id: 'actor-1',
                          displayName: 'Actor 1',
                          handle: 'actor-1',
                          profilePhotoUrl: null,
                        },
                        summary: 'Actor 1 liked this property',
                      },
                      counts: {
                        likeCount: 4,
                        commentCount: 2,
                        guessCount: 1,
                      },
                    },
                  ]
                : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId, getByText } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-tab-recent-activity'));

    await waitFor(() => {
      expect(getByTestId('activity-card-property-recent-1')).toBeTruthy();
      expect(mockUseActivityFeed).toHaveBeenLastCalledWith(
        'public',
        true,
        expect.objectContaining({ marketState: DEFAULT_MARKET_STATES })
      );
    });

    fireEvent.press(getByTestId('activity-auth-property-recent-1'));

    expect(getByTestId('feed-auth-modal')).toBeTruthy();
    expect(getByText('Sign in to like, comment, or save properties')).toBeTruthy();

    fireEvent.press(getByTestId('feed-auth-success'));

    expect(getByTestId('feed-tab-recent-activity').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId('feed-tab-following').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('navigates unresolved direct feed address selections to a visible map camera route', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    capturedSearchBarProps?.onLocationResolved?.(
      { lon: 5.469722, lat: 51.441642 },
      'Unresolvedstraat 10, Eindhoven'
    );

    expect(router.push).toHaveBeenCalledWith('/@51.441642,5.469722,17z');
  });

  it('carries shared filters but not feedTab when unresolved direct feed addresses navigate to map', async () => {
    window.history.replaceState({}, '', '/feed?feedTab=latest&marketState=for-sale');
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items: scope === 'following' ? [] : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    capturedSearchBarProps?.onLocationResolved?.(
      { lon: 5.469722, lat: 51.441642 },
      'Unresolvedstraat 10, Eindhoven'
    );

    expect(router.push).toHaveBeenCalledWith('/@51.441642,5.469722,17z?marketState=for-sale');
  });

  it('emits following-feed post click analytics with grouped property-post payloads', async () => {
    mockUseActivityFeed.mockImplementation(
      (scope) =>
        createQueryResult([
          {
            items:
              scope === 'following'
                ? [
                    {
                      property: {
                        id: 'property-9',
                        address: 'Main 9',
                        streetName: 'Main',
                        houseNumber: 9,
                        houseNumberAddition: null,
                        city: 'Eindhoven',
                        postalCode: '5611 AA',
                        countryCode: 'NL',
                        geometry: null,
                        thumbnailUrl: null,
                      },
                      lastActivityAt: '2026-04-19T10:00:00.000Z',
                      recentActors: [
                        {
                          id: 'actor-1',
                          displayName: 'Actor 1',
                          handle: 'actor-1',
                          profilePhotoUrl: null,
                        },
                      ],
                      preview: {
                        kind: 'comment',
                        commentId: 'comment-1',
                        createdAt: '2026-04-19T09:30:00.000Z',
                        actor: {
                          id: 'actor-1',
                          displayName: 'Actor 1',
                          handle: 'actor-1',
                          profilePhotoUrl: null,
                        },
                        contentPreview: 'Nice one',
                      },
                      counts: {
                        likeCount: 4,
                        commentCount: 2,
                        guessCount: 1,
                      },
                    },
                  ]
                : [],
          },
        ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('feed-tab-following'));
    fireEvent.press(getByTestId('activity-card-property-9'));

    const analyticsEvents = (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: Array<{
          name: string;
          properties: Record<string, unknown>;
        }>;
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;

    expect(analyticsEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'following_feed_post_clicked',
          properties: expect.objectContaining({
            propertyId: 'property-9',
            likeCount: 4,
            commentCount: 2,
            guessCount: 1,
            previewKind: 'comment',
          }),
        }),
      ])
    );
  });
});

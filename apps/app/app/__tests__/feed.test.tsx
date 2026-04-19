import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { QueryObserverSuccessResult } from '@tanstack/react-query';

import FeedScreen from '../(tabs)/feed';
import { useActivityFeed, useInfiniteFeed, useMyProfile } from '@/src/hooks';
import { useUnreadNotificationCount } from '@/src/hooks/useNotifications';
import { useAuthContext } from '@/src/providers/AuthProvider';
import type { MyProfile } from '@/src/hooks/useUserProfile';

const mockUseInfiniteFeed = useInfiniteFeed as jest.MockedFunction<typeof useInfiniteFeed>;
const mockUseActivityFeed = useActivityFeed as jest.MockedFunction<typeof useActivityFeed>;
const mockUseMyProfile = useMyProfile as jest.MockedFunction<typeof useMyProfile>;
const mockUseUnreadNotificationCount =
  useUnreadNotificationCount as jest.MockedFunction<typeof useUnreadNotificationCount>;
const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
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

jest.mock('@/src/components', () => ({
  ActivityFeedCard: ({
    id,
    onActorPress,
    onPropertyPress,
  }: {
    id: string;
    onActorPress: () => void;
    onPropertyPress: () => void;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.View>
        <ReactNative.Pressable
          testID={`activity-property-${id}`}
          onPress={onPropertyPress}
        >
          <ReactNative.Text>Open property {id}</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID={`activity-actor-${id}`}
          onPress={onActorPress}
        >
          <ReactNative.Text>Open actor {id}</ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    );
  },
  AuthModal: () => null,
  FeedEmptyState: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>Feed empty</ReactNative.Text>;
  },
  FeedErrorState: () => null,
  FeedFilterChips: ({
    onFilterChange,
  }: {
    activeFilter: string;
    onFilterChange: (filter: 'trending' | 'latest' | 'recent-activity' | 'following') => void;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.View>
        <ReactNative.Pressable
          testID="chip-trending"
          onPress={() => onFilterChange('trending')}
        >
          <ReactNative.Text>Trending</ReactNative.Text>
        </ReactNative.Pressable>
        <ReactNative.Pressable
          testID="chip-following"
          onPress={() => onFilterChange('following')}
        >
          <ReactNative.Text>Following</ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    );
  },
  FeedLoadingState: () => null,
  FeedLoadingMore: () => null,
  PropertyFeedCard: ({ id }: { id: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>Property {id}</ReactNative.Text>;
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
      averageAccuracy: null,
      savedCount: 0,
      likedCount: 0,
      lastNameChangeAt: null,
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
      averageAccuracy: null,
      savedCount: 0,
      likedCount: 0,
      lastNameChangeAt: null,
      ...overrides,
    }),
  };
}

function seedAuth() {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'viewer-1',
      username: 'viewer-1',
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
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });
}

describe('FeedScreen following surface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    delete (
      globalThis as typeof globalThis & {
        __HUISHYPE_ANALYTICS_EVENTS__?: unknown[];
      }
    ).__HUISHYPE_ANALYTICS_EVENTS__;
  });

  it('uses the following activity scope and emits feed-opened plus empty-viewed analytics', async () => {
    mockUseActivityFeed.mockImplementation((scope) =>
      createQueryResult([
        {
          items: scope === 'following' ? [] : [],
        },
      ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('chip-following'));

    await waitFor(() => {
      expect(mockUseActivityFeed).toHaveBeenLastCalledWith('following');
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
    mockUseActivityFeed.mockImplementation((scope) =>
      createQueryResult([
        {
          items: scope === 'following' ? [] : [],
        },
      ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenCalledWith('trending', {
      country: 'NL',
      lat: 51.4416,
      lon: 5.4697,
    });
  });

  it('scopes the property feed to the signed-in user profile country when available', () => {
    mockUseActivityFeed.mockImplementation((scope) =>
      createQueryResult([
        {
          items: scope === 'following' ? [] : [],
        },
      ]) as unknown as ReturnType<typeof useActivityFeed>
    );
    mockUseMyProfile.mockReturnValue(createMyProfileResult({ homeCountry: 'DE' }));

    render(<FeedScreen />);

    expect(mockUseInfiniteFeed).toHaveBeenCalledWith('trending', {
      country: 'DE',
      lat: 52.52,
      lon: 13.405,
    });
  });

  it('emits following-feed item click analytics for both property and actor targets', async () => {
    mockUseActivityFeed.mockImplementation((scope) =>
      createQueryResult([
        {
          items:
            scope === 'following'
              ? [
                  {
                    id: 'activity-1',
                    eventType: 'comment',
                    actor: {
                      id: 'actor-1',
                      displayName: 'Actor 1',
                      handle: 'actor-1',
                      profilePhotoUrl: null,
                    },
                    property: {
                      id: 'property-9',
                      address: 'Main 9',
                      streetName: 'Main',
                      houseNumber: '9',
                      houseNumberAddition: null,
                      city: 'Eindhoven',
                      postalCode: '5611 AA',
                      countryCode: 'NL',
                      thumbnailUrl: null,
                    },
                    createdAt: '2026-04-19T10:00:00.000Z',
                  },
                ]
              : [],
        },
      ]) as unknown as ReturnType<typeof useActivityFeed>
    );

    const { getByTestId } = render(<FeedScreen />);

    fireEvent.press(getByTestId('chip-following'));
    fireEvent.press(getByTestId('activity-property-activity-1'));
    fireEvent.press(getByTestId('activity-actor-activity-1'));

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
          name: 'following_feed_item_clicked',
          properties: expect.objectContaining({
            target: 'property',
            activityId: 'activity-1',
            propertyId: 'property-9',
          }),
        }),
        expect.objectContaining({
          name: 'following_feed_item_clicked',
          properties: expect.objectContaining({
            target: 'actor',
            activityId: 'activity-1',
            actorId: 'actor-1',
          }),
        }),
      ])
    );
  });
});

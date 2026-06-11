import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PublicProfileScreen from '../user/[handle]';
import { usePublicAchievements } from '@/src/hooks/useAchievements';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { usePublicUserActivity } from '@/src/hooks/useUserActivity';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  useFollowUser,
  usePublicProfile,
  useUnfollowUser,
} from '@/src/hooks/useUserProfile';

const mockSetOptions = jest.fn();
const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUsePublicProfile = usePublicProfile as jest.MockedFunction<typeof usePublicProfile>;
const mockUseFollowUser = useFollowUser as jest.MockedFunction<typeof useFollowUser>;
const mockUseUnfollowUser = useUnfollowUser as jest.MockedFunction<typeof useUnfollowUser>;
const mockUsePublicAchievements = usePublicAchievements as jest.MockedFunction<
  typeof usePublicAchievements
>;
const mockUsePublicUserActivity = usePublicUserActivity as jest.MockedFunction<
  typeof usePublicUserActivity
>;
const mockUseHydratedNow = useHydratedNow as jest.MockedFunction<typeof useHydratedNow>;
let mockRouteHandle = '@Target_User';

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { title: string } }) => {
      const ReactNative = require('react-native');
      mockSetOptions(options);
      return <ReactNative.Text>{options.title}</ReactNative.Text>;
    },
  },
  useLocalSearchParams: () => ({ handle: mockRouteHandle }),
  usePathname: () => '/user/[handle]',
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useUserProfile', () => ({
  emitSocialFollowAnalyticsEvent: jest.requireActual('@/src/hooks/useUserProfile')
    .emitSocialFollowAnalyticsEvent,
  usePublicProfile: jest.fn(),
  useFollowUser: jest.fn(),
  useUnfollowUser: jest.fn(),
}));

jest.mock('@/src/hooks/useAchievements', () => ({
  usePublicAchievements: jest.fn(),
}));

jest.mock('@/src/hooks/useUserActivity', () => ({
  usePublicUserActivity: jest.fn(),
}));

jest.mock('@/src/hooks/useHydratedNow', () => ({
  useHydratedNow: jest.fn(),
}));

jest.mock('@/src/components', () => ({
  AuthModal: ({
    visible,
    message,
  }: {
    visible: boolean;
    message: string;
  }) => {
    if (!visible) {
      return null;
    }

    const ReactNative = require('react-native');
    return (
      <ReactNative.Text testID="public-profile-auth-modal">
        {message}
      </ReactNative.Text>
    );
  },
}));

jest.mock('@/src/components/ui/Button', () => ({
  Button: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress: () => void;
    testID?: string;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.Pressable onPress={onPress} testID={testID}>
        <ReactNative.Text>{label}</ReactNative.Text>
      </ReactNative.Pressable>
    );
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/UserAvatar', () => ({
  UserAvatar: ({
    displayName,
    username,
  }: {
    displayName: string;
    username: string;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.Text testID="public-profile-avatar">
        {displayName}:{username}
      </ReactNative.Text>
    );
  },
}));

jest.mock('@/src/components/ui/AchievementBadge', () => ({
  AchievementBadge: ({
    achievement,
  }: {
    achievement: { name: string };
  }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{achievement.name}</ReactNative.Text>;
  },
}));

jest.mock('@/src/utils/property-route', () => ({
  buildPropertyRoute: jest.fn(() => '/property/test'),
  toInternalAppHref: jest.fn((href: string) => href),
}));

function seedViewer() {
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

function seedSignedOutViewer() {
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

describe('PublicProfileScreen', () => {
  const followMutateAsync = jest.fn().mockResolvedValue(undefined);
  const unfollowMutateAsync = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteHandle = '@Target_User';
    seedViewer();
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: 'target-user',
        displayName: 'Target User',
        handle: 'target_user',
        profilePhotoUrl: null,
        homeCountry: 'NL',
        karma: 10,
        karmaRank: {
          title: 'Contributor',
          level: 2,
        },
        guessCount: 2,
        commentCount: 3,
        averageAccuracy: 88.4,
        joinedAt: '2026-01-01T00:00:00.000Z',
        followerCount: 4,
        followingCount: 5,
        relationship: 'none',
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePublicProfile>);
    mockUseFollowUser.mockReturnValue({
      mutateAsync: followMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useFollowUser>);
    mockUseUnfollowUser.mockReturnValue({
      mutateAsync: unfollowMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useUnfollowUser>);
    mockUsePublicAchievements.mockReturnValue({
      data: {
        earned: [
          {
            key: 'first_guess',
            name: 'First Guess',
            description: 'Submit your first price guess',
            icon: 'Target',
            category: 'guessing',
            awardedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      },
    } as unknown as ReturnType<typeof usePublicAchievements>);
    mockUsePublicUserActivity.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: 'activity-1',
                eventType: 'price_guess',
                actor: {
                  id: 'target-user',
                  displayName: 'Target User',
                  handle: 'target_user',
                  profilePhotoUrl: null,
                },
                property: {
                  id: 'property-1',
                  address: 'Main Street 1',
                  streetName: 'Main Street',
                  houseNumber: 1,
                  houseNumberAddition: null,
                  city: 'Eindhoven',
                  postalCode: '5611AA',
                  countryCode: 'NL',
                  geometry: null,
                  thumbnailUrl: null,
                },
                createdAt: '2026-01-02T10:00:00.000Z',
                meta: null,
              },
            ],
            pagination: {
              limit: 20,
              offset: 0,
              hasMore: false,
            },
          },
        ],
      },
    } as unknown as ReturnType<typeof usePublicUserActivity>);
    mockUseHydratedNow.mockReturnValue(new Date('2026-01-02T12:00:00.000Z').getTime());
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

  it('renders the shared public reputation surface and emits follow button analytics', async () => {
    const { getAllByText, getByTestId, getByText, queryByTestId } = render(
      <PublicProfileScreen />
    );

    expect(mockUsePublicProfile).toHaveBeenCalledWith('target_user');
    expect(mockUsePublicAchievements).toHaveBeenCalledWith('target-user');
    expect(mockUsePublicUserActivity).toHaveBeenCalledWith('target-user');

    expect(getByTestId('public-profile-avatar')).toHaveTextContent('Target User:target_user');
    expect(getAllByText('Target User').length).toBeGreaterThan(0);
    expect(getByText('@target_user')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('Following')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
    expect(getByText('Followers')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('Comments')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('GUESSES')).toBeTruthy();
    expect(getByText('10')).toBeTruthy();
    expect(getByText('KARMA')).toBeTruthy();
    expect(getByText('88%')).toBeTruthy();
    expect(getByText('ACCURACY')).toBeTruthy();
    expect(getByText('First Guess')).toBeTruthy();
    expect(getByText(/Guessed on/)).toBeTruthy();
    expect(getByText(/Main Street 1/)).toBeTruthy();
    expect(queryByTestId('profile-followers-link')).toBeNull();
    expect(queryByTestId('profile-following-link')).toBeNull();
    expect(queryByTestId('profile-settings')).toBeNull();
    expect(queryByTestId('profile-notifications')).toBeNull();
    expect(queryByTestId('profile-avatar-edit')).toBeNull();
    expect(queryByTestId('profile-display-name-edit')).toBeNull();
    expect(queryByTestId('profile-handle-edit')).toBeNull();

    fireEvent.press(getByTestId('public-profile-follow-button'));

    await waitFor(() => {
      expect(followMutateAsync).toHaveBeenCalledWith('target-user');
    });

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
          name: 'follow_button_impression',
          properties: expect.objectContaining({
            targetUserId: 'target-user',
            relationship: 'none',
          }),
        }),
        expect.objectContaining({
          name: 'follow_button_click',
          properties: expect.objectContaining({
            targetUserId: 'target-user',
            action: 'follow',
          }),
        }),
      ])
    );
  });

  it('shows not found and skips profile lookup for UUID-style routes', () => {
    mockRouteHandle = 'a0000000-0000-4000-a000-000000000099';

    const { getByText } = render(<PublicProfileScreen />);

    expect(mockUsePublicProfile).toHaveBeenCalledWith(null);
    expect(getByText('User not found')).toBeTruthy();
  });

  it('shows not found and skips profile lookup for bare handle routes', () => {
    mockRouteHandle = 'liza';

    const { getByText } = render(<PublicProfileScreen />);

    expect(mockUsePublicProfile).toHaveBeenCalledWith(null);
    expect(getByText('User not found')).toBeTruthy();
  });

  it('emits follow-click analytics and opens auth gating when a signed-out viewer taps follow', async () => {
    seedSignedOutViewer();

    const { getByTestId, findByTestId } = render(<PublicProfileScreen />);

    fireEvent.press(getByTestId('public-profile-follow-button'));

    expect(followMutateAsync).not.toHaveBeenCalled();
    expect(unfollowMutateAsync).not.toHaveBeenCalled();
    expect(await findByTestId('public-profile-auth-modal')).toHaveTextContent(
      'Sign in to follow people',
    );

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
          name: 'follow_button_click',
          properties: expect.objectContaining({
            action: 'follow',
            authenticated: false,
            targetUserId: 'target-user',
          }),
        }),
      ]),
    );
  });
});

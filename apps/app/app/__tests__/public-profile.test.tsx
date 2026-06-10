import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PublicProfileScreen from '../user/[id]';
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

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { title: string } }) => {
      const ReactNative = require('react-native');
      mockSetOptions(options);
      return <ReactNative.Text>{options.title}</ReactNative.Text>;
    },
  },
  useLocalSearchParams: () => ({ id: 'target-user' }),
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
    seedViewer();
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: 'target-user',
        displayName: 'Target User',
        handle: 'target-user',
        profilePhotoUrl: null,
        homeCountry: 'NL',
        karma: 10,
        karmaRank: {
          title: 'Contributor',
          level: 2,
        },
        guessCount: 2,
        commentCount: 3,
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

  it('keeps other-user counts as static labels and emits follow button analytics', async () => {
    const { getByTestId, getByText, queryByTestId } = render(<PublicProfileScreen />);

    expect(getByText('4')).toBeTruthy();
    expect(getByText('Followers')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('Following')).toBeTruthy();
    expect(queryByTestId('profile-followers-link')).toBeNull();
    expect(queryByTestId('profile-following-link')).toBeNull();

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

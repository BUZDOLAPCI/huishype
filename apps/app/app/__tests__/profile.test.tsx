import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileScreen from '../(tabs)/profile';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useMyProfile, useUpdateProfile } from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useUserProfile', () => ({
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
}));

jest.mock('@/src/hooks/useAchievements', () => ({
  useAchievements: jest.fn(),
}));

jest.mock('@/src/hooks/useUserActivity', () => ({
  useUserActivity: jest.fn(),
}));

jest.mock('@/src/hooks/useHydratedNow', () => ({
  useHydratedNow: jest.fn(),
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
  UserAvatar: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>UserAvatar</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/AchievementBadge', () => ({
  AchievementBadge: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>AchievementBadge</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/Comments/KarmaBadge', () => ({
  KarmaBadge: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>KarmaBadge</ReactNative.Text>;
  },
}));

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
}));

jest.mock('@/src/components/navigation/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{title}</ReactNative.Text>;
  },
}));

jest.mock('@/src/utils/property-route', () => ({
  buildPropertyRoute: jest.fn(() => '/property/test'),
  toInternalAppHref: jest.fn((href: string) => href),
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseMyProfile = useMyProfile as jest.MockedFunction<typeof useMyProfile>;
const mockUseUpdateProfile = useUpdateProfile as jest.MockedFunction<typeof useUpdateProfile>;
const mockUseAchievements = useAchievements as jest.MockedFunction<typeof useAchievements>;
const mockUseUserActivity = useUserActivity as jest.MockedFunction<typeof useUserActivity>;
const mockUseHydratedNow = useHydratedNow as jest.MockedFunction<typeof useHydratedNow>;

const signOut = jest.fn().mockResolvedValue(undefined);
const originalPlatform = Platform.OS;
const originalConfirm = globalThis.confirm;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function seedMocks() {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'user-1',
      username: 'test-user',
      displayName: 'Test User',
      profilePhotoUrl: undefined,
      karma: 42,
      karmaRank: 'Contributor',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    isAuthenticated: true,
    isLoading: false,
    accessToken: 'token',
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut,
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });

  mockUseMyProfile.mockReturnValue({
    data: {
      id: 'user-1',
      handle: 'test-user',
      displayName: 'Test User',
      profilePhotoUrl: null,
      karma: 42,
      karmaRank: {
        title: 'Contributor',
        level: 2,
      },
      guessCount: 5,
      commentCount: 2,
      joinedAt: '2026-01-01T00:00:00.000Z',
      followerCount: 4,
      followingCount: 5,
      email: 'test@example.com',
      averageAccuracy: 67,
      savedCount: 3,
      likedCount: 4,
      lastNameChangeAt: null,
    },
    isLoading: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useMyProfile>);

  mockUseUpdateProfile.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useUpdateProfile>);

  mockUseAchievements.mockReturnValue({
    data: {
      earned: [],
    },
  } as unknown as ReturnType<typeof useAchievements>);

  mockUseUserActivity.mockReturnValue({
    data: {
      pages: [],
    },
  } as unknown as ReturnType<typeof useUserActivity>);

  mockUseHydratedNow.mockReturnValue(Date.now());
}

describe('ProfileScreen sign out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });
    globalThis.confirm = originalConfirm;
  });

  it('signs out on web after confirmation', async () => {
    globalThis.confirm = jest.fn(() => true);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-settings'));
    fireEvent.press(getByTestId('settings-sign-out'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Are you sure you want to sign out?'
      );
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('does not sign out on web when confirmation is cancelled', async () => {
    globalThis.confirm = jest.fn(() => false);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-settings'));
    fireEvent.press(getByTestId('settings-sign-out'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeps self follower and following counts as navigation entrypoints', () => {
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-followers-link'));
    fireEvent.press(getByTestId('profile-following-link'));

    expect(getRouterPush()).toHaveBeenNthCalledWith(1, '/user/followers');
    expect(getRouterPush()).toHaveBeenNthCalledWith(2, '/user/following');
  });

  it('opens user search from the profile follow stats area', () => {
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-search-user-button'));

    expect(getRouterPush()).toHaveBeenCalledWith('/user/search');
  });
});

import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileScreen from '../(tabs)/profile';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { WebDismissibleLayerProvider } from '@/src/providers/WebDismissibleLayerProvider';
import { useMyProfile, useUpdateProfile } from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';

jest.mock('react-native', () => {
  const ReactNative = jest.requireActual('react-native');
  return {
    ...ReactNative,
    Alert: {
      alert: jest.fn(),
    },
  };
});

const mockAlert = jest.requireMock('react-native').Alert as {
  alert: jest.Mock;
};

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
const updateAuthUserProfile = jest.fn().mockResolvedValue(undefined);
const mutateProfileAsync = jest.fn().mockResolvedValue(undefined);
const originalPlatform = Platform.OS;
const originalConfirm = globalThis.confirm;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function seedSignedOutAuth() {
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
    signOut,
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
    updateAuthUserProfile,
  });
}

function seedMocks() {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'user-1',
      username: 'test-user',
      handle: 'test-user',
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
    updateAuthUserProfile,
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
      lastDisplayNameChangeAt: null,
      lastHandleChangeAt: null,
      displayNameChangeAvailableAt: null,
      handleChangeAvailableAt: null,
    },
    isLoading: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useMyProfile>);

  mockUseUpdateProfile.mockReturnValue({
    mutateAsync: mutateProfileAsync,
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
    mutateProfileAsync.mockResolvedValue(undefined);
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

  it('shows settings from the signed-out profile state', () => {
    seedSignedOutAuth();

    const { getByTestId, queryByTestId } = render(<ProfileScreen />);

    expect(getByTestId('profile-actions-header')).toBeTruthy();
    expect(getByTestId('profile-settings-anchor')).toBeTruthy();

    fireEvent.press(getByTestId('profile-settings'));

    expect(getByTestId('settings-open')).toBeTruthy();
    expect(queryByTestId('settings-sign-out')).toBeNull();

    fireEvent.press(getByTestId('settings-open'));

    expect(getRouterPush()).toHaveBeenCalledWith('/profile-settings');
  });

  it('shows settings and sign out from the signed-in loading profile state', () => {
    mockUseMyProfile.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useMyProfile>);

    const { getByTestId } = render(<ProfileScreen />);

    expect(getByTestId('profile-actions-header')).toBeTruthy();
    expect(getByTestId('profile-settings-anchor')).toBeTruthy();

    fireEvent.press(getByTestId('profile-settings'));

    expect(getByTestId('settings-open')).toBeTruthy();
    expect(getByTestId('settings-sign-out')).toBeTruthy();

    fireEvent.press(getByTestId('settings-open'));

    expect(getRouterPush()).toHaveBeenCalledWith('/profile-settings');
  });

  it('opens settings from the signed-in profile menu', () => {
    const { getByTestId } = render(<ProfileScreen />);

    expect(getByTestId('profile-actions-header')).toBeTruthy();
    expect(getByTestId('profile-settings-anchor')).toBeTruthy();

    fireEvent.press(getByTestId('profile-settings'));
    fireEvent.press(getByTestId('settings-open'));

    expect(getRouterPush()).toHaveBeenCalledWith('/profile-settings');
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

  it('renders display name above the handle with separate edit buttons', () => {
    const { getByText, getByTestId } = render(<ProfileScreen />);

    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('@test-user')).toBeTruthy();
    expect(getByTestId('profile-display-name-edit')).toBeTruthy();
    expect(getByTestId('profile-handle-edit')).toBeTruthy();
  });

  it('saves a trimmed display name from the inline editor', async () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-display-name-edit'));
    fireEvent.changeText(getByTestId('profile-display-name-input'), '  New Name  ');
    fireEvent.press(getByTestId('profile-display-name-save'));

    await waitFor(() => {
      expect(mutateProfileAsync).toHaveBeenCalledWith({ displayName: 'New Name' });
    });
    expect(queryByTestId('profile-display-name-input')).toBeNull();
  });

  it('normalizes and saves a handle from the inline editor', async () => {
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-handle-edit'));
    fireEvent.changeText(getByTestId('profile-handle-input'), '  @New_Handle  ');
    fireEvent.press(getByTestId('profile-handle-save'));

    await waitFor(() => {
      expect(mutateProfileAsync).toHaveBeenCalledWith({ handle: 'new_handle' });
    });
  });

  it('cancels display-name editing without saving', () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-display-name-edit'));
    expect(getByTestId('profile-display-name-input')).toBeTruthy();

    fireEvent.press(getByTestId('profile-display-name-cancel'));

    expect(queryByTestId('profile-display-name-input')).toBeNull();
    expect(getByTestId('profile-display-name-row')).toBeTruthy();
    expect(mutateProfileAsync).not.toHaveBeenCalled();
  });

  it('blocks invalid display names and handles before submit', () => {
    mockAlert.alert.mockClear();

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-display-name-edit'));
    fireEvent.changeText(getByTestId('profile-display-name-input'), ' A ');
    fireEvent.press(getByTestId('profile-display-name-save'));

    fireEvent.press(getByTestId('profile-handle-edit'));
    fireEvent.changeText(getByTestId('profile-handle-input'), '@bad-handle');
    fireEvent.press(getByTestId('profile-handle-save'));

    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Invalid Display Name',
      'Display name must be between 2 and 50 characters.'
    );
    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Invalid Handle',
      'Handle must be 3 to 20 letters, numbers, or underscores.'
    );
    expect(mutateProfileAsync).not.toHaveBeenCalled();
  });

  it('shows cooldown alerts with the next available dates', () => {
    mockAlert.alert.mockClear();
    mockUseHydratedNow.mockReturnValue(new Date('2026-05-21T12:00:00.000Z').getTime());
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
        relationship: 'self',
        homeCountry: 'NL',
        email: 'test@example.com',
        averageAccuracy: 67,
        savedCount: 3,
        likedCount: 4,
        lastNameChangeAt: null,
        lastDisplayNameChangeAt: '2026-05-20T00:00:00.000Z',
        lastHandleChangeAt: '2026-05-01T00:00:00.000Z',
        displayNameChangeAvailableAt: '2026-05-27T00:00:00.000Z',
        handleChangeAvailableAt: '2026-05-31T00:00:00.000Z',
      },
      isLoading: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useMyProfile>);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-display-name-edit'));
    fireEvent.press(getByTestId('profile-handle-edit'));

    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Display Name Cooldown',
      expect.stringContaining('You can change your display name again on')
    );
    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Handle Cooldown',
      expect.stringContaining('You can change your handle again on')
    );
    expect(mutateProfileAsync).not.toHaveBeenCalled();
  });

  it('closes the settings dropdown on web popstate before route navigation', () => {
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);

    try {
      const { getByTestId, queryByTestId } = renderWithDismissibleLayer(
        <ProfileScreen />
      );

      fireEvent.press(getByTestId('profile-settings'));
      expect(getByTestId('settings-sign-out')).toBeTruthy();

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(queryByTestId('settings-sign-out')).toBeNull();
      expect(routeNavigation).not.toHaveBeenCalled();
      expect(getRouterPush()).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
    }
  });
});

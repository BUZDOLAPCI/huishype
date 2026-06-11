import React from 'react';
import { Platform, Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import ProfileScreen from '../(tabs)/profile';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { WebDismissibleLayerProvider } from '@/src/providers/WebDismissibleLayerProvider';
import {
  useDeleteProfilePhoto,
  useMyProfile,
  useUpdateProfile,
  useUploadProfilePhoto,
} from '@/src/hooks/useUserProfile';
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
    Share: {
      share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
    },
  };
});

const mockAlert = jest.requireMock('react-native').Alert as {
  alert: jest.Mock;
};
const mockShare = Share.share as jest.Mock;

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useUserProfile', () => ({
  useDeleteProfilePhoto: jest.fn(),
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useUploadProfilePhoto: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
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
  Icon: ({ name, testID }: { name: string; testID?: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text testID={testID}>{name}</ReactNative.Text>;
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

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
}));

jest.mock('@/src/utils/property-route', () => ({
  buildPropertyRoute: jest.fn(() => '/property/test'),
  toInternalAppHref: jest.fn((href: string) => href),
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseDeleteProfilePhoto = useDeleteProfilePhoto as jest.MockedFunction<
  typeof useDeleteProfilePhoto
>;
const mockUseMyProfile = useMyProfile as jest.MockedFunction<typeof useMyProfile>;
const mockUseUpdateProfile = useUpdateProfile as jest.MockedFunction<typeof useUpdateProfile>;
const mockUseUploadProfilePhoto = useUploadProfilePhoto as jest.MockedFunction<
  typeof useUploadProfilePhoto
>;
const mockUseAchievements = useAchievements as jest.MockedFunction<typeof useAchievements>;
const mockUseUserActivity = useUserActivity as jest.MockedFunction<typeof useUserActivity>;
const mockUseHydratedNow = useHydratedNow as jest.MockedFunction<typeof useHydratedNow>;
const mockRequestMediaLibraryPermissionsAsync =
  ImagePicker.requestMediaLibraryPermissionsAsync as jest.MockedFunction<
    typeof ImagePicker.requestMediaLibraryPermissionsAsync
  >;
const mockLaunchImageLibraryAsync = ImagePicker.launchImageLibraryAsync as jest.MockedFunction<
  typeof ImagePicker.launchImageLibraryAsync
>;

const signOut = jest.fn().mockResolvedValue(undefined);
const updateAuthUserProfile = jest.fn().mockResolvedValue(undefined);
const mutateProfileAsync = jest.fn().mockResolvedValue(undefined);
const uploadProfilePhoto = jest.fn().mockResolvedValue(undefined);
const deleteProfilePhoto = jest.fn().mockResolvedValue(undefined);
const originalPlatform = Platform.OS;
const originalConfirm = globalThis.confirm;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;
const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;

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
    verifyEmailCode: jest.fn(),
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
    verifyEmailCode: jest.fn(),
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
      hasDisplayName: true,
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

  mockUseUploadProfilePhoto.mockReturnValue({
    mutateAsync: uploadProfilePhoto,
    isPending: false,
  } as unknown as ReturnType<typeof useUploadProfilePhoto>);

  mockUseDeleteProfilePhoto.mockReturnValue({
    mutateAsync: deleteProfilePhoto,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteProfilePhoto>);

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
  let replaceStateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/profile');
    replaceStateSpy = jest.spyOn(window.history, 'replaceState');
    mutateProfileAsync.mockResolvedValue(undefined);
    uploadProfilePhoto.mockResolvedValue(undefined);
    deleteProfilePhoto.mockResolvedValue(undefined);
    seedMocks();
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
      canAskAgain: true,
      expires: 'never',
    } as ImagePicker.MediaLibraryPermissionResponse);
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
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

    expect(getRouterPush()).toHaveBeenCalledWith('/settings');
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings');
    expect(replaceStateSpy).not.toHaveBeenCalled();
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

    expect(getRouterPush()).toHaveBeenCalledWith('/settings');
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings');
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('opens settings from the signed-in profile menu', () => {
    const { getByTestId } = render(<ProfileScreen />);

    expect(getByTestId('profile-actions-header')).toBeTruthy();
    expect(getByTestId('profile-settings-anchor')).toBeTruthy();

    fireEvent.press(getByTestId('profile-settings'));
    fireEvent.press(getByTestId('settings-open'));

    expect(getRouterPush()).toHaveBeenCalledWith('/settings');
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings');
    expect(replaceStateSpy).not.toHaveBeenCalled();
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

  it('shares the current user profile from the top header', async () => {
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-share'));

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test User - HuisHype',
          url: expect.stringMatching(/\/user\/user-1$/),
          message: expect.stringContaining('@test-user'),
        })
      );
    });
  });

  it('renders display name above the handle with separate edit buttons', () => {
    const { getByText, getByTestId } = render(<ProfileScreen />);
    const [avatarEditStyle] = getByTestId('profile-avatar-edit').props.style;
    const avatarEditIconBadgeStyle = getByTestId('profile-avatar-edit-icon-badge').props.style;

    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('@test-user')).toBeTruthy();
    expect(getByTestId('profile-avatar-edit')).toBeTruthy();
    expect(getByTestId('profile-avatar-edit-icon').props.children).toBe('PencilSimple');
    expect(avatarEditStyle).toMatchObject({
      width: 41,
      height: 41,
      borderRadius: 20.5,
      backgroundColor: '#FEF6EE',
    });
    expect(avatarEditStyle).not.toHaveProperty('borderWidth');
    expect(avatarEditStyle).not.toHaveProperty('shadowColor');
    expect(avatarEditStyle).not.toHaveProperty('elevation');
    expect(avatarEditIconBadgeStyle).toMatchObject({
      width: 31,
      height: 31,
      borderRadius: 15.5,
      backgroundColor: '#00D1FB',
    });
    expect(getByTestId('profile-display-name-edit')).toBeTruthy();
    expect(getByTestId('profile-handle-edit')).toBeTruthy();
    expect(getByTestId('profile-likes-stat')).toBeTruthy();
    expect(getByText('Likes')).toBeTruthy();
  });

  it('renders guesses karma and accuracy inside the Stats group', () => {
    const { getAllByText, getByText } = render(<ProfileScreen />);

    expect(getByText('Stats')).toBeTruthy();
    expect(getByText('GUESSES')).toBeTruthy();
    expect(getByText('KARMA')).toBeTruthy();
    expect(getByText('ACCURACY')).toBeTruthy();
    expect(getAllByText('5').length).toBeGreaterThan(0);
    expect(getByText('42')).toBeTruthy();
    expect(getByText('67%')).toBeTruthy();
  });

  it('renders add name when display name has not been set and opens a blank editor', () => {
    mockUseMyProfile.mockReturnValue({
      data: {
        id: 'user-1',
        handle: 'test-user',
        displayName: 'test-user',
        hasDisplayName: false,
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

    const { getByText, getByTestId } = render(<ProfileScreen />);

    expect(getByText('Add name')).toBeTruthy();

    fireEvent.press(getByTestId('profile-display-name-edit'));

    expect(getByTestId('profile-display-name-input').props.value).toBe('');
  });

  it('does not upload when the avatar image picker is cancelled', async () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-avatar-edit'));

    await waitFor(() => {
      expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    });
    expect(queryByTestId('profile-avatar-actions')).toBeNull();
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it('uploads a selected avatar image', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ base64: 'base64-image', mimeType: 'image/jpeg', uri: 'file:///avatar.jpg' }],
    } as ImagePicker.ImagePickerSuccessResult);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-avatar-edit'));

    await waitFor(() => {
      expect(uploadProfilePhoto).toHaveBeenCalledWith({
        imageBase64: 'base64-image',
        mimeType: 'image/jpeg',
      });
    });
    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Profile picture saved',
      'Your profile picture has been updated.'
    );
  });

  it('shows a localized alert when avatar photo library permission is denied', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
      canAskAgain: true,
      expires: 'never',
    } as ImagePicker.MediaLibraryPermissionResponse);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-avatar-edit'));

    await waitFor(() => {
      expect(mockAlert.alert).toHaveBeenCalledWith(
        'Profile picture',
        'Allow photo library access to choose a profile picture.'
      );
    });
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it('shows a localized alert when avatar upload fails', async () => {
    uploadProfilePhoto.mockRejectedValueOnce(new Error('upload failed'));
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ base64: 'base64-image', mimeType: 'image/png', uri: 'file:///avatar.png' }],
    } as ImagePicker.ImagePickerSuccessResult);

    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-avatar-edit'));

    await waitFor(() => {
      expect(mockAlert.alert).toHaveBeenCalledWith(
        'Profile picture',
        'Could not save this profile picture. Try another photo or try again later.'
      );
    });
  });

  it('shows avatar remove action for an existing photo and deletes after confirmation', async () => {
    globalThis.confirm = jest.fn(() => true);
    mockUseMyProfile.mockReturnValue({
      data: {
        id: 'user-1',
        handle: 'test-user',
        displayName: 'Test User',
        hasDisplayName: true,
        profilePhotoUrl: 'https://media.example/avatar.jpg',
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

    const { getByTestId, queryByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-avatar-edit'));
    expect(getByTestId('profile-avatar-actions')).toBeTruthy();
    expect(getByTestId('profile-avatar-select')).toBeTruthy();
    expect(getByTestId('profile-avatar-remove')).toBeTruthy();
    expect(getByTestId('profile-avatar-actions-backdrop')).toBeTruthy();
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('profile-avatar-actions-backdrop'));
    expect(queryByTestId('profile-avatar-actions')).toBeNull();

    fireEvent.press(getByTestId('profile-avatar-edit'));
    fireEvent.press(getByTestId('profile-avatar-remove'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith('Remove your current profile picture?');
      expect(deleteProfilePhoto).toHaveBeenCalledTimes(1);
    });
    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Profile picture removed',
      'Your profile picture has been removed.'
    );
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
    expect(getByTestId('profile-handle-prefix')).toBeTruthy();
    expect(getByTestId('profile-handle-input').props.value).toBe('test-user');
    expect(getByTestId('profile-handle-input').props.maxLength).toBe(20);

    fireEvent.changeText(getByTestId('profile-handle-input'), '  @New_Handle  ');
    expect(getByTestId('profile-handle-input').props.value).toBe('  New_Handle  ');
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
        hasDisplayName: true,
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

import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileSettingsScreen from '../(tabs)/profile-settings';
import { useAuthContext } from '@/src/providers/AuthProvider';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/components', () => ({
  AuthModal: ({ visible }: { visible: boolean }) => {
    const ReactNative = require('react-native');
    return visible ? <ReactNative.Text>AuthModal</ReactNative.Text> : null;
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const signOut = jest.fn().mockResolvedValue(undefined);
const originalPlatform = Platform.OS;
const originalConfirm = globalThis.confirm;
const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function mockAuthContext(user: { id: string } | null) {
  mockUseAuthContext.mockReturnValue({
    user: user
      ? {
          id: user.id,
          username: 'test-user',
          displayName: 'Test User',
          profilePhotoUrl: undefined,
          karma: 42,
          karmaRank: 'Contributor',
          createdAt: '2026-01-01T00:00:00.000Z',
        }
      : null,
    isAuthenticated: !!user,
    isLoading: false,
    accessToken: user ? 'token' : null,
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut,
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });
}

describe('ProfileSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('shows the login row and version when signed out', () => {
    mockAuthContext(null);

    const { getByTestId, getByText, queryByText } = render(<ProfileSettingsScreen />);

    expect(getByText('Legal')).toBeTruthy();
    expect(getByText('Need help?')).toBeTruthy();
    expect(getByText('Log in')).toBeTruthy();
    expect(queryByText('Terms and Conditions')).toBeNull();
    expect(getByTestId('settings-version').props.children).toBe('Version 0.0.1');

    fireEvent.press(getByTestId('settings-auth-row'));

    expect(getByText('AuthModal')).toBeTruthy();
  });

  it('signs out from the settings row after web confirmation', async () => {
    mockAuthContext({ id: 'user-1' });
    globalThis.confirm = jest.fn(() => true);

    const { getByTestId, getByText } = render(<ProfileSettingsScreen />);

    expect(getByText('Log out')).toBeTruthy();

    fireEvent.press(getByTestId('settings-auth-row'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Are you sure you want to sign out?'
      );
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the legal submenu, navigates legal rows, and backs to main settings', () => {
    mockAuthContext(null);

    const { getByTestId, getByText, queryByTestId } = render(<ProfileSettingsScreen />);

    fireEvent.press(getByTestId('settings-legal-row'));

    expect(getByTestId('settings-legal-submenu')).toBeTruthy();
    expect(getByText('Terms and Conditions')).toBeTruthy();
    expect(getByText('Privacy Policy')).toBeTruthy();
    expect(queryByTestId('settings-auth-row')).toBeNull();

    fireEvent.press(getByTestId('settings-terms-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/terms');

    fireEvent.press(getByTestId('settings-privacy-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/privacy');

    fireEvent.press(getByTestId('profile-settings-back'));
    expect(getByTestId('settings-auth-row')).toBeTruthy();
  });

  it('navigates the help row to contact', () => {
    mockAuthContext(null);

    const { getByTestId } = render(<ProfileSettingsScreen />);

    fireEvent.press(getByTestId('settings-contact-row'));

    expect(getRouterPush()).toHaveBeenCalledWith('/contact');
  });

  it('dismisses to the profile tab from the back arrow', () => {
    mockAuthContext(null);

    const { getByTestId } = render(<ProfileSettingsScreen />);

    fireEvent.press(getByTestId('profile-settings-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile');
  });

  it('dismisses to the profile tab on browser back', () => {
    mockAuthContext(null);

    render(<ProfileSettingsScreen />);

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile');
  });
});

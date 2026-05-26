import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileSettingsScreen from '../(tabs)/settings';
import { LANGUAGE_STORAGE_KEY, LanguageProvider } from '@/src/i18n';
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
  AuthModal: ({ message, visible }: { message: string; visible: boolean }) => {
    const ReactNative = require('react-native');
    return visible ? <ReactNative.Text>{message}</ReactNative.Text> : null;
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
const originalWindowOpen = window.open;
const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function mockAuthContext(user: { id: string; email?: string } | null) {
  mockUseAuthContext.mockReturnValue({
    user: user
      ? {
          id: user.id,
          email: user.email ?? 'test@example.com',
          username: 'test-user',
          handle: 'test-user',
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

function renderSettings() {
  return render(
    <LanguageProvider>
      <ProfileSettingsScreen />
    </LanguageProvider>
  );
}

describe('ProfileSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
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
    window.open = originalWindowOpen;
  });

  it('shows the login row and version when signed out', () => {
    mockAuthContext(null);

    const { getByTestId, getByText, queryByText } = renderSettings();

    expect(getByText('Language')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
    expect(getByText('Legal')).toBeTruthy();
    expect(getByText('Need help?')).toBeTruthy();
    expect(getByText('Contact')).toBeTruthy();
    expect(getByText('Log in')).toBeTruthy();
    expect(queryByText('Account email')).toBeNull();
    expect(queryByText('Terms and Conditions')).toBeNull();
    expect(getByTestId('settings-version').props.children).toBe('Version 0.0.1');

    fireEvent.press(getByTestId('settings-auth-row'));

    expect(getByText('Sign in to HuisHype')).toBeTruthy();
  });

  it('signs out from the settings row after web confirmation', async () => {
    mockAuthContext({ id: 'user-1' });
    globalThis.confirm = jest.fn(() => true);

    const { getByTestId, getByText } = renderSettings();

    expect(getByText('Account email')).toBeTruthy();
    expect(getByTestId('settings-account-email-row').props.accessibilityRole).toBe('text');
    expect(getByTestId('settings-account-email-value').props.children).toBe('test@example.com');
    expect(getByTestId('settings-language-row')).toBeTruthy();
    expect(getByText('Log out')).toBeTruthy();

    fireEvent.press(getByTestId('settings-auth-row'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith('Are you sure you want to sign out?');
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the legal submenu, navigates legal rows, and backs to main settings', () => {
    mockAuthContext(null);

    const { getByTestId, getByText, queryByTestId } = renderSettings();

    fireEvent.press(getByTestId('settings-legal-row'));

    expect(getByTestId('settings-legal-submenu')).toBeTruthy();
    expect(getByText('Terms and Conditions')).toBeTruthy();
    expect(getByText('Privacy Policy')).toBeTruthy();
    expect(getByText('Cookies')).toBeTruthy();
    expect(getByText('Data & privacy choices')).toBeTruthy();
    expect(getByText('Sharing permissions')).toBeTruthy();
    expect(getByText('Open source licenses')).toBeTruthy();
    expect(queryByTestId('settings-auth-row')).toBeNull();

    fireEvent.press(getByTestId('settings-terms-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/terms');

    fireEvent.press(getByTestId('settings-privacy-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/privacy');

    fireEvent.press(getByTestId('settings-cookies-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/cookies');

    fireEvent.press(getByTestId('settings-data-privacy-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/data-privacy');

    fireEvent.press(getByTestId('settings-sharing-permissions-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/sharing-permissions');

    fireEvent.press(getByTestId('profile-settings-back'));
    expect(getByTestId('settings-auth-row')).toBeTruthy();
  });

  it('opens open source licenses from legal and backs to the legal submenu', () => {
    mockAuthContext(null);

    window.open = jest.fn();

    const {
      getAllByLabelText,
      getAllByText,
      getByLabelText,
      getByTestId,
      getByText,
      queryByTestId,
    } = renderSettings();

    fireEvent.press(getByTestId('settings-legal-row'));
    fireEvent.press(getByTestId('settings-open-source-licenses-row'));

    expect(getByText('Open source licenses')).toBeTruthy();
    expect(getByTestId('settings-open-source-licenses-subview')).toBeTruthy();
    expect(queryByTestId('settings-legal-submenu')).toBeNull();

    expect(getByText('OpenStreetMap contributors')).toBeTruthy();
    expect(getByText('Map data - ODbL-1.0')).toBeTruthy();
    expect(getByText('https://www.openstreetmap.org/copyright')).toBeTruthy();
    expect(getByText('OpenMapTiles')).toBeTruthy();
    expect(getByText('Vector tile schema - BSD-3-Clause / CC-BY-4.0')).toBeTruthy();
    expect(getByText('https://openmaptiles.org/')).toBeTruthy();
    expect(getByText('@maplibre/maplibre-react-native')).toBeTruthy();
    expect(getByText('11.0.0-beta.10 - MIT')).toBeTruthy();
    expect(getByText('https://github.com/maplibre/maplibre-react-native#readme')).toBeTruthy();
    expect(getByText('maplibre-gl')).toBeTruthy();
    expect(getByText('5.21.1 - BSD-3-Clause')).toBeTruthy();
    expect(getByText('https://maplibre.org/')).toBeTruthy();
    expect(getByText('react-native')).toBeTruthy();
    expect(getAllByText('0.81.5 - MIT').length).toBeGreaterThan(0);

    fireEvent.press(getAllByLabelText('Open BSD-3-Clause license')[0]);
    expect(window.open).toHaveBeenCalledWith(
      'https://spdx.org/licenses/BSD-3-Clause.html',
      '_blank',
      'noopener,noreferrer'
    );

    fireEvent.press(getByLabelText('Open source link for maplibre-gl'));
    expect(window.open).toHaveBeenLastCalledWith(
      'https://maplibre.org/',
      '_blank',
      'noopener,noreferrer'
    );

    fireEvent.press(getByTestId('profile-settings-back'));

    expect(getByTestId('settings-legal-submenu')).toBeTruthy();
    expect(getByTestId('settings-open-source-licenses-row')).toBeTruthy();
    expect(queryByTestId('settings-open-source-licenses-subview')).toBeNull();
  });

  it('navigates help center and contact rows', () => {
    mockAuthContext(null);

    const { getByTestId } = renderSettings();

    fireEvent.press(getByTestId('settings-help-row'));
    expect(getRouterPush()).toHaveBeenCalledWith('/help');

    fireEvent.press(getByTestId('settings-contact-row'));

    expect(getRouterPush()).toHaveBeenCalledWith('/contact');
  });

  it('dismisses to the profile tab from the back arrow', () => {
    mockAuthContext(null);

    const { getByTestId } = renderSettings();

    fireEvent.press(getByTestId('profile-settings-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile');
  });

  it('dismisses to the profile tab on browser back', () => {
    mockAuthContext(null);

    renderSettings();

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile');
  });

  it('selects and persists Dutch from the language subview while signed out', async () => {
    mockAuthContext(null);

    const { getByLabelText, getByTestId, getByText } = renderSettings();

    fireEvent.press(getByTestId('settings-language-row'));

    expect(getByTestId('settings-language-subview')).toBeTruthy();
    expect(getByLabelText('English, selected')).toBeTruthy();
    expect(getByTestId('settings-language-en').props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(getByTestId('settings-language-nl'));

    await waitFor(() => {
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('nl');
    });

    expect(getByLabelText('Nederlands, geselecteerd')).toBeTruthy();
    expect(getByTestId('settings-language-nl').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByText('Taal')).toBeTruthy();

    fireEvent.press(getByTestId('profile-settings-back'));

    expect(getByText('Juridisch')).toBeTruthy();
    expect(getByText('Inloggen')).toBeTruthy();
    expect(getByTestId('settings-version').props.children).toBe('Versie 0.0.1');
  });

  it('loads the persisted language and translates signed-in account settings', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'nl');
    mockAuthContext({ id: 'user-1' });

    const { getByTestId, getByText } = renderSettings();

    await waitFor(() => {
      expect(getByText('Account-e-mail')).toBeTruthy();
    });

    expect(getByTestId('settings-account-email-row').props.accessibilityLabel).toBe(
      'Account-e-mail test@example.com'
    );
    expect(getByText('Taal')).toBeTruthy();
    expect(getByText('Nederlands')).toBeTruthy();
    expect(getByText('Uitloggen')).toBeTruthy();
  });
});

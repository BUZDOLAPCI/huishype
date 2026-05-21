import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import CookiesScreen from '../(tabs)/cookies';
import DataPrivacyScreen from '../(tabs)/data-privacy';
import TermsScreen from '../(tabs)/terms';
import PrivacyScreen from '../(tabs)/privacy';
import SharingPermissionsScreen from '../(tabs)/sharing-permissions';

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;

describe('Legal pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders HuisHype terms content and returns to settings', () => {
    const { getByTestId, getByText } = render(<TermsScreen />);

    expect(getByTestId('terms-screen')).toBeTruthy();
    expect(getByText('Terms and Conditions')).toBeTruthy();
    expect(getByText('Last updated: May 21, 2026')).toBeTruthy();
    expect(getByText(/social real estate browsing app/i)).toBeTruthy();
    expect(getByText(/not a broker, mortgage adviser/i)).toBeTruthy();
    expect(getByText(/contact@huishype.nl/i)).toBeTruthy();

    fireEvent.press(getByTestId('static-page-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile-settings');
  });

  it('renders HuisHype privacy content and EU rights', () => {
    const { getByTestId, getByText } = render(<PrivacyScreen />);

    expect(getByTestId('privacy-screen')).toBeTruthy();
    expect(getByText('Privacy Policy')).toBeTruthy();
    expect(getByText('Last updated: May 21, 2026')).toBeTruthy();
    expect(getByText(/analytics events, and error logs/i)).toBeTruthy();
    expect(getByText(/rights to access, correct, delete/i)).toBeTruthy();
  });

  it('renders expanded cookies, data choices, and sharing permissions pages', () => {
    expect(render(<CookiesScreen />).getByText('Cookie Policy')).toBeTruthy();
    expect(render(<DataPrivacyScreen />).getByText('Data and Privacy Choices')).toBeTruthy();
    expect(render(<SharingPermissionsScreen />).getByText('Sharing Permissions')).toBeTruthy();
  });
});

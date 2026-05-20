import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import TermsScreen from '../(tabs)/terms';
import PrivacyScreen from '../(tabs)/privacy';

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
    expect(getByText('Last updated: May 20, 2026')).toBeTruthy();
    expect(getByText(/social real estate browsing app/i)).toBeTruthy();
    expect(getByText(/contact@huishype.nl/i)).toBeTruthy();
    expect(getByText(/support@huishype.nl/i)).toBeTruthy();

    fireEvent.press(getByTestId('legal-page-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/profile-settings');
  });

  it('renders HuisHype privacy content and EU rights', () => {
    const { getByTestId, getByText } = render(<PrivacyScreen />);

    expect(getByTestId('privacy-screen')).toBeTruthy();
    expect(getByText('Privacy Policy')).toBeTruthy();
    expect(getByText('Last updated: May 20, 2026')).toBeTruthy();
    expect(getByText(/analytics events, and error logs/i)).toBeTruthy();
    expect(getByText(/rights to access, correct, delete/i)).toBeTruthy();
  });
});

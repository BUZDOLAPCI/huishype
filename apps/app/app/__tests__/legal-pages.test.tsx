import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import CookiesScreen from '../cookies';
import DataPrivacyScreen from '../data-privacy';
import TermsScreen from '../terms';
import PrivacyScreen from '../privacy';
import SharingPermissionsScreen from '../sharing-permissions';

const mockUseLanguage = jest.fn(() => ({
  language: 'en',
  setLanguage: jest.fn(),
  t: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/src/i18n', () => ({
  useLanguage: () => mockUseLanguage(),
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;
const getRouterBack = () =>
  (jest.requireMock('expo-router') as { router: { back: jest.Mock } }).router.back;

describe('Legal pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });
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

    expect(getRouterReplace()).toHaveBeenCalledWith('/settings/legal');
    expect(getRouterBack()).not.toHaveBeenCalled();
  });

  it('uses the legal settings parent route on direct legal page entry', () => {
    const { getByTestId } = render(<TermsScreen />);

    fireEvent.press(getByTestId('static-page-back'));

    expect(getRouterReplace()).toHaveBeenCalledWith('/settings/legal');
    expect(getRouterBack()).not.toHaveBeenCalled();
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

  it('renders Dutch legal pages from the localized catalog', () => {
    mockUseLanguage.mockReturnValue({
      language: 'nl',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });

    const terms = render(<TermsScreen />);

    expect(terms.getByText('Algemene voorwaarden')).toBeTruthy();
    expect(terms.getByText('Laatst bijgewerkt: 21 mei 2026')).toBeTruthy();
    expect(terms.getByText(/HuisHype is geen makelaar/i)).toBeTruthy();

    expect(render(<PrivacyScreen />).getByText('Privacybeleid')).toBeTruthy();
    expect(render(<DataPrivacyScreen />).getByText('Gegevens- en privacykeuzes')).toBeTruthy();
    expect(render(<SharingPermissionsScreen />).getByText('Machtigingen delen')).toBeTruthy();
  });
});

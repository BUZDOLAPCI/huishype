import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ContactScreen from '../contact';
import { api } from '@/src/utils/api';

const mockUseLanguage = jest.fn(() => ({
  language: 'en',
  setLanguage: jest.fn(),
  t: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  },
}));

jest.mock('@/src/i18n', () => ({
  useLanguage: () => mockUseLanguage(),
}));

jest.mock('@/src/utils/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

const mockApi = api as jest.Mocked<typeof api>;
const getRouterReplace = () =>
  (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router.replace;
const getRouterBack = () =>
  (jest.requireMock('expo-router') as { router: { back: jest.Mock } }).router.back;

describe('ContactScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });
  });

  it('renders support details and returns to settings', () => {
    const { getByTestId, getByText } = render(<ContactScreen />);

    expect(getByTestId('contact-screen')).toBeTruthy();
    expect(getByText('General: contact@huishype.nl')).toBeTruthy();
    expect(getByText('Support: support@huishype.nl')).toBeTruthy();

    fireEvent.press(getByTestId('contact-page-back'));

    expect(getRouterBack()).toHaveBeenCalledTimes(1);
    expect(getRouterReplace()).not.toHaveBeenCalledWith('/settings');
  });

  it('validates email format before posting', () => {
    const { getByTestId, getByText } = render(<ContactScreen />);

    fireEvent.changeText(getByTestId('contact-name-input'), 'Casey');
    fireEvent.changeText(getByTestId('contact-email-input'), 'not-an-email');
    fireEvent.changeText(getByTestId('contact-message-input'), 'I need help with my saved homes.');
    fireEvent.press(getByTestId('contact-submit-button'));

    expect(getByText('Enter a valid email address.')).toBeTruthy();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('posts contact messages and shows success', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Message received.' });

    const { getByTestId, getByText } = render(<ContactScreen />);

    fireEvent.changeText(getByTestId('contact-name-input'), 'Casey');
    fireEvent.changeText(getByTestId('contact-email-input'), 'casey@example.com');
    fireEvent.changeText(getByTestId('contact-subject-input'), 'Listing source');
    fireEvent.changeText(
      getByTestId('contact-message-input'),
      'A listing source link looks wrong.'
    );
    fireEvent.press(getByTestId('contact-submit-button'));

    expect(getByText('Sending...')).toBeTruthy();

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/contact', {
        name: 'Casey',
        email: 'casey@example.com',
        subject: 'Listing source',
        message: 'A listing source link looks wrong.',
      });
      expect(getByText('Message received.')).toBeTruthy();
    });
  });

  it('shows an error when the contact request fails', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('network failed'));

    const { getByTestId, getByText } = render(<ContactScreen />);

    fireEvent.changeText(getByTestId('contact-name-input'), 'Casey');
    fireEvent.changeText(getByTestId('contact-email-input'), 'casey@example.com');
    fireEvent.changeText(getByTestId('contact-message-input'), 'I cannot open profile settings.');
    fireEvent.press(getByTestId('contact-submit-button'));

    await waitFor(() => {
      expect(getByText(/We could not send your message/i)).toBeTruthy();
    });
  });

  it('renders Dutch contact copy and keeps the POST payload unchanged', async () => {
    mockUseLanguage.mockReturnValue({
      language: 'nl',
      setLanguage: jest.fn(),
      t: jest.fn(),
    });
    mockApi.post.mockResolvedValueOnce({ message: 'Message received.' });

    const { getByTestId, getByText, getByPlaceholderText } = render(<ContactScreen />);

    expect(getByText(/Hulp nodig met HuisHype/i)).toBeTruthy();
    expect(getByText('Algemeen: contact@huishype.nl')).toBeTruthy();
    expect(getByPlaceholderText('Je naam')).toBeTruthy();
    expect(getByText('Bericht sturen')).toBeTruthy();

    fireEvent.changeText(getByTestId('contact-name-input'), 'Casey');
    fireEvent.changeText(getByTestId('contact-email-input'), 'casey@example.com');
    fireEvent.changeText(getByTestId('contact-subject-input'), 'Listing source');
    fireEvent.changeText(
      getByTestId('contact-message-input'),
      'A listing source link looks wrong.'
    );
    fireEvent.press(getByTestId('contact-submit-button'));

    expect(getByText('Versturen...')).toBeTruthy();

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/contact', {
        name: 'Casey',
        email: 'casey@example.com',
        subject: 'Listing source',
        message: 'A listing source link looks wrong.',
      });
      expect(getByText('Bedankt. We hebben je bericht ontvangen.')).toBeTruthy();
    });
  });
});

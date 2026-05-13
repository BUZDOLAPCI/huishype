import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { WelcomeModal } from '../WelcomeModal';
import { WebDismissibleLayerProvider } from '../../providers/WebDismissibleLayerProvider';

const originalPlatform = Platform.OS;

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

describe('WelcomeModal', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('renders the branded HuisHype introduction', () => {
    const { getByText, getByTestId } = render(
      <WelcomeModal visible onClose={jest.fn()} />
    );

    expect(getByTestId('welcome-modal-card')).toBeTruthy();
    expect(getByText('Welcome to HuisHype')).toBeTruthy();
    expect(getByText('Browse the map')).toBeTruthy();
    expect(getByText("Guess what it's worth")).toBeTruthy();
    expect(getByText('See what people notice')).toBeTruthy();
    expect(getByText(/You can browse freely/)).toBeTruthy();
  });

  it('dismisses from the primary action', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <WelcomeModal visible onClose={onClose} />
    );

    fireEvent.press(getByTestId('welcome-modal-dismiss-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses from the close button', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <WelcomeModal visible onClose={onClose} />
    );

    fireEvent.press(getByTestId('welcome-modal-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on web popstate before route navigation listeners run', () => {
    setPlatform('web');
    const onClose = jest.fn();
    const routeNavigation = jest.fn();
    window.addEventListener('popstate', routeNavigation);

    try {
      renderWithDismissibleLayer(<WelcomeModal visible onClose={onClose} />);

      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(routeNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', routeNavigation);
    }
  });

  it('returns null when hidden', () => {
    const { queryByText } = render(
      <WelcomeModal visible={false} onClose={jest.fn()} />
    );

    expect(queryByText('Welcome to HuisHype')).toBeNull();
  });
});

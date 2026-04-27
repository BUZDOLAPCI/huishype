import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { WelcomeModal } from '../WelcomeModal';

describe('WelcomeModal', () => {
  it('renders the branded HuisHype introduction', () => {
    const { getByText, getByTestId } = render(
      <WelcomeModal visible onClose={jest.fn()} />
    );

    expect(getByTestId('welcome-modal-card')).toBeTruthy();
    expect(getByText('Welcome to HuisHype')).toBeTruthy();
    expect(getByText('Browse homes as a map')).toBeTruthy();
    expect(getByText('Guess the fair price')).toBeTruthy();
    expect(getByText('See what people notice')).toBeTruthy();
    expect(getByText(/Browsing is open/)).toBeTruthy();
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

  it('returns null when hidden', () => {
    const { queryByText } = render(
      <WelcomeModal visible={false} onClose={jest.fn()} />
    );

    expect(queryByText('Welcome to HuisHype')).toBeNull();
  });
});


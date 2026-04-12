import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { router } from 'expo-router';

import { DeepLinkRouteSync } from '../DeepLinkRouteSync';

let mockCurrentPathname = '/map/eindhoven/5651ha/beeldbuisring/2';
let mockCurrentRootNavigationKey: string | null = 'root-navigation-key';
let mockUrlListener: ((event: { url: string }) => void) | null = null;

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');

  return {
    ...actual,
    Linking: {
      ...actual.Linking,
      getInitialURL: jest.fn(),
      addEventListener: jest.fn(),
    },
  };
});

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
  usePathname: jest.fn(() => mockCurrentPathname),
  useRootNavigationState: jest.fn(() =>
    mockCurrentRootNavigationKey ? { key: mockCurrentRootNavigationKey } : null,
  ),
}));

describe('DeepLinkRouteSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentPathname = '/map/eindhoven/5651ha/beeldbuisring/2';
    mockCurrentRootNavigationKey = 'root-navigation-key';
    mockUrlListener = null;

    jest.mocked(Linking.getInitialURL).mockResolvedValue(
      'huishype:///eindhoven/5651ha/beeldbuisring/2',
    );
    jest.mocked(Linking.addEventListener).mockImplementation((_event, listener) => {
      mockUrlListener = listener;
      return {
        remove: jest.fn(),
      } as never;
    });
  });

  it('applies the initial URL once and keeps live link events active', async () => {
    const { rerender } = render(<DeepLinkRouteSync />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(jest.mocked(Linking.getInitialURL)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.replace)).toHaveBeenCalledWith(
      '/eindhoven/5651ha/beeldbuisring/2',
    );

    mockCurrentPathname = '/eindhoven/5651ha/beeldbuisring/2';
    rerender(<DeepLinkRouteSync />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(jest.mocked(Linking.getInitialURL)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.replace)).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockUrlListener?.({ url: 'huishype:///eindhoven/5651ha/beeldbuisring/3' });
    });

    expect(jest.mocked(router.replace)).toHaveBeenLastCalledWith(
      '/eindhoven/5651ha/beeldbuisring/3',
    );
  });

  it('unwraps Expo dev-client wrapper URLs for both initial and live links', async () => {
    jest.mocked(Linking.getInitialURL).mockResolvedValue(
      'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081%2F--%2Feindhoven%2F5651ha%2Fbeeldbuisring%2F2',
    );

    render(<DeepLinkRouteSync />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(jest.mocked(router.replace)).toHaveBeenCalledWith(
      '/eindhoven/5651ha/beeldbuisring/2',
    );

    await act(async () => {
      mockUrlListener?.({
        url: 'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081%2F--%2Feindhoven%2F5651ha%2Fbeeldbuisring%2F3',
      });
    });

    expect(jest.mocked(router.replace)).toHaveBeenLastCalledWith(
      '/eindhoven/5651ha/beeldbuisring/3',
    );
  });
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { CustomTabBar } from '../CustomTabBar';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/src/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('@/src/components/ui/BlurContainer', () => ({
  BlurContainer: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => null,
}));

jest.mock('@/src/lib/shadows', () => ({
  shadows: {
    'tab-bar': {},
  },
}));

describe('CustomTabBar', () => {
  it('navigates to a tab when pressed', () => {
    const navigation = {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    };

    const { getByTestId } = render(
      <CustomTabBar
        state={{
          key: 'tabs-key',
          index: 0,
          routes: [
            { key: 'index-key', name: 'index' },
            { key: 'feed-key', name: 'feed' },
            { key: 'saved-key', name: 'saved' },
            { key: 'profile-key', name: 'profile' },
          ],
        }}
        descriptors={{
          'index-key': { options: { href: '/(tabs)' } },
          'feed-key': { options: { href: '/feed' } },
          'saved-key': { options: { href: '/saved' } },
          'profile-key': { options: { href: '/profile' } },
        }}
        navigation={navigation}
      />
    );

    fireEvent.press(getByTestId('tab-feed'));

    expect(navigation.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tabPress',
        target: 'feed-key',
        canPreventDefault: true,
      }),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('feed', undefined);
  });

  it('does not navigate when tabPress is prevented', () => {
    const navigation = {
      emit: jest.fn(() => ({ defaultPrevented: true })),
      navigate: jest.fn(),
    };

    const { getByTestId } = render(
      <CustomTabBar
        state={{
          key: 'tabs-key',
          index: 0,
          routes: [
            { key: 'index-key', name: 'index' },
            { key: 'feed-key', name: 'feed' },
          ],
        }}
        descriptors={{
          'index-key': { options: { href: '/(tabs)' } },
          'feed-key': { options: { href: '/feed' } },
        }}
        navigation={navigation}
      />
    );

    fireEvent.press(getByTestId('tab-feed'));

    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

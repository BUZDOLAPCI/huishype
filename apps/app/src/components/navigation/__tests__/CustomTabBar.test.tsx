import React from 'react';
import { render } from '@testing-library/react-native';

import { CustomTabBar } from '../CustomTabBar';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => null,
}));

jest.mock('@/src/components/ui/BlurContainer', () => ({
  BlurContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('CustomTabBar', () => {
  const baseRoutes = [
    { key: 'index-key', name: 'index' },
    { key: 'feed-key', name: 'feed' },
    { key: 'saved-key', name: 'saved' },
    { key: 'profile-key', name: 'profile' },
  ];

  const descriptors = Object.fromEntries(
    [
      { key: 'index-key' },
      { key: 'feed-key' },
      { key: 'saved-key' },
      { key: 'profile-key' },
      { key: 'camera-key' },
      { key: 'address-key' },
      { key: 'map-key' },
    ].map(({ key }) => [key, { options: {} }])
  );

  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders only the user-facing tabs when deep-link routes are present', () => {
    const { getByTestId, queryByTestId } = render(
      <CustomTabBar
        state={{
          index: 0,
          routes: [
            ...baseRoutes,
            { key: 'camera-key', name: '@[camera]' },
            { key: 'address-key', name: '[...address]' },
            { key: 'map-key', name: 'map/[...address]' },
          ],
        }}
        descriptors={descriptors}
        navigation={navigation}
      />
    );

    expect(getByTestId('tab-index')).toBeTruthy();
    expect(getByTestId('tab-feed')).toBeTruthy();
    expect(getByTestId('tab-saved')).toBeTruthy();
    expect(getByTestId('tab-profile')).toBeTruthy();
    expect(queryByTestId('tab-@[camera]')).toBeNull();
    expect(queryByTestId('tab-[...address]')).toBeNull();
    expect(queryByTestId('tab-map/[...address]')).toBeNull();
  });

  it('keeps the map tab selected for deep-link map routes', () => {
    const { getByTestId } = render(
      <CustomTabBar
        state={{
          index: 4,
          routes: [
            ...baseRoutes,
            { key: 'camera-key', name: '@[camera]' },
          ],
        }}
        descriptors={descriptors}
        navigation={navigation}
      />
    );

    expect(getByTestId('tab-index').props.accessibilityState).toEqual({ selected: true });
  });
});

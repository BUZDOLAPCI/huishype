import React from 'react';
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { LanguageProvider } from '@/src/i18n';
import { CustomTabBar } from '../CustomTabBar';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

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

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: LanguageProvider });
}

const originalPlatform = Platform.OS;

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

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
    setPlatform('web');
    jest.clearAllMocks();
    window.history.replaceState({ id: 'tab-state' }, '', '/');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setPlatform(originalPlatform);
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
            { key: 'terms-key', name: 'terms' },
            { key: 'privacy-key', name: 'privacy' },
            { key: 'cookies-key', name: 'cookies' },
            { key: 'data-privacy-key', name: 'data-privacy' },
            { key: 'sharing-permissions-key', name: 'sharing-permissions' },
            { key: 'contact-key', name: 'contact' },
            { key: 'help-key', name: 'help/index' },
            { key: 'help-category-key', name: 'help/category/[slug]' },
            { key: 'help-article-key', name: 'help/article/[slug]' },
            { key: 'glossary-key', name: 'glossary/index' },
            { key: 'glossary-term-key', name: 'glossary/[slug]' },
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
    expect(queryByTestId('tab-terms')).toBeNull();
    expect(queryByTestId('tab-privacy')).toBeNull();
    expect(queryByTestId('tab-cookies')).toBeNull();
    expect(queryByTestId('tab-data-privacy')).toBeNull();
    expect(queryByTestId('tab-sharing-permissions')).toBeNull();
    expect(queryByTestId('tab-contact')).toBeNull();
    expect(queryByTestId('tab-help/index')).toBeNull();
    expect(queryByTestId('tab-help/category/[slug]')).toBeNull();
    expect(queryByTestId('tab-help/article/[slug]')).toBeNull();
    expect(queryByTestId('tab-glossary/index')).toBeNull();
    expect(queryByTestId('tab-glossary/[slug]')).toBeNull();
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

  it('keeps the profile tab selected for hidden legal and contact routes', () => {
    const { getByTestId } = render(
      <CustomTabBar
        state={{
          index: 4,
          routes: [
            ...baseRoutes,
            { key: 'terms-key', name: 'terms' },
            { key: 'privacy-key', name: 'privacy' },
            { key: 'contact-key', name: 'contact' },
            { key: 'help-key', name: 'help/index' },
            { key: 'glossary-key', name: 'glossary/index' },
          ],
        }}
        descriptors={descriptors}
        navigation={navigation}
      />
    );

    expect(getByTestId('tab-profile').props.accessibilityState).toEqual({ selected: true });
  });

  it('pushes a stable map root entry before leaving a camera URL on web', () => {
    window.history.replaceState(
      { id: 'camera-state' },
      '',
      '/@52.3626765,5.3574841,6.29z?marketState=for-sale#map',
    );
    const pushStateSpy = jest.spyOn(window.history, 'pushState');
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

    fireEvent.press(getByTestId('tab-profile'));

    expect(pushStateSpy).toHaveBeenCalledWith(
      { id: 'camera-state' },
      '',
      '/?marketState=for-sale#map',
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/profile');
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('does not push a stable map root entry when already on the map root', () => {
    const pushStateSpy = jest.spyOn(window.history, 'pushState');
    const { getByTestId } = render(
      <CustomTabBar
        state={{
          index: 0,
          routes: baseRoutes,
        }}
        descriptors={descriptors}
        navigation={navigation}
      />
    );

    fireEvent.press(getByTestId('tab-feed'));

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith('/feed');
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import CanonicalAddressRouteScreen from '@/src/screens/CanonicalAddressRouteScreen';

const mockReplace = jest.fn();
const mockReplacePassiveBrowserPath = jest.fn();
const mockPropertyScreen = jest.fn();
const mockCommentsScreen = jest.fn();
const mockGuessesScreen = jest.fn();
const mockWebMapScreen = jest.fn();
let mockPathname = '/eindhoven/5600aa/routelaan/12';
let mockParams: { returnTo?: string | string[] } = {};
const mockUseResolvedMapRoute = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  usePathname: () => mockPathname,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Stack: {
    Screen: () => null,
  },
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: (...args: unknown[]) => mockUseResolvedMapRoute(...args),
}));

jest.mock('@/src/lib/webMapUrlSync', () => ({
  replacePassiveBrowserPath: (...args: unknown[]) =>
    mockReplacePassiveBrowserPath(...args),
}));

jest.mock('@/src/screens/PropertyDetailRouteScreen', () => ({
  PropertyDetailRouteScreen: (props: unknown) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockPropertyScreen(props);
    return <Text testID="property-screen">property</Text>;
  },
}));

jest.mock('@/src/screens/CommentsRouteScreen', () => ({
  CommentsRouteScreen: (props: unknown) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockCommentsScreen(props);
    return <Text testID="comments-screen">comments</Text>;
  },
}));

jest.mock('@/src/screens/GuessesRouteScreen', () => ({
  GuessesRouteScreen: (props: unknown) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockGuessesScreen(props);
    return <Text testID="guesses-screen">guesses</Text>;
  },
}));

jest.mock('@/app/(tabs)/index.web', () => ({
  __esModule: true,
  default: (props: unknown) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockWebMapScreen(props);
    return <Text testID="web-map-screen">map</Text>;
  },
}));

describe('canonical route entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    mockParams = {};
    mockPathname = '/eindhoven/5600aa/routelaan/12';
  });

  it('passes the canonical preview default returnTo into property routes', () => {
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'property',
        canonicalPath: mockPathname,
        property: { id: 'property-1' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    render(<CanonicalAddressRouteScreen />);

    expect(mockPropertyScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'property-1',
        returnTo: '/map/eindhoven/5600aa/routelaan/12',
      }),
    );
  });

  it('keeps an explicit returnTo override for comments routes', () => {
    mockParams = { returnTo: '/feed' };
    mockPathname = '/eindhoven/5600aa/routelaan/12/comments';
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'comments',
        canonicalPath: mockPathname,
        property: { id: 'property-2' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    render(<CanonicalAddressRouteScreen />);

    expect(mockCommentsScreen).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'property-2',
        returnTo: '/feed',
      }),
    );
  });

  it('collapses invalid direct-entry routes to root', async () => {
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'invalid',
        canonicalPath: '/',
        reason: 'property-not-found',
      },
    });

    render(<CanonicalAddressRouteScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('renders web map routes for map-scoped comments overlays', async () => {
    Platform.OS = 'web';
    mockPathname = '/map/eindhoven/5600aa/routelaan/12/comments';
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'map-comments',
        canonicalPath: mockPathname,
        property: { id: 'property-3' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    const screen = render(<CanonicalAddressRouteScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('web-map-screen')).toBeTruthy();
    });
    expect(mockWebMapScreen).toHaveBeenCalledWith({
      pathnameOverride: mockPathname,
    });
    expect(mockCommentsScreen).not.toHaveBeenCalled();
  });

  it('collapses invalid web direct-entry routes through browser history without router replace', async () => {
    Platform.OS = 'web';
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'invalid',
        canonicalPath: '/',
        reason: 'property-not-found',
      },
    });

    render(<CanonicalAddressRouteScreen />);

    await waitFor(() => {
      expect(mockReplacePassiveBrowserPath).toHaveBeenCalledWith('/');
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

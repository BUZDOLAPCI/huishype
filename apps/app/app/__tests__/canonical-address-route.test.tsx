import React from 'react';
import { render, screen } from '@testing-library/react-native';

import CanonicalAddressRouteScreen from '../[...address]';

let mockSearchParams: { returnTo?: string | string[] } = {};
let mockPathname = '/eindhoven/5651ha/beeldbuisring/2';
const mockResolvedMapRoute = jest.fn();
const mockBuildPropertyMapRoute = jest.fn((_property?: unknown) => '/map/eindhoven/5651-ha/beeldbuisring/2');
const mockBuildPropertyRoute = jest.fn(
  (property?: { id?: string } | null) => `/property/${property?.id ?? 'unknown'}`,
);
const mockPropertyDetailRouteScreen = jest.fn(
  ({ returnTo }: { returnTo?: string | string[] | null }) => {
    const { Text } = require('react-native');
    return <Text>{`property:returnTo:${String(returnTo)}`}</Text>;
  },
);
const mockCommentsRouteScreen = jest.fn(() => {
  const { Text } = require('react-native');
  return <Text>comments</Text>;
});
const mockGuessesRouteScreen = jest.fn(() => {
  const { Text } = require('react-native');
  return <Text>guesses</Text>;
});
const mockMapScreen = jest.fn(() => {
  const { Text } = require('react-native');
  return <Text>map</Text>;
});

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    navigate: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: () => mockResolvedMapRoute(),
}));

jest.mock('@/src/screens/PropertyDetailRouteScreen', () => ({
  PropertyDetailRouteScreen: (props: { returnTo?: string | string[] | null }) =>
    mockPropertyDetailRouteScreen(props),
}));

jest.mock('@/src/screens/CommentsRouteScreen', () => ({
  CommentsRouteScreen: () => mockCommentsRouteScreen(),
}));

jest.mock('@/src/screens/GuessesRouteScreen', () => ({
  GuessesRouteScreen: () => mockGuessesRouteScreen(),
}));

jest.mock('../(tabs)/index', () => ({
  __esModule: true,
  default: () => mockMapScreen(),
}));

jest.mock('@/src/utils/property-route', () => ({
  buildCanonicalRouteHref: (path: string, returnTo?: string | string[] | null) => {
    if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
      return path;
    }

    return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
  },
  buildPropertyMapRoute: (property?: unknown) => mockBuildPropertyMapRoute(property),
  buildPropertyRoute: (property?: { id?: string } | null) => mockBuildPropertyRoute(property),
  toInternalAppHref: jest.fn((value: string) => value),
}));

const mockRouterReplace = (jest.requireMock('expo-router') as {
  router: { replace: jest.Mock };
}).router.replace;

describe('canonical address route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    mockPathname = '/eindhoven/5651ha/beeldbuisring/2';
    mockResolvedMapRoute.mockReturnValue({
      pathname: '/eindhoven/5651ha/beeldbuisring/2',
      parsedRoute: { kind: 'property' },
      resolvedRoute: {
        kind: 'property',
        canonicalPath: '/eindhoven/5651ha/beeldbuisring/2',
        property: { id: 'property-123' },
        resolvedAddress: {
          address: 'Beeldbuisring 2',
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
      },
      isLoading: false,
    });
  });

  it('keeps canonical property deeplinks on the map-preview back contract by default', () => {
    render(<CanonicalAddressRouteScreen />);

    expect(screen.getByText('property:returnTo:/map/eindhoven/5651-ha/beeldbuisring/2')).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    expect(mockPropertyDetailRouteScreen.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'onNavigate',
    );
    expect(mockBuildPropertyMapRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'Eindhoven',
        postalCode: '5651 HA',
        countryCode: 'NL',
        streetName: 'Beeldbuisring',
        houseNumber: '2',
        houseNumberAddition: null,
      }),
    );
  });

  it('preserves explicit returnTo values from the query string', () => {
    mockPathname = '/map/eindhoven/5651ha/beeldbuisring/2';
    mockSearchParams = { returnTo: '/feed' };
    mockResolvedMapRoute.mockReturnValue({
      pathname: '/map/eindhoven/5651ha/beeldbuisring/2',
      parsedRoute: { kind: 'property' },
      resolvedRoute: {
        kind: 'property',
        canonicalPath: '/eindhoven/5651ha/beeldbuisring/2',
        property: { id: 'property-123' },
        resolvedAddress: {
          address: 'Beeldbuisring 2',
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
      },
      isLoading: false,
    });

    render(<CanonicalAddressRouteScreen />);

    expect(screen.getByText('property:returnTo:/feed')).toBeTruthy();
    expect(mockRouterReplace).toHaveBeenCalledWith(
      '/eindhoven/5651ha/beeldbuisring/2?returnTo=%2Ffeed',
    );
  });

  it('sanitizes unsafe returnTo values while canonicalizing stale routes', () => {
    mockPathname = '/map/eindhoven/5651ha/beeldbuisring/2';
    mockSearchParams = { returnTo: 'https://evil.example/x' };
    mockResolvedMapRoute.mockReturnValue({
      pathname: '/map/eindhoven/5651ha/beeldbuisring/2',
      parsedRoute: { kind: 'property' },
      resolvedRoute: {
        kind: 'property',
        canonicalPath: '/eindhoven/5651ha/beeldbuisring/2',
        property: { id: 'property-123' },
        resolvedAddress: {
          address: 'Beeldbuisring 2',
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5651 HA',
          countryCode: 'NL',
          streetName: 'Beeldbuisring',
          houseNumber: '2',
          houseNumberAddition: null,
        },
      },
      isLoading: false,
    });

    render(<CanonicalAddressRouteScreen />);

    expect(screen.getByText('property:returnTo:https://evil.example/x')).toBeTruthy();
    expect(mockRouterReplace).toHaveBeenCalledWith('/eindhoven/5651ha/beeldbuisring/2');
  });
});

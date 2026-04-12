import React from 'react';
import { render, screen } from '@testing-library/react-native';

import CanonicalAddressRouteScreen from '../[...address]';

let mockSearchParams: { returnTo?: string | string[] } = {};
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
  usePathname: () => '/eindhoven/5651ha/beeldbuisring/2',
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: () => mockResolvedMapRoute(),
}));

jest.mock('../property/[id]', () => ({
  PropertyDetailRouteScreen: (props: { returnTo?: string | string[] | null }) =>
    mockPropertyDetailRouteScreen(props),
}));

jest.mock('../comments/[propertyId]', () => ({
  CommentsRouteScreen: () => mockCommentsRouteScreen(),
}));

jest.mock('../guesses/[propertyId]', () => ({
  GuessesRouteScreen: () => mockGuessesRouteScreen(),
}));

jest.mock('../(tabs)/index', () => ({
  __esModule: true,
  default: () => mockMapScreen(),
}));

jest.mock('@/src/utils/property-route', () => ({
  buildPropertyMapRoute: (property?: unknown) => mockBuildPropertyMapRoute(property),
  buildPropertyRoute: (property?: { id?: string } | null) => mockBuildPropertyRoute(property),
  toInternalAppHref: jest.fn((value: string) => value),
}));

describe('canonical address route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
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
    mockSearchParams = { returnTo: '/feed' };

    render(<CanonicalAddressRouteScreen />);

    expect(screen.getByText('property:returnTo:/feed')).toBeTruthy();
  });
});

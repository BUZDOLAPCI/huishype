import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import PropertyDetailRouteScreen from '@/src/screens/PropertyDetailRouteScreen';
import type { PropertyDetails } from '@/src/hooks/useProperties';

const mockUseProperty = jest.fn();
const mockPropertyContent = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@/src/hooks/useProperties', () => {
  return {
    useProperty: (...args: unknown[]) => mockUseProperty(...args),
  };
});

jest.mock('@/src/components', () => ({
  AuthModal: ({
    visible,
    copy,
  }: {
    visible: boolean;
    copy?: { title?: string; subtitle?: string };
  }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return (
      <Text>
        {visible
          ? `Auth modal open: ${copy?.title ?? ''} | ${copy?.subtitle ?? ''}`
          : 'Auth modal closed'}
      </Text>
    );
  },
}));

jest.mock('@/src/components/RouteLoadingShell', () => ({
  RouteLoadingShell: ({
    title,
    subtitle,
  }: {
    title: string;
    subtitle: string;
  }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>{`${title} | ${subtitle}`}</Text>;
  },
}));

jest.mock('@/src/components/PropertyBottomSheet/PropertyContent', () => ({
  PropertyContent: (props: any) => {
    const React = require('react');
    const { Text, Pressable } = require('react-native');
    mockPropertyContent(props);
    return (
      <>
        <Text>{props.property.address}</Text>
        <Pressable
          testID="trigger-auth-required"
          onPress={() => props.onAuthRequired?.('Sign in to submit your guess')}
        >
          <Text>Trigger auth required</Text>
        </Pressable>
        <Pressable
          testID="trigger-view-all-comments"
          onPress={() => props.onViewAllComments?.(props.property.id)}
        >
          <Text>Open comments</Text>
        </Pressable>
        <Pressable
          testID="trigger-view-all-guesses"
          onPress={() => props.onViewAllGuesses?.(props.property.id)}
        >
          <Text>Open guesses</Text>
        </Pressable>
      </>
    );
  },
}));

const property: PropertyDetails = {
  id: 'route-property-1',
  nationalId: 'BAG-1',
  countryCode: 'NL',
  address: 'Routelaan 12',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 350000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  activityLevel: 'warm',
  commentCount: 2,
  guessCount: 3,
  viewCount: 4,
  uniqueViewers: 2,
};

describe('PropertyDetailRouteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
    });
  });

  it('renders PropertyContent on success and wires the shared contract props', () => {
    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    expect(screen.getByText(property.address)).toBeTruthy();

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];
    expect(lastProps).toEqual(
      expect.objectContaining({
        property,
        manageInteractionsInternally: true,
        onAuthRequired: expect.any(Function),
        onViewAllComments: expect.any(Function),
        onViewAllGuesses: expect.any(Function),
      }),
    );

    expect(screen.getByText('Auth modal closed')).toBeTruthy();

    fireEvent.press(screen.getByTestId('trigger-auth-required'));

    expect(
      screen.getByText(
        'Auth modal open: Welcome to HuisHype | Sign in to submit your guess',
      ),
    ).toBeTruthy();
  });

  it('routes comments through the canonical comments surface', () => {
    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    fireEvent.press(screen.getByTestId('trigger-view-all-comments'));

    expect(mockPush).toHaveBeenCalledWith(
      '/eindhoven/5600aa/routelaan/12/comments?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12',
    );
  });

  it('routes guesses through the canonical guesses surface', () => {
    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    fireEvent.press(screen.getByTestId('trigger-view-all-guesses'));

    expect(mockPush).toHaveBeenCalledWith(
      '/eindhoven/5600aa/routelaan/12/guesses?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12',
    );
  });

  it('shows the loading shell while property data is still resolving', () => {
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    expect(
      screen.getByText(
        'Loading property | Preparing the property detail surface...',
      ),
    ).toBeTruthy();
  });
});

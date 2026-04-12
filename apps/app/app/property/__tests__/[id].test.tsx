import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';

import PropertyDetailScreen, { PropertyDetailRouteScreen } from '../[id]';
import type { PropertyDetails } from '@/src/hooks/useProperties';
import { buildPropertyMapRoute, toInternalAppHref } from '@/src/utils/property-route';

const mockUseProperty = jest.fn();
const mockPropertyContent = jest.fn();
const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockCanDismiss = jest.fn(() => false);
let capturedFocusEffect: (() => void | (() => void)) | null = null;
let mockSearchParams: { id: string; returnTo?: string | string[] } = { id: 'route-property-1' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  Stack: {
    Screen: () => null,
  },
  Redirect: ({ href }: { href: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack(),
    canDismiss: () => mockCanDismiss(),
    push: (...args: unknown[]) => mockPush(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    capturedFocusEffect = effect;
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

jest.mock('@/src/components/PropertyBottomSheet/PropertyContent', () => ({
  PropertyContent: (props: any) => {
    const React = require('react');
    const { Text, Pressable } = require('react-native');
    mockPropertyContent(props);
    return (
      <>
        <Text>{props.property.address}</Text>
        <Pressable
          onPress={() => props.onAuthRequired?.('Sign in to submit your guess')}
        >
          <Text>Trigger auth required</Text>
        </Pressable>
      </>
    );
  },
}));

const property: PropertyDetails = {
  id: 'route-property-1',
  nationalId: 'BAG-1',
  countryCode: 'NL',
  region: 'Noord-Brabant',
  street: 'Routelaan',
  houseNumber: 12,
  houseNumberAddition: null,
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

describe('app/property/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { id: 'route-property-1' };
    capturedFocusEffect = null;
    Platform.OS = 'android';
    mockCanGoBack.mockReturnValue(false);
    mockCanDismiss.mockReturnValue(false);
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
      error: null,
    });
  });

  it('renders PropertyContent on success and wires the shared contract props', () => {
    render(
      <PropertyDetailRouteScreen
        propertyId="route-property-1"
        returnTo={mockSearchParams.returnTo}
      />,
    );

    expect(screen.getByText(property.address)).toBeTruthy();

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];
    expect(lastProps).toEqual(expect.objectContaining({
      property,
      manageInteractionsInternally: true,
      onAuthRequired: expect.any(Function),
      onViewAllComments: expect.any(Function),
      onViewAllGuesses: expect.any(Function),
    }));

    expect(screen.getByText('Auth modal closed')).toBeTruthy();

    fireEvent.press(screen.getByText('Trigger auth required'));

    expect(
      screen.getByText(
        'Auth modal open: Welcome to HuisHype | Sign in to submit your guess'
      )
    ).toBeTruthy();
  });

  it('uses dismissTo with the explicit origin on native routes', () => {
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };
    mockCanDismiss.mockReturnValue(true);

    render(<PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />);

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/feed');
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('uses the explicit return target when the route is not dismissable even when history exists', () => {
    mockCanGoBack.mockReturnValue(true);

    render(<PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />);
    const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');
    addEventListenerSpy.mockReturnValue({ remove: jest.fn() } as any);

    capturedFocusEffect?.();
    const handler = addEventListenerSpy.mock.calls.at(-1)?.[1];

    expect(handler?.()).toBe(true);
    expect(mockDismissTo).toHaveBeenCalledWith('/feed');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('uses the canonical map-preview target even when history exists', () => {
    mockCanGoBack.mockReturnValue(true);

    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockDismissTo).toHaveBeenCalledWith(
      toInternalAppHref(buildPropertyMapRoute(property)),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('uses returnTo when the not-found CTA is pressed', () => {
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('missing'),
    });

    render(<PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />);

    fireEvent.press(screen.getByText('Go Back'));

    expect(mockDismissTo).toHaveBeenCalledWith('/feed');
  });

  it('falls back to the root route when the property is missing and there is no explicit origin', () => {
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('missing'),
    });

    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    fireEvent.press(screen.getByText('Go Back'));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('intercepts Android hardware back to honor the explicit origin', () => {
    const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');
    const removeListener = jest.fn();
    addEventListenerSpy.mockReturnValue({ remove: removeListener } as any);
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };

    render(<PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />);

    expect(addEventListenerSpy).not.toHaveBeenCalled();
    expect(capturedFocusEffect).toBeDefined();

    const cleanup = capturedFocusEffect?.();

    const handler = addEventListenerSpy.mock.calls.at(-1)?.[1];
    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
    expect(mockDismissTo).toHaveBeenCalledWith('/feed');

    cleanup?.();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('redirects legacy id routes to the map root', () => {
    render(<PropertyDetailScreen />);

    expect(screen.getByText('redirect:/')).toBeTruthy();
    expect(mockUseProperty).not.toHaveBeenCalled();
  });
});

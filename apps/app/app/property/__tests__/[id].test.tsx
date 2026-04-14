import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';

import PropertyDetailRouteScreen from '@/src/screens/PropertyDetailRouteScreen';
import type { PropertyDetails } from '@/src/hooks/useProperties';

const mockUseProperty = jest.fn();
const mockPropertyContent = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockDismiss = jest.fn();
const mockDismissTo = jest.fn();
let capturedFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    canDismiss: () => false,
    canGoBack: () => false,
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
    capturedFocusEffect = null;
    Platform.OS = 'android';
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
      error: null,
    });
  });

  it('renders PropertyContent on success and wires the shared contract props', () => {
    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

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

  it('returns to the explicit origin when provided', () => {
    render(
      <PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />,
    );

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/feed');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('falls back to the canonical map preview when no explicit origin exists', () => {
    render(<PropertyDetailRouteScreen propertyId="route-property-1" />);

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/map/eindhoven/5600aa/routelaan/12');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('uses returnTo when the not-found CTA is pressed', () => {
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('missing'),
    });

    render(
      <PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />,
    );

    fireEvent.press(screen.getByText('Go Back'));

    expect(mockDismissTo).toHaveBeenCalledWith('/feed');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('intercepts Android hardware back to honor the explicit origin', () => {
    const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');
    const removeListener = jest.fn();
    addEventListenerSpy.mockReturnValue({ remove: removeListener } as any);

    render(
      <PropertyDetailRouteScreen propertyId="route-property-1" returnTo="/feed" />,
    );

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
});

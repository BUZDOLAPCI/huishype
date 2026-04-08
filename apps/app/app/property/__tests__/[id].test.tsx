import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';

import PropertyDetailScreen from '../[id]';
import type { PropertyDetails } from '@/src/hooks/useProperties';

const mockUseProperty = jest.fn();
const mockPropertyContent = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let capturedFocusEffect: (() => void | (() => void)) | null = null;
let mockSearchParams: { id: string; returnTo?: string | string[] } = { id: 'route-property-1' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  Stack: {
    Screen: () => null,
  },
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    capturedFocusEffect = effect;
  },
}));

jest.mock('@/src/hooks/useProperties', () => {
  const actual = jest.requireActual('@/src/hooks/useProperties');
  return {
    ...actual,
    useProperty: (...args: unknown[]) => mockUseProperty(...args),
  };
});

jest.mock('@/src/components', () => ({
  AuthModal: ({ visible }: { visible: boolean }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>{visible ? 'Auth modal open' : 'Auth modal closed'}</Text>;
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
        <Pressable onPress={() => props.onAuthRequired?.()}>
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

describe('app/property/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { id: 'route-property-1' };
    capturedFocusEffect = null;
    Platform.OS = 'android';
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
      error: null,
    });
  });

  it('renders PropertyContent on success and wires the shared contract props', () => {
    render(<PropertyDetailScreen />);

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

    expect(screen.getByText('Auth modal open')).toBeTruthy();
  });

  it('returns to the explicit origin when provided', () => {
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };

    render(<PropertyDetailScreen />);

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockReplace).toHaveBeenCalledWith('/feed');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('falls back to router.back when no explicit origin exists', () => {
    render(<PropertyDetailScreen />);

    fireEvent.press(screen.getByTestId('property-back-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('uses returnTo when the not-found CTA is pressed', () => {
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };
    mockUseProperty.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('missing'),
    });

    render(<PropertyDetailScreen />);

    fireEvent.press(screen.getByText('Go Back'));

    expect(mockReplace).toHaveBeenCalledWith('/feed');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('intercepts Android hardware back to honor the explicit origin', () => {
    const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');
    const removeListener = jest.fn();
    addEventListenerSpy.mockReturnValue({ remove: removeListener } as any);
    mockSearchParams = { id: 'route-property-1', returnTo: '/feed' };

    render(<PropertyDetailScreen />);

    expect(addEventListenerSpy).not.toHaveBeenCalled();
    expect(capturedFocusEffect).toBeDefined();

    const cleanup = capturedFocusEffect?.();

    const handler = addEventListenerSpy.mock.calls.at(-1)?.[1];
    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/feed');

    cleanup?.();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

import PropertyDetailScreen from '../[id]';
import type { PropertyDetails } from '@/src/hooks/useProperties';

const mockUseProperty = jest.fn();
const mockPropertyContent = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'route-property-1' }),
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    push: jest.fn(),
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
});

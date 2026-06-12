import React from 'react';
import { render, act } from '@testing-library/react-native';

import { PropertyDetailRouteScreen } from '../PropertyDetailRouteScreen';
import type { PropertyContentProps } from '../../components/PropertyBottomSheet/PropertyContent';
import type { PropertyDetails } from '../../hooks/useProperties';

const mockUseProperty = jest.fn();
const mockRouterPush = jest.fn();
const mockPropertyContent = jest.fn<void, [PropertyContentProps]>();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: jest.fn(),
    dismissTo: jest.fn(),
    dismiss: jest.fn(),
    back: jest.fn(),
    canDismiss: jest.fn(() => false),
    canGoBack: jest.fn(() => false),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  }),
}));

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
}));

jest.mock('@/src/components/RouteLoadingShell', () => ({
  RouteLoadingShell: () => null,
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => null,
}));

jest.mock('@/src/hooks/useProperties', () => ({
  useProperty: (...args: unknown[]) => mockUseProperty(...args),
}));

jest.mock('@/src/components/PropertyBottomSheet/PropertyContent', () => ({
  PropertyContent: (props: PropertyContentProps) => {
    mockPropertyContent(props);
    return null;
  },
}));

const property: PropertyDetails = {
  id: 'property-123',
  nationalId: 'BAG-12345',
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
  guessCount: 7,
  viewCount: 4,
  uniqueViewers: 3,
  askingPrice: undefined,
  isLiked: false,
  isSaved: false,
};

describe('PropertyDetailRouteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
      error: null,
    });
  });

  it('passes a guesses navigation handler into PropertyContent', () => {
    render(<PropertyDetailRouteScreen propertyId="property-123" />);

    const lastProps =
      mockPropertyContent.mock.calls[mockPropertyContent.mock.calls.length - 1]?.[0];

    expect(lastProps).toEqual(
      expect.objectContaining({
        onGuessPress: expect.any(Function),
        onHeaderClose: expect.any(Function),
      }),
    );

    act(() => {
      lastProps?.onGuessPress?.(property.id);
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/eindhoven/5600aa/routelaan/12/guesses?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12',
    );
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { GuessesRouteScreen } from '@/src/screens/GuessesRouteScreen';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';

const mockUseProperty = jest.fn();
const mockUseFetchPriceGuess = jest.fn();
const mockMutateAsync = jest.fn();
const mockUseAuth = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
const mockDismissTo = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockCanDismiss = jest.fn(() => false);
let mockSearchParams: { propertyId: string; returnTo?: string | string[] } = {
  propertyId: 'property-123',
};
const property = {
  id: 'property-123',
  nationalId: null,
  countryCode: 'NL',
  region: 'Noord-Brabant',
  street: 'Teststraat',
  houseNumber: 42,
  houseNumberAddition: null,
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: null,
  yearBuilt: 1998,
  floorAreaM2: 112,
  status: 'active',
  officialValuation: 350000,
  askingPrice: 365000,
  activityLevel: 'warm',
  commentCount: 4,
  guessCount: 2,
  viewCount: 10,
  uniqueViewers: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

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
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/hooks/useIsLandscape', () => ({
  useIsLandscape: () => false,
}));

jest.mock('@/src/hooks/useProperties', () => ({
  useProperty: (...args: unknown[]) => mockUseProperty(...args),
}));

jest.mock('@/src/hooks/usePriceGuess', () => ({
  useFetchPriceGuess: (...args: unknown[]) => mockUseFetchPriceGuess(...args),
  useSubmitGuess: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('@/src/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>icon</Text>;
  },
}));

jest.mock('@/src/components/ui/UserAvatar', () => ({
  UserAvatar: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>avatar</Text>;
  },
}));

jest.mock('@/src/components/ui/ResponsivePanel', () => ({
  ResponsivePanel: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/src/components/FMVVisualization', () => ({
  FMVVisualization: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>FMV Visualization</Text>;
  },
}));

jest.mock('@/src/components/PriceGuessSlider', () => ({
  PriceGuessSlider: ({ disabled, onGuessSubmit }: { disabled?: boolean; onGuessSubmit: (price: number) => void }) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    return (
      <View>
        <Text testID="guesses-slider-disabled">{String(!!disabled)}</Text>
        <Pressable testID="guesses-slider-submit" onPress={() => onGuessSubmit(360000)}>
          <Text>Submit Guess</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('@/src/components', () => ({
  AuthModal: ({ visible }: { visible: boolean }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return visible ? <Text>Auth Modal Open</Text> : null;
  },
}));

jest.mock('@/src/components/PropertyImageSurface', () => ({
  PropertyImageSurface: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Property Image</Text>;
  },
}));

jest.mock('@/src/components/Comments/Comment', () => ({
  formatRelativeTime: () => 'just now',
}));

jest.mock('@/src/components/Comments/KarmaBadge', () => ({
  KarmaBadge: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Karma</Text>;
  },
}));

describe('GuessesRouteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { propertyId: 'property-123' };
    mockCanGoBack.mockReturnValue(false);
    mockCanDismiss.mockReturnValue(false);
    Platform.OS = 'android';
    mockUseProperty.mockReturnValue({
      data: property,
      isLoading: false,
    });
    mockUseFetchPriceGuess.mockReturnValue({
      data: {
        userGuess: null,
        fmv: {
          fmv: 355000,
          confidence: 'medium',
          guessCount: 3,
          distribution: null,
          officialValuation: 350000,
          askingPrice: 365000,
          divergence: -2,
        },
        canEdit: true,
        cooldownEndsAt: null,
        guesses: [],
      },
      isLoading: false,
      refetch: jest.fn(),
    });
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
    });
    mockMutateAsync.mockResolvedValue({});
  });

  it('lets logged-out users open the slider and gates on submit', async () => {
    const screen = render(<GuessesRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('make-guess-button'));

    expect(screen.getByTestId('guesses-slider-disabled').props.children).toBe('false');

    fireEvent.press(screen.getByTestId('guesses-slider-submit'));

    await waitFor(() => {
      expect(screen.getByText('Auth Modal Open')).toBeTruthy();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('closes to the canonical property route by default even when history exists', () => {
    mockCanGoBack.mockReturnValue(true);
    const screen = render(<GuessesRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('guesses-back-button'));

    expect(mockReplace).toHaveBeenCalledWith(toInternalAppHref(buildPropertyRoute(property)));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('replaces to an explicit returnTo on native routes', () => {
    mockSearchParams = { propertyId: 'property-123', returnTo: '/saved' };
    mockCanDismiss.mockReturnValue(true);

    const screen = render(
      <GuessesRouteScreen propertyId="property-123" returnTo="/saved" />,
    );

    fireEvent.press(screen.getByTestId('guesses-back-button'));

    expect(mockReplace).toHaveBeenCalledWith('/saved');
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('uses a validated explicit returnTo when the route is not dismissable', () => {
    mockSearchParams = { propertyId: 'property-123', returnTo: '/saved' };

    const screen = render(
      <GuessesRouteScreen propertyId="property-123" returnTo="/saved" />,
    );

    fireEvent.press(screen.getByTestId('guesses-back-button'));

    expect(mockReplace).toHaveBeenCalledWith('/saved');
    expect(mockDismiss).not.toHaveBeenCalled();
  });

});

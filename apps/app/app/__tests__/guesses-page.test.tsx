import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import GuessesRouteScreen from '@/src/screens/GuessesRouteScreen';

const mockUseProperty = jest.fn();
const mockUseFetchPriceGuess = jest.fn();
const mockMutateAsync = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissTo: jest.fn(),
    canDismiss: () => false,
    canGoBack: () => false,
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
  PriceGuessSlider: ({
    disabled,
    initialPrice,
    initialPriceSource,
    initialPriceConfidence,
    onGuessSubmit,
  }: {
    disabled?: boolean;
    initialPrice?: number;
    initialPriceSource?: string;
    initialPriceConfidence?: string;
    onGuessSubmit: (price: number) => void;
  }) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    return (
      <View>
        <Text testID="guesses-slider-disabled">{String(!!disabled)}</Text>
        <Text testID="guesses-slider-initial-price">{String(initialPrice ?? '')}</Text>
        <Text testID="guesses-slider-initial-source">{String(initialPriceSource ?? '')}</Text>
        <Text testID="guesses-slider-initial-confidence">{String(initialPriceConfidence ?? '')}</Text>
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

describe('GuessesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProperty.mockReturnValue({
      data: {
        id: 'property-123',
        nationalId: null,
        countryCode: 'NL',
        address: 'Teststraat 42',
        city: 'Eindhoven',
        postalCode: '5600 AA',
        geometry: null,
        yearBuilt: 1998,
        floorAreaM2: 112,
        status: 'active',
        officialValuation: 350000,
        askingPrice: 365000,
        marketState: 'for-sale',
        activityLevel: 'warm',
        commentCount: 4,
        guessCount: 2,
        viewCount: 10,
        uniqueViewers: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
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
        activeListingAskingPrice: null,
        priceGuessStart: null,
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

  it('passes active sale asking price as the slider initializer', () => {
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
        activeListingAskingPrice: 372000,
        priceGuessStart: {
          price: 340000,
          source: 'local_comparable_price_per_m2',
          confidence: 'usable',
          sampleSize: 12,
        },
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const screen = render(<GuessesRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('make-guess-button'));

    expect(screen.getByTestId('guesses-slider-initial-price').props.children).toBe('372000');
    expect(screen.getByTestId('guesses-slider-initial-source').props.children).toBe(
      'active_listing_asking_price'
    );
    expect(screen.getByTestId('guesses-slider-initial-confidence').props.children).toBe('known');
  });

  it('uses for-sale property asking price before priceGuessStart as the slider initializer', () => {
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
        activeListingAskingPrice: null,
        priceGuessStart: {
          price: 340000,
          source: 'local_comparable_price_per_m2',
          confidence: 'usable',
          sampleSize: 12,
        },
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const screen = render(<GuessesRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('make-guess-button'));

    expect(screen.getByTestId('guesses-slider-initial-price').props.children).toBe('365000');
    expect(screen.getByTestId('guesses-slider-initial-source').props.children).toBe(
      'active_listing_asking_price'
    );
    expect(screen.getByTestId('guesses-slider-initial-confidence').props.children).toBe('known');
  });

  it('does not use rent asking price as the slider initializer', () => {
    mockUseProperty.mockReturnValue({
      data: {
        id: 'property-123',
        nationalId: null,
        countryCode: 'NL',
        address: 'Teststraat 42',
        city: 'Eindhoven',
        postalCode: '5600 AA',
        geometry: null,
        yearBuilt: 1998,
        floorAreaM2: 112,
        status: 'active',
        officialValuation: 350000,
        askingPrice: 1750,
        marketState: 'for-rent',
        activityLevel: 'warm',
        commentCount: 4,
        guessCount: 2,
        viewCount: 10,
        uniqueViewers: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
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
          askingPrice: null,
          divergence: null,
        },
        canEdit: true,
        cooldownEndsAt: null,
        guesses: [],
        activeListingAskingPrice: null,
        priceGuessStart: {
          price: 340000,
          source: 'local_comparable_price_per_m2',
          confidence: 'usable',
          sampleSize: 12,
        },
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const screen = render(<GuessesRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('make-guess-button'));

    expect(screen.getByTestId('guesses-slider-initial-price').props.children).toBe('340000');
    expect(screen.getByTestId('guesses-slider-initial-source').props.children).toBe(
      'local_comparable_price_per_m2'
    );
    expect(screen.getByTestId('guesses-slider-initial-confidence').props.children).toBe('usable');
  });
});

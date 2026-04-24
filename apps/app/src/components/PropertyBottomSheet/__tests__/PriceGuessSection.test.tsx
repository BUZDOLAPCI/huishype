import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PriceGuessSection } from '../PriceGuessSection';

const mockUseAuth = jest.fn();
const mockUseFetchPriceGuess = jest.fn();
const mockMutateAsync = jest.fn();

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../../hooks/usePriceGuess', () => ({
  useFetchPriceGuess: (...args: unknown[]) => mockUseFetchPriceGuess(...args),
  useSubmitGuess: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('../../PriceGuessSlider', () => ({
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
        <Text testID="price-guess-slider-disabled">{String(!!disabled)}</Text>
        <Text testID="price-guess-slider-initial-price">{String(initialPrice ?? '')}</Text>
        <Text testID="price-guess-slider-initial-source">{String(initialPriceSource ?? '')}</Text>
        <Text testID="price-guess-slider-initial-confidence">
          {String(initialPriceConfidence ?? '')}
        </Text>
        <Pressable testID="price-guess-slider-submit" onPress={() => onGuessSubmit(345000)}>
          <Text>Submit Guess</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('../SectionCard', () => ({
  SectionCard: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('../../FMVVisualization', () => ({
  FMVVisualization: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>FMV Visualization</Text>;
  },
}));

jest.mock('../../ConsensusAlignment', () => ({
  ConsensusAlignment: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Consensus Alignment</Text>;
  },
}));

const property = {
  id: 'property-123',
  nationalId: null,
  countryCode: 'NL',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: null,
  yearBuilt: 1998,
  floorAreaM2: 112,
  status: 'active' as const,
  officialValuation: 350000,
  askingPrice: 365000,
  activityLevel: 'warm' as const,
  commentCount: 4,
  guessCount: 2,
  viewCount: 10,
  likeCount: 1,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('PriceGuessSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
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
    mockMutateAsync.mockResolvedValue({
      id: 'guess-1',
      propertyId: 'property-123',
    });
  });

  it('keeps the slider enabled for logged-out users and gates only on submit', async () => {
    const onLoginRequired = jest.fn();
    const screen = render(
      <PriceGuessSection property={property} onLoginRequired={onLoginRequired} />
    );

    expect(screen.getByTestId('price-guess-slider-disabled').props.children).toBe('false');
    expect(screen.queryByText('Sign in to submit your guess')).toBeNull();

    fireEvent.press(screen.getByTestId('price-guess-slider-submit'));

    await waitFor(() => {
      expect(onLoginRequired).toHaveBeenCalledWith('Sign in to submit your guess');
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the slider enabled even if stale cooldown fields are present', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      isAuthenticated: true,
    });
    mockUseFetchPriceGuess.mockReturnValue({
      data: {
        userGuess: {
          id: 'guess-1',
          propertyId: 'property-123',
          userId: 'user-1',
          guessedPrice: 340000,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
        fmv: {
          fmv: 355000,
          confidence: 'medium',
          guessCount: 3,
          distribution: null,
          officialValuation: 350000,
          askingPrice: 365000,
          divergence: -2,
        },
        canEdit: false,
        cooldownEndsAt: '2024-01-07T00:00:00Z',
        guesses: [],
        activeListingAskingPrice: null,
        priceGuessStart: null,
      },
      isLoading: false,
      refetch: jest.fn(),
    });

    const screen = render(<PriceGuessSection property={property} />);

    expect(screen.getByTestId('price-guess-slider-disabled').props.children).toBe('false');
    expect(screen.queryByText('Cooldown Active')).toBeNull();
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

    const screen = render(<PriceGuessSection property={property} />);

    expect(screen.getByTestId('price-guess-slider-initial-price').props.children).toBe('372000');
    expect(screen.getByTestId('price-guess-slider-initial-source').props.children).toBe(
      'active_listing_asking_price'
    );
    expect(screen.getByTestId('price-guess-slider-initial-confidence').props.children).toBe(
      'known'
    );
  });

  it('uses property asking price before priceGuessStart as the slider initializer', () => {
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

    const screen = render(<PriceGuessSection property={property} />);

    expect(screen.getByTestId('price-guess-slider-initial-price').props.children).toBe('365000');
    expect(screen.getByTestId('price-guess-slider-initial-source').props.children).toBe(
      'active_listing_asking_price'
    );
    expect(screen.getByTestId('price-guess-slider-initial-confidence').props.children).toBe(
      'known'
    );
  });
});

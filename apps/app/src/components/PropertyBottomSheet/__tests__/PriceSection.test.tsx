import React from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { PriceSection } from '../PriceSection';

describe('PriceSection', () => {
  it('matches the price grid ordering and nests confidence inside the crowd card', () => {
    render(
      <PriceSection
        property={{
          id: 'property-1',
          nationalId: null,
          countryCode: 'NL',
          address: 'Teststraat 42',
          city: 'Eindhoven',
          postalCode: '5611 ET',
          geometry: null,
          yearBuilt: 1995,
          floorAreaM2: 118,
          status: 'active',
          officialValuation: 389000,
          askingPrice: 415000,
          fmv: {
            fmv: 400000,
            confidence: 'high',
            guessCount: 28,
            distribution: null,
            officialValuation: 389000,
            askingPrice: 415000,
            divergence: null,
          },
          activityLevel: 'warm',
          commentCount: 3,
          guessCount: 28,
          viewCount: 12,
          likeCount: 0,
          isLiked: false,
          isSaved: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        }}
      />
    );

    const crowdCard = screen.getByTestId('price-snapshot-crowd-card');
    const valuationCard = screen.getByTestId('price-snapshot-valuation-card');
    const askingCard = screen.getByTestId('price-snapshot-asking-card');

    expect(within(crowdCard).getByText('Crowd Estimate')).toBeTruthy();
    expect(within(crowdCard).getByText('High confidence (28 guesses)')).toBeTruthy();
    expect(within(valuationCard).getByText('WOZ Value')).toBeTruthy();
    expect(within(askingCard).getByText('Asking Price')).toBeTruthy();

    expect(screen.queryByText(/^High confidence$/)).toBeNull();
    expect(screen.queryByText('Crowd FMV')).toBeNull();
  });
});

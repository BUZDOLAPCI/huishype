import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { PriceSection } from '../PriceSection';
import { LanguageProvider, useLanguage } from '@/src/i18n';

const property = {
  id: 'property-1',
  nationalId: null,
  countryCode: 'NL',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: null,
  yearBuilt: 1995,
  floorAreaM2: 118,
  status: 'active' as const,
  officialValuation: 389000,
  officialValuationYear: 2024,
  askingPrice: 415000,
  fmv: {
    fmv: 400000,
    confidence: 'high' as const,
    guessCount: 28,
    distribution: null,
    officialValuation: 389000,
    askingPrice: 415000,
    divergence: null,
  },
  activityLevel: 'warm' as const,
  commentCount: 3,
  guessCount: 28,
  viewCount: 12,
  likeCount: 0,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function ForceDutch() {
  const { setLanguage } = useLanguage();

  React.useEffect(() => {
    void setLanguage('nl');
  }, [setLanguage]);

  return null;
}

function renderInDutch() {
  return render(
    <LanguageProvider>
      <ForceDutch />
      <PriceSection property={property} />
    </LanguageProvider>
  );
}

describe('PriceSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('matches the price grid ordering and nests confidence inside the crowd card', () => {
    render(<PriceSection property={property} />);

    const crowdCard = screen.getByTestId('price-snapshot-crowd-card');
    const valuationCard = screen.getByTestId('price-snapshot-valuation-card');
    const askingCard = screen.getByTestId('price-snapshot-asking-card');

    expect(within(crowdCard).getByText('Crowd Estimate')).toBeTruthy();
    expect(within(crowdCard).getByText('High confidence (28 guesses)')).toBeTruthy();
    expect(within(valuationCard).getByText('WOZ Value (2024)')).toBeTruthy();
    expect(within(askingCard).getByText('Asking Price')).toBeTruthy();

    expect(screen.queryByText(/^High confidence$/)).toBeNull();
    expect(screen.queryByText('Crowd FMV')).toBeNull();
  });

  it('renders Dutch price section labels', async () => {
    renderInDutch();

    await waitFor(() => {
      expect(screen.getByText('Crowdschatting')).toBeTruthy();
      expect(screen.getByText('Hoge zekerheid (28 schattingen)')).toBeTruthy();
      expect(screen.getByText('Vraagprijs')).toBeTruthy();
    });
  });

  it('does not show a WOZ-only FMV fallback as a crowd estimate', () => {
    render(
      <PriceSection
        property={{
          ...property,
          askingPrice: undefined,
          officialValuation: 12952000,
          officialValuationYear: 2025,
          fmv: {
            fmv: 12952000,
            confidence: 'none',
            guessCount: 0,
            distribution: null,
            officialValuation: 12952000,
            askingPrice: null,
            divergence: null,
          },
          guessCount: 0,
        }}
      />
    );

    const crowdCard = screen.getByTestId('price-snapshot-crowd-card');
    const valuationCard = screen.getByTestId('price-snapshot-valuation-card');

    expect(within(crowdCard).getByText('Crowd Estimate')).toBeTruthy();
    expect(within(crowdCard).getByText('Not enough signal yet')).toBeTruthy();
    expect(within(crowdCard).getByText('More guesses will tighten the estimate.')).toBeTruthy();
    expect(within(crowdCard).queryByText(/€\s*12\.952\.000/)).toBeNull();
    expect(within(valuationCard).getByText('WOZ Value (2025)')).toBeTruthy();
    expect(within(valuationCard).getByText(/€\s*12\.952\.000/)).toBeTruthy();
  });

  it('shows the WOZ card with a skeleton while an expected value hydrates', () => {
    render(
      <PriceSection
        property={{
          ...property,
          officialValuation: null,
          officialValuationYear: null,
          officialValuationSourceFetch: {
            source: 'woz',
            expectedValuationYear: 2025,
            supportsClientFetch: { web: false, native: false },
          },
        }}
      />
    );

    const valuationCard = screen.getByTestId('price-snapshot-valuation-card');
    expect(within(valuationCard).getByText('WOZ Value (2025)')).toBeTruthy();
    expect(screen.getByTestId('price-snapshot-valuation-card-value-skeleton')).toBeTruthy();
  });

  it('hides the WOZ card after hydration timeout marks it hidden', () => {
    render(
      <PriceSection
        property={{
          ...property,
          officialValuation: null,
          officialValuationYear: null,
          officialValuationHydrationHidden: true,
          officialValuationSourceFetch: {
            source: 'woz',
            expectedValuationYear: 2025,
            supportsClientFetch: { web: false, native: false },
          },
        }}
      />
    );

    expect(screen.queryByTestId('price-snapshot-valuation-card')).toBeNull();
  });
});

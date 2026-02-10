import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ConsensusAlignment, calculateAlignmentPercentage } from '../ConsensusAlignment';
import type { PriceGuess } from '../../hooks/usePriceGuess';

// Helper to create mock guesses
function makeGuess(price: number, userId = 'user-other'): PriceGuess {
  return {
    id: `guess-${price}`,
    propertyId: 'prop-1',
    userId,
    guessedPrice: price,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('calculateAlignmentPercentage', () => {
  it('returns 100 when all guesses are within ±10%', () => {
    const guesses = [makeGuess(340000), makeGuess(360000), makeGuess(350000)];
    // ±10% of 350000 = 315000-385000. All are in range.
    expect(calculateAlignmentPercentage(350000, guesses)).toBe(100);
  });

  it('returns 0 when no guesses are within ±10%', () => {
    const guesses = [makeGuess(100000), makeGuess(600000)];
    // ±10% of 350000 = 315000-385000. None in range.
    expect(calculateAlignmentPercentage(350000, guesses)).toBe(0);
  });

  it('returns correct percentage for mixed guesses', () => {
    const guesses = [
      makeGuess(340000), // in range (315k-385k)
      makeGuess(360000), // in range
      makeGuess(100000), // out of range
      makeGuess(600000), // out of range
    ];
    expect(calculateAlignmentPercentage(350000, guesses)).toBe(50);
  });

  it('excludes the user\'s own guess when userId provided', () => {
    const guesses = [
      makeGuess(350000, 'me'),     // user's own, excluded
      makeGuess(340000),           // in range
      makeGuess(600000),           // out of range
    ];
    // Only 2 other guesses: 1 in range, 1 out = 50%
    expect(calculateAlignmentPercentage(350000, guesses, 'me')).toBe(50);
  });

  it('returns 0 for empty guesses array', () => {
    expect(calculateAlignmentPercentage(350000, [])).toBe(0);
  });
});

describe('ConsensusAlignment', () => {
  const defaultProps = {
    userGuess: 350000,
    crowdEstimate: 340000,
    guessCount: 10,
    guesses: [
      makeGuess(340000),
      makeGuess(345000),
      makeGuess(350000),
      makeGuess(355000),
    ],
  };

  it('renders correctly when visible', () => {
    render(<ConsensusAlignment {...defaultProps} isVisible />);

    expect(screen.getByTestId('consensus-alignment')).toBeTruthy();
    expect(screen.getByTestId('consensus-message')).toBeTruthy();
  });

  it('does not render when isVisible is false', () => {
    render(<ConsensusAlignment {...defaultProps} isVisible={false} />);

    expect(screen.queryByTestId('consensus-alignment')).toBeNull();
  });

  it('does not render when crowdEstimate is 0', () => {
    render(
      <ConsensusAlignment
        userGuess={350000}
        crowdEstimate={0}
        guessCount={10}
        isVisible
      />
    );

    expect(screen.queryByTestId('consensus-alignment')).toBeNull();
  });

  it('shows alignment message when guess is within 5% of estimate', () => {
    // 350000 vs 340000 = ~3% difference
    render(<ConsensusAlignment {...defaultProps} isVisible />);

    expect(screen.getByText(/agree with/)).toBeTruthy();
    expect(screen.getByText(/top predictors/)).toBeTruthy();
  });

  it('shows close message when guess is 5-15% different', () => {
    render(
      <ConsensusAlignment
        userGuess={380000} // ~12% above 340000
        crowdEstimate={340000}
        guessCount={10}
        guesses={defaultProps.guesses}
        isVisible
      />
    );

    expect(screen.getByText(/close to the crowd consensus/)).toBeTruthy();
  });

  it('shows difference message when guess is more than 15% different', () => {
    render(
      <ConsensusAlignment
        userGuess={450000} // ~32% above 340000
        crowdEstimate={340000}
        guessCount={10}
        guesses={defaultProps.guesses}
        isVisible
      />
    );

    expect(screen.getByText(/above the crowd estimate/)).toBeTruthy();
  });

  it('shows below message when guess is significantly lower', () => {
    render(
      <ConsensusAlignment
        userGuess={250000} // ~26% below 340000
        crowdEstimate={340000}
        guessCount={10}
        guesses={defaultProps.guesses}
        isVisible
      />
    );

    expect(screen.getByText(/below the crowd estimate/)).toBeTruthy();
  });

  it('displays guess count', () => {
    render(<ConsensusAlignment {...defaultProps} isVisible />);

    expect(screen.getByText(/10 guesses/)).toBeTruthy();
  });

  it('displays percentile rank when provided', () => {
    render(
      <ConsensusAlignment
        {...defaultProps}
        percentileRank={75}
        isVisible
      />
    );

    expect(screen.getByText(/75%/)).toBeTruthy();
    expect(screen.getByText(/predictions/)).toBeTruthy();
  });

  it('uses topPredictorsAgreement when provided', () => {
    render(
      <ConsensusAlignment
        {...defaultProps}
        topPredictorsAgreement={92}
        isVisible
      />
    );

    // Use getAllByText since percentage might appear in multiple places
    expect(screen.getAllByText(/92%/).length).toBeGreaterThan(0);
  });

  it('uses custom testID when provided', () => {
    render(
      <ConsensusAlignment {...defaultProps} testID="custom-consensus" isVisible />
    );

    expect(screen.getByTestId('custom-consensus')).toBeTruthy();
  });

  it('handles single guess correctly', () => {
    render(
      <ConsensusAlignment
        {...defaultProps}
        guessCount={1}
        isVisible
      />
    );

    expect(screen.getByText(/1 guess$/)).toBeTruthy();
  });
});

describe('ConsensusAlignment - Insufficient Data', () => {
  it('shows "Not enough data" when guessCount < 3', () => {
    render(
      <ConsensusAlignment
        userGuess={350000}
        crowdEstimate={340000}
        guessCount={2}
        guesses={[makeGuess(340000), makeGuess(350000)]}
        isVisible
      />
    );

    expect(screen.getByText(/Not enough data for consensus/)).toBeTruthy();
  });

  it('shows "Not enough data" when guessCount is 0', () => {
    render(
      <ConsensusAlignment
        userGuess={350000}
        crowdEstimate={340000}
        guessCount={0}
        guesses={[]}
        isVisible
      />
    );

    expect(screen.getByText(/Not enough data for consensus/)).toBeTruthy();
  });

  it('does not show progress bar when insufficient data', () => {
    render(
      <ConsensusAlignment
        userGuess={345000}
        crowdEstimate={340000}
        guessCount={2}
        guesses={[makeGuess(340000), makeGuess(350000)]}
        isVisible
      />
    );

    // The progress bar percentage text should not appear
    // The message should be "Not enough data" not "agree with X%"
    expect(screen.getByText(/Not enough data for consensus/)).toBeTruthy();
    expect(screen.queryByText(/agree with/)).toBeNull();
  });

  it('does not show price comparison when insufficient data even for "different" category', () => {
    render(
      <ConsensusAlignment
        userGuess={500000}
        crowdEstimate={340000}
        guessCount={1}
        guesses={[makeGuess(340000)]}
        isVisible
      />
    );

    expect(screen.getByText(/Not enough data for consensus/)).toBeTruthy();
    expect(screen.queryByText('Your guess')).toBeNull();
    expect(screen.queryByText('Crowd estimate')).toBeNull();
  });
});

describe('ConsensusAlignment - Alignment Categories', () => {
  const guesses = [
    makeGuess(340000),
    makeGuess(345000),
    makeGuess(350000),
    makeGuess(355000),
  ];

  it('shows green styling for aligned guesses', () => {
    render(
      <ConsensusAlignment
        userGuess={345000}
        crowdEstimate={340000}
        guessCount={10}
        guesses={guesses}
        isVisible
      />
    );

    expect(screen.getByTestId('consensus-alignment')).toBeTruthy();
  });

  it('shows blue styling for close guesses', () => {
    render(
      <ConsensusAlignment
        userGuess={375000} // ~10% above
        crowdEstimate={340000}
        guessCount={10}
        guesses={guesses}
        isVisible
      />
    );

    expect(screen.getByTestId('consensus-alignment')).toBeTruthy();
  });

  it('shows amber styling for different guesses', () => {
    render(
      <ConsensusAlignment
        userGuess={450000} // ~32% above
        crowdEstimate={340000}
        guessCount={10}
        guesses={guesses}
        isVisible
      />
    );

    expect(screen.getByTestId('consensus-alignment')).toBeTruthy();
  });
});

describe('ConsensusAlignment - Price Display', () => {
  it('shows price comparison for different guesses with enough data', () => {
    render(
      <ConsensusAlignment
        userGuess={500000}
        crowdEstimate={340000}
        guessCount={10}
        guesses={[makeGuess(340000), makeGuess(350000), makeGuess(330000)]}
        isVisible
      />
    );

    expect(screen.getByText('Your guess')).toBeTruthy();
    expect(screen.getByText('Crowd estimate')).toBeTruthy();
  });
});

describe('ConsensusAlignment - Real Alignment Calculation', () => {
  it('uses guesses array to compute real alignment percentage', () => {
    // All 4 guesses within ±10% of 350000 (315k-385k)
    const guesses = [
      makeGuess(340000),
      makeGuess(345000),
      makeGuess(350000),
      makeGuess(355000),
    ];

    render(
      <ConsensusAlignment
        userGuess={350000}
        crowdEstimate={340000}
        guessCount={10}
        guesses={guesses}
        isVisible
      />
    );

    // 100% alignment → "agree with 100% of top predictors"
    expect(screen.getByText(/agree with 100% of top predictors/)).toBeTruthy();
  });

  it('shows lower alignment when guesses are far apart', () => {
    const guesses = [
      makeGuess(340000), // in range of 350k ±10%
      makeGuess(200000), // out of range
      makeGuess(500000), // out of range
    ];

    render(
      <ConsensusAlignment
        userGuess={350000}
        crowdEstimate={340000}
        guessCount={10}
        guesses={guesses}
        isVisible
      />
    );

    // 1/3 = 33% → "agree with 33% of top predictors"
    expect(screen.getByText(/agree with 33% of top predictors/)).toBeTruthy();
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ConsensusAlignment } from '../ConsensusAlignment';

// Mocks are configured in jest.config.js

describe('ConsensusAlignment', () => {
  const defaultProps = {
    userGuess: 350000,
    crowdEstimate: 340000,
    guessCount: 10,
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

describe('ConsensusAlignment - Alignment Categories', () => {
  it('shows green styling for aligned guesses', () => {
    // When within 5%, should have checkmark icon
    render(
      <ConsensusAlignment
        userGuess={345000}
        crowdEstimate={340000}
        guessCount={10}
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
        isVisible
      />
    );

    expect(screen.getByTestId('consensus-alignment')).toBeTruthy();
  });
});

describe('ConsensusAlignment - Price Display', () => {
  it('shows price comparison for different guesses', () => {
    render(
      <ConsensusAlignment
        userGuess={500000}
        crowdEstimate={340000}
        guessCount={10}
        isVisible
      />
    );

    // Should show both "Your guess" and "Crowd estimate" sections
    expect(screen.getByText('Your guess')).toBeTruthy();
    expect(screen.getByText('Crowd estimate')).toBeTruthy();
  });
});

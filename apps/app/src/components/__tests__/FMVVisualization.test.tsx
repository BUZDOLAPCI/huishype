import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { FMVVisualization } from '../FMVVisualization';
import type { FMVData } from '../FMVVisualization';

// Mocks are configured in jest.config.js

describe('FMVVisualization', () => {
  const mockFMV: FMVData = {
    value: 350000,
    confidence: 'medium',
    guessCount: 7,
    distribution: {
      p10: 290000,
      p25: 310000,
      p50: 345000,
      p75: 380000,
      p90: 410000,
      min: 280000,
      max: 420000,
    },
  };

  it('renders correctly with FMV data', () => {
    render(<FMVVisualization fmv={mockFMV} />);

    expect(screen.getByText('Crowd Estimate')).toBeTruthy();
    expect(screen.getByTestId('fmv-value')).toBeTruthy();
  });

  it('shows loading skeleton when isLoading is true', () => {
    render(<FMVVisualization fmv={null} isLoading />);

    expect(screen.getByTestId('fmv-loading')).toBeTruthy();
  });

  it('shows no data state when fmv is null', () => {
    render(<FMVVisualization fmv={null} />);

    expect(screen.getByTestId('fmv-no-data')).toBeTruthy();
    expect(screen.getByText(/Not enough data/)).toBeTruthy();
  });

  it('shows no data state when confidence is none', () => {
    const noneFmv: FMVData = {
      value: null,
      confidence: 'none',
      guessCount: 0,
      distribution: null,
    };

    render(<FMVVisualization fmv={noneFmv} />);

    expect(screen.getByTestId('fmv-no-data')).toBeTruthy();
  });

  it('displays FMV value in Dutch locale format', () => {
    render(<FMVVisualization fmv={mockFMV} />);

    // Dutch format: €350.000
    const fmvElement = screen.getByTestId('fmv-value');
    expect(fmvElement.props.children).toContain('350');
  });

  it('shows low confidence indicator', () => {
    const lowConfidenceFMV: FMVData = {
      ...mockFMV,
      confidence: 'low',
      guessCount: 2,
    };

    render(<FMVVisualization fmv={lowConfidenceFMV} />);

    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('shows medium confidence indicator', () => {
    render(<FMVVisualization fmv={mockFMV} />);

    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Building consensus')).toBeTruthy();
  });

  it('shows high confidence indicator', () => {
    const highConfidenceFMV: FMVData = {
      ...mockFMV,
      confidence: 'high',
      guessCount: 15,
    };

    render(<FMVVisualization fmv={highConfidenceFMV} />);

    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Strong consensus')).toBeTruthy();
  });

  it('displays min and max distribution values', () => {
    render(<FMVVisualization fmv={mockFMV} />);

    // Check for min price (€280.000)
    expect(screen.getByText(/280.000/)).toBeTruthy();
    // Check for max price (€420.000)
    expect(screen.getByText(/420.000/)).toBeTruthy();
  });

  it('displays guess count', () => {
    render(<FMVVisualization fmv={mockFMV} />);

    expect(screen.getByText(/7 guesses/)).toBeTruthy();
  });

  it('shows divergence when asking price provided via props', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={400000} />);

    // Should show comparison text about asking price vs crowd estimate
    expect(screen.getByText(/above|below|matches/)).toBeTruthy();
  });

  it('shows user guess comparison when provided', () => {
    render(<FMVVisualization fmv={mockFMV} userGuess={360000} />);

    expect(screen.getByText(/Your guess is/)).toBeTruthy();
  });

  it('shows WOZ value when provided', () => {
    render(<FMVVisualization fmv={mockFMV} wozValue={320000} />);

    expect(screen.getByText(/WOZ:/)).toBeTruthy();
    expect(screen.getByText(/320.000/)).toBeTruthy();
  });

  it('uses custom testID when provided', () => {
    render(<FMVVisualization fmv={mockFMV} testID="custom-fmv" />);

    expect(screen.getByTestId('custom-fmv')).toBeTruthy();
  });

  it('shows divergence from embedded FMV data', () => {
    const fmvWithDivergence: FMVData = {
      ...mockFMV,
      askingPrice: 400000,
      divergence: -12.5,
    };

    render(<FMVVisualization fmv={fmvWithDivergence} />);

    expect(screen.getByText(/above crowd estimate/)).toBeTruthy();
  });

  it('handles asking price above estimate', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={420000} />);

    expect(screen.getByText(/above/)).toBeTruthy();
  });

  it('handles asking price below estimate', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={300000} />);

    expect(screen.getByText(/more than asking/)).toBeTruthy();
  });
});

describe('FMVVisualization - Edge Cases', () => {
  it('handles single guess count correctly', () => {
    const singleGuessFMV: FMVData = {
      value: 300000,
      confidence: 'low',
      guessCount: 1,
      distribution: {
        p10: 300000,
        p25: 300000,
        p50: 300000,
        p75: 300000,
        p90: 300000,
        min: 300000,
        max: 300000,
      },
    };

    render(<FMVVisualization fmv={singleGuessFMV} />);

    // Use getAllByText since "1 guess" might appear in multiple places
    expect(screen.getAllByText(/1 guess$/).length).toBeGreaterThan(0);
  });

  it('handles zero distribution range', () => {
    const zeroRangeFMV: FMVData = {
      value: 350000,
      confidence: 'low',
      guessCount: 1,
      distribution: {
        p10: 350000,
        p25: 350000,
        p50: 350000,
        p75: 350000,
        p90: 350000,
        min: 350000,
        max: 350000,
      },
    };

    render(<FMVVisualization fmv={zeroRangeFMV} />);

    expect(screen.getByTestId('fmv-visualization')).toBeTruthy();
  });

  it('handles user guess aligned with estimate', () => {
    const fmv: FMVData = {
      value: 350000,
      confidence: 'high',
      guessCount: 10,
      distribution: {
        p10: 310000,
        p25: 330000,
        p50: 350000,
        p75: 370000,
        p90: 390000,
        min: 300000,
        max: 400000,
      },
    };

    render(<FMVVisualization fmv={fmv} userGuess={350000} />);

    expect(screen.getByText(/aligned with/)).toBeTruthy();
  });

  it('handles null distribution gracefully', () => {
    const noDistFmv: FMVData = {
      value: 300000,
      confidence: 'low',
      guessCount: 1,
      distribution: null,
    };

    render(<FMVVisualization fmv={noDistFmv} />);

    expect(screen.getByTestId('fmv-visualization')).toBeTruthy();
    expect(screen.getByTestId('fmv-value')).toBeTruthy();
  });

  it('handles null value as no data', () => {
    const nullValueFmv: FMVData = {
      value: null,
      confidence: 'low',
      guessCount: 0,
      distribution: null,
    };

    render(<FMVVisualization fmv={nullValueFmv} />);

    expect(screen.getByTestId('fmv-no-data')).toBeTruthy();
  });
});

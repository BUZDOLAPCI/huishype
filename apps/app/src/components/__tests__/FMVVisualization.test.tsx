import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { FMVVisualization, type FMVData } from '../FMVVisualization';

// Mocks are configured in jest.config.js

describe('FMVVisualization', () => {
  const mockFMV: FMVData = {
    value: 350000,
    confidence: 'medium',
    guessCount: 7,
    distribution: {
      min: 280000,
      max: 420000,
      median: 345000,
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

  it('shows comparison when asking price is provided', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={400000} />);

    expect(screen.getByText(/Asking price is/)).toBeTruthy();
    expect(screen.getByText(/crowd estimate/)).toBeTruthy();
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

  it('handles asking price above estimate', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={420000} />);

    expect(screen.getByText(/above/)).toBeTruthy();
  });

  it('handles asking price below estimate', () => {
    render(<FMVVisualization fmv={mockFMV} askingPrice={300000} />);

    expect(screen.getByText(/below/)).toBeTruthy();
  });
});

describe('FMVVisualization - Edge Cases', () => {
  it('handles single guess count correctly', () => {
    const singleGuessFMV: FMVData = {
      value: 300000,
      confidence: 'low',
      guessCount: 1,
      distribution: {
        min: 300000,
        max: 300000,
        median: 300000,
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
        min: 350000,
        max: 350000,
        median: 350000,
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
        min: 300000,
        max: 400000,
        median: 350000,
      },
    };

    render(<FMVVisualization fmv={fmv} userGuess={350000} />);

    expect(screen.getByText(/aligned with/)).toBeTruthy();
  });
});

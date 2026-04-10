import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MetricPills } from '../MetricPills';

describe('MetricPills - Info variant', () => {
  it('renders year built', () => {
    render(<MetricPills info={{ yearBuilt: 1925 }} />);
    expect(screen.getByText('1925')).toBeTruthy();
  });

  it('renders floor area', () => {
    render(<MetricPills info={{ floorAreaM2: 120 }} />);
    expect(screen.getByText('120 m\u00B2')).toBeTruthy();
  });

  it('renders view count', () => {
    render(<MetricPills info={{ viewCount: 500 }} />);
    expect(screen.getByText('500')).toBeTruthy();
  });

  it('returns null when no info data', () => {
    const { toJSON } = render(<MetricPills info={{}} />);
    expect(toJSON()).toBeNull();
  });

  it('does not render view count when 0', () => {
    render(<MetricPills info={{ yearBuilt: 1950, viewCount: 0 }} />);
    expect(screen.getByText('1950')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders all info pills together', () => {
    render(
      <MetricPills
        info={{
          yearBuilt: 1920,
          floorAreaM2: 85,
          viewCount: 1200,
        }}
      />
    );
    expect(screen.getByText('1920')).toBeTruthy();
    expect(screen.getByText('85 m\u00B2')).toBeTruthy();
    expect(screen.getByText('1.2K')).toBeTruthy();
  });
});

describe('MetricPills - Stats variant', () => {
  it('renders like count', () => {
    render(<MetricPills stats={{ likeCount: 42 }} />);
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders comment count', () => {
    render(<MetricPills stats={{ commentCount: 15 }} />);
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('renders guess count', () => {
    render(<MetricPills stats={{ guessCount: 8 }} />);
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('formats large counts with K suffix', () => {
    render(<MetricPills stats={{ likeCount: 415000 }} />);
    expect(screen.getByText('415K')).toBeTruthy();
  });

  it('returns null when all stats are 0', () => {
    const { toJSON } = render(
      <MetricPills stats={{ likeCount: 0, commentCount: 0 }} />
    );
    expect(toJSON()).toBeNull();
  });

  it('uses correct testID', () => {
    render(
      <MetricPills stats={{ likeCount: 5 }} testID="custom-pills" />
    );
    expect(screen.getByTestId('custom-pills')).toBeTruthy();
  });
});

describe('MetricPills - Auto variant detection', () => {
  it('auto-selects stats variant when stats provided', () => {
    render(<MetricPills stats={{ likeCount: 10 }} />);
    expect(screen.getByTestId('metric-pills-stats')).toBeTruthy();
  });

  it('auto-selects info variant when info provided', () => {
    render(<MetricPills info={{ yearBuilt: 1990 }} />);
    expect(screen.getByTestId('metric-pills-info')).toBeTruthy();
  });
});

import React from 'react';
import { render } from '@testing-library/react-native';
import { KarmaBadge, getKarmaConfig } from '../KarmaBadge';

describe('KarmaBadge', () => {
  describe('getKarmaConfig', () => {
    it('returns Newbie for karma 0-10', () => {
      expect(getKarmaConfig(0).label).toBe('Newbie');
      expect(getKarmaConfig(5).label).toBe('Newbie');
      expect(getKarmaConfig(10).label).toBe('Newbie');
    });

    it('returns Regular for karma 11-50', () => {
      expect(getKarmaConfig(11).label).toBe('Regular');
      expect(getKarmaConfig(30).label).toBe('Regular');
      expect(getKarmaConfig(50).label).toBe('Regular');
    });

    it('returns Trusted for karma 51-100', () => {
      expect(getKarmaConfig(51).label).toBe('Trusted');
      expect(getKarmaConfig(75).label).toBe('Trusted');
      expect(getKarmaConfig(100).label).toBe('Trusted');
    });

    it('returns Expert for karma 101-499', () => {
      expect(getKarmaConfig(101).label).toBe('Expert');
      expect(getKarmaConfig(300).label).toBe('Expert');
      expect(getKarmaConfig(499).label).toBe('Expert');
    });

    it('returns Legend for karma 500 and over', () => {
      expect(getKarmaConfig(500).label).toBe('Legend');
      expect(getKarmaConfig(1000).label).toBe('Legend');
      expect(getKarmaConfig(10000).label).toBe('Legend');
    });

    it('returns correct colors for each rank', () => {
      // Newbie - gray
      expect(getKarmaConfig(5).bgColor).toContain('gray');
      expect(getKarmaConfig(5).textColor).toContain('gray');

      // Regular - green
      expect(getKarmaConfig(25).bgColor).toContain('green');
      expect(getKarmaConfig(25).textColor).toContain('green');

      // Trusted - blue
      expect(getKarmaConfig(75).bgColor).toContain('blue');
      expect(getKarmaConfig(75).textColor).toContain('blue');

      // Expert - purple
      expect(getKarmaConfig(200).bgColor).toContain('purple');
      expect(getKarmaConfig(200).textColor).toContain('purple');

      // Legend - amber/gold
      expect(getKarmaConfig(600).bgColor).toContain('amber');
      expect(getKarmaConfig(600).textColor).toContain('amber');
    });
  });

  describe('KarmaBadge component', () => {
    it('renders the correct label for Newbie', () => {
      const { getByText } = render(<KarmaBadge karma={5} />);
      expect(getByText('Newbie')).toBeTruthy();
    });

    it('renders the correct label for Regular', () => {
      const { getByText } = render(<KarmaBadge karma={25} />);
      expect(getByText('Regular')).toBeTruthy();
    });

    it('renders the correct label for Trusted', () => {
      const { getByText } = render(<KarmaBadge karma={75} />);
      expect(getByText('Trusted')).toBeTruthy();
    });

    it('renders the correct label for Expert', () => {
      const { getByText } = render(<KarmaBadge karma={200} />);
      expect(getByText('Expert')).toBeTruthy();
    });

    it('renders the correct label for Legend', () => {
      const { getByText } = render(<KarmaBadge karma={600} />);
      expect(getByText('Legend')).toBeTruthy();
    });

    it('renders with testID', () => {
      const { getByTestId } = render(<KarmaBadge karma={100} />);
      expect(getByTestId('karma-badge')).toBeTruthy();
    });

    it('handles size prop correctly', () => {
      const { rerender, getByTestId } = render(<KarmaBadge karma={100} size="sm" />);
      expect(getByTestId('karma-badge')).toBeTruthy();

      rerender(<KarmaBadge karma={100} size="md" />);
      expect(getByTestId('karma-badge')).toBeTruthy();
    });
  });
});

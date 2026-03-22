import React from 'react';
import { render } from '@testing-library/react-native';
import { KarmaBadge, getKarmaConfig } from '../KarmaBadge';

describe('KarmaBadge', () => {
  describe('getKarmaConfig', () => {
    it('returns Newcomer for karma 0-9', () => {
      expect(getKarmaConfig(0).label).toBe('Newcomer');
      expect(getKarmaConfig(5).label).toBe('Newcomer');
      expect(getKarmaConfig(9).label).toBe('Newcomer');
    });

    it('returns Contributor for karma 10-49', () => {
      expect(getKarmaConfig(10).label).toBe('Contributor');
      expect(getKarmaConfig(30).label).toBe('Contributor');
      expect(getKarmaConfig(49).label).toBe('Contributor');
    });

    it('returns Rising Star for karma 50-99', () => {
      expect(getKarmaConfig(50).label).toBe('Rising Star');
      expect(getKarmaConfig(75).label).toBe('Rising Star');
      expect(getKarmaConfig(99).label).toBe('Rising Star');
    });

    it('returns Local Expert for karma 100-199', () => {
      expect(getKarmaConfig(100).label).toBe('Local Expert');
      expect(getKarmaConfig(150).label).toBe('Local Expert');
      expect(getKarmaConfig(199).label).toBe('Local Expert');
    });

    it('returns Expert for karma 200-499', () => {
      expect(getKarmaConfig(200).label).toBe('Expert');
      expect(getKarmaConfig(300).label).toBe('Expert');
      expect(getKarmaConfig(499).label).toBe('Expert');
    });

    it('returns Local Legend for karma 500-999', () => {
      expect(getKarmaConfig(500).label).toBe('Local Legend');
      expect(getKarmaConfig(750).label).toBe('Local Legend');
      expect(getKarmaConfig(999).label).toBe('Local Legend');
    });

    it('returns Master for karma 1000+', () => {
      expect(getKarmaConfig(1000).label).toBe('Master');
      expect(getKarmaConfig(5000).label).toBe('Master');
      expect(getKarmaConfig(10000).label).toBe('Master');
    });

    it('returns correct level for each tier', () => {
      expect(getKarmaConfig(0).level).toBe(1);
      expect(getKarmaConfig(10).level).toBe(2);
      expect(getKarmaConfig(50).level).toBe(3);
      expect(getKarmaConfig(100).level).toBe(4);
      expect(getKarmaConfig(200).level).toBe(5);
      expect(getKarmaConfig(500).level).toBe(6);
      expect(getKarmaConfig(1000).level).toBe(7);
    });

    it('returns Newcomer for negative karma (clamped to 0)', () => {
      expect(getKarmaConfig(-5).label).toBe('Newcomer');
      expect(getKarmaConfig(-100).label).toBe('Newcomer');
    });

    it('returns non-empty colour strings for all tiers', () => {
      const checkpoints = [0, 10, 50, 100, 200, 500, 1000];
      for (const karma of checkpoints) {
        const config = getKarmaConfig(karma);
        expect(config.bgColor).toBeTruthy();
        expect(config.textColor).toBeTruthy();
      }
    });
  });

  describe('KarmaBadge component', () => {
    it('renders the correct label for Newcomer', () => {
      const { getByText } = render(<KarmaBadge karma={5} />);
      expect(getByText('Newcomer')).toBeTruthy();
    });

    it('renders the correct label for Contributor', () => {
      const { getByText } = render(<KarmaBadge karma={25} />);
      expect(getByText('Contributor')).toBeTruthy();
    });

    it('renders the correct label for Rising Star', () => {
      const { getByText } = render(<KarmaBadge karma={75} />);
      expect(getByText('Rising Star')).toBeTruthy();
    });

    it('renders the correct label for Local Expert', () => {
      const { getByText } = render(<KarmaBadge karma={150} />);
      expect(getByText('Local Expert')).toBeTruthy();
    });

    it('renders the correct label for Expert', () => {
      const { getByText } = render(<KarmaBadge karma={300} />);
      expect(getByText('Expert')).toBeTruthy();
    });

    it('renders the correct label for Local Legend', () => {
      const { getByText } = render(<KarmaBadge karma={600} />);
      expect(getByText('Local Legend')).toBeTruthy();
    });

    it('renders the correct label for Master', () => {
      const { getByText } = render(<KarmaBadge karma={1500} />);
      expect(getByText('Master')).toBeTruthy();
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

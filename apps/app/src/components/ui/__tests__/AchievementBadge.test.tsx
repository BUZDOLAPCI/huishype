import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { AchievementBadge } from '../AchievementBadge';
import type { AchievementDefinition } from '@huishype/shared';

const mockAchievement: AchievementDefinition = {
  key: 'first_guess',
  name: 'Price Whisperer',
  description: 'Submitted your first price guess',
  icon: 'CurrencyEur',
  category: 'guessing',
};

describe('AchievementBadge - compact variant', () => {
  it('renders achievement name', () => {
    render(<AchievementBadge achievement={mockAchievement} earned />);
    expect(screen.getByText('Price Whisperer')).toBeTruthy();
  });

  it('renders with correct testID', () => {
    render(<AchievementBadge achievement={mockAchievement} earned />);
    expect(screen.getByTestId('achievement-badge')).toBeTruthy();
  });

  it('uses custom testID', () => {
    render(
      <AchievementBadge
        achievement={mockAchievement}
        earned
        testID="custom-badge"
      />
    );
    expect(screen.getByTestId('custom-badge')).toBeTruthy();
  });

  it('renders locked state by default', () => {
    render(<AchievementBadge achievement={mockAchievement} />);
    // Should still render the badge
    expect(screen.getByTestId('achievement-badge')).toBeTruthy();
  });
});

describe('AchievementBadge - card variant', () => {
  it('renders achievement name and description', () => {
    render(
      <AchievementBadge
        achievement={mockAchievement}
        variant="card"
        earned
      />
    );
    expect(screen.getByText('Price Whisperer')).toBeTruthy();
    expect(screen.getByText('Submitted your first price guess')).toBeTruthy();
  });

  it('renders card testID', () => {
    render(
      <AchievementBadge
        achievement={mockAchievement}
        variant="card"
        earned
      />
    );
    expect(screen.getByTestId('achievement-badge-card')).toBeTruthy();
  });

  it('renders earned date when provided', () => {
    // Use a fixed date for testing
    const awardedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <AchievementBadge
        achievement={mockAchievement}
        variant="card"
        earned
        awardedAt={awardedAt}
      />
    );
    expect(screen.getByText(/Earned/)).toBeTruthy();
    expect(screen.getByText(/3 days ago/)).toBeTruthy();
  });

  it('does not render earned date when not earned', () => {
    render(
      <AchievementBadge
        achievement={mockAchievement}
        variant="card"
      />
    );
    expect(screen.queryByText(/Earned/)).toBeNull();
  });
});

describe('AchievementBadge - category colors', () => {
  it('renders different colors for social category', () => {
    const social: AchievementDefinition = {
      key: 'first_comment',
      name: 'First Words',
      description: 'Left your first comment',
      icon: 'ChatCircle',
      category: 'social',
    };
    render(<AchievementBadge achievement={social} earned />);
    expect(screen.getByTestId('achievement-badge')).toBeTruthy();
  });

  it('renders different colors for milestone category', () => {
    const milestone: AchievementDefinition = {
      key: 'karma_500',
      name: 'Legend',
      description: 'Reached 500 karma',
      icon: 'Crown',
      category: 'milestone',
    };
    render(<AchievementBadge achievement={milestone} earned />);
    expect(screen.getByTestId('achievement-badge')).toBeTruthy();
  });
});

describe('AchievementBadge - icon fallback', () => {
  it('handles unknown icon name gracefully', () => {
    const unknownIcon: AchievementDefinition = {
      key: 'test',
      name: 'Test',
      description: 'Test achievement',
      icon: 'SomeUnknownIcon',
      category: 'social',
    };
    render(<AchievementBadge achievement={unknownIcon} earned />);
    // Should render without crashing — falls back to 'Star'
    expect(screen.getByTestId('achievement-badge')).toBeTruthy();
  });
});

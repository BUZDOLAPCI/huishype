/**
 * Canonical achievement registry.
 *
 * Single source of truth for achievement definitions used by both frontend
 * (badge rendering, profile display) and backend (award evaluation).
 *
 * Keys are stable identifiers — never rename them after users earn them.
 *
 * Import from `@huishype/shared`:
 *   import { ACHIEVEMENT_REGISTRY, getAchievementByKey, getAchievementsByCategory } from '@huishype/shared';
 */

import type { AchievementCategory, AchievementDefinition } from '../types/achievement.js';

/**
 * All 14 achievements the system can award.
 */
export const ACHIEVEMENT_REGISTRY: readonly AchievementDefinition[] = [
  // Social
  {
    key: 'first_comment',
    name: 'First Words',
    description: 'Left your first comment on a property',
    icon: 'ChatCircle',
    category: 'social',
  },
  {
    key: 'commentator_10',
    name: 'Chatterbox',
    description: 'Left 10 comments across properties',
    icon: 'ChatCircle',
    category: 'social',
  },
  {
    key: 'first_like_given',
    name: 'Thumbs Up',
    description: 'Liked your first property',
    icon: 'Heart',
    category: 'social',
  },
  {
    key: 'liked_by_5',
    name: 'Popular Taste',
    description: 'Had 5 of your comments liked by others',
    icon: 'Heart',
    category: 'social',
  },

  // Guessing
  {
    key: 'first_guess',
    name: 'Price Whisperer',
    description: 'Submitted your first price guess',
    icon: 'CurrencyEur',
    category: 'guessing',
  },
  {
    key: 'guesser_10',
    name: 'Market Watcher',
    description: 'Submitted 10 price guesses',
    icon: 'ChartLineUp',
    category: 'guessing',
  },
  {
    key: 'guesser_50',
    name: 'Price Oracle',
    description: 'Submitted 50 price guesses',
    icon: 'Eye',
    category: 'guessing',
  },
  {
    key: 'accurate_guess',
    name: 'Bullseye',
    description: 'Your guess was within 5% of the sale price',
    icon: 'CheckCircle',
    category: 'guessing',
  },

  // Exploration
  {
    key: 'first_save',
    name: 'Bookworm',
    description: 'Saved your first property',
    icon: 'BookmarkSimple',
    category: 'exploration',
  },
  {
    key: 'saved_10',
    name: 'Collector',
    description: 'Saved 10 properties',
    icon: 'BookmarkSimple',
    category: 'exploration',
  },

  // Milestones
  {
    key: 'karma_10',
    name: 'Rising Star',
    description: 'Reached 10 karma points',
    icon: 'Star',
    category: 'milestone',
  },
  {
    key: 'karma_50',
    name: 'Trusted Voice',
    description: 'Reached 50 karma points',
    icon: 'Medal',
    category: 'milestone',
  },
  {
    key: 'karma_100',
    name: 'Specialist',
    description: 'Reached 100 karma points',
    icon: 'Trophy',
    category: 'milestone',
  },
  {
    key: 'karma_500',
    name: 'Legend',
    description: 'Reached 500 karma points',
    icon: 'Crown',
    category: 'milestone',
  },
] as const;

const ACHIEVEMENT_MAP = new Map<string, AchievementDefinition>(
  ACHIEVEMENT_REGISTRY.map((a) => [a.key, a])
);

/**
 * Look up a single achievement by key.
 */
export function getAchievementByKey(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_MAP.get(key);
}

/**
 * Get all achievements in a given category.
 */
export function getAchievementsByCategory(
  category: AchievementCategory
): AchievementDefinition[] {
  return ACHIEVEMENT_REGISTRY.filter((a) => a.category === category);
}

/**
 * All achievement category labels for UI grouping.
 */
export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  social: 'Social',
  guessing: 'Guessing',
  exploration: 'Exploration',
  milestone: 'Milestones',
};

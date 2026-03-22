import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENT_REGISTRY,
  getAchievementByKey,
  getAchievementsByCategory,
  ACHIEVEMENT_CATEGORY_LABELS,
} from '../utils/achievement-registry.js';

describe('ACHIEVEMENT_REGISTRY', () => {
  it('contains exactly 14 achievements', () => {
    expect(ACHIEVEMENT_REGISTRY).toHaveLength(14);
  });

  it('has unique keys', () => {
    const keys = ACHIEVEMENT_REGISTRY.map((a) => a.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('all achievements have required fields', () => {
    for (const achievement of ACHIEVEMENT_REGISTRY) {
      expect(achievement.key).toBeTruthy();
      expect(achievement.name).toBeTruthy();
      expect(achievement.description).toBeTruthy();
      expect(achievement.icon).toBeTruthy();
      expect(['social', 'guessing', 'exploration', 'milestone']).toContain(
        achievement.category
      );
    }
  });

  it('contains expected achievement keys', () => {
    const keys = ACHIEVEMENT_REGISTRY.map((a) => a.key);
    expect(keys).toContain('first_comment');
    expect(keys).toContain('first_guess');
    expect(keys).toContain('first_save');
    expect(keys).toContain('karma_500');
    expect(keys).toContain('accurate_guess');
  });

  it('has 4 social achievements', () => {
    const social = ACHIEVEMENT_REGISTRY.filter((a) => a.category === 'social');
    expect(social).toHaveLength(4);
  });

  it('has 4 guessing achievements', () => {
    const guessing = ACHIEVEMENT_REGISTRY.filter((a) => a.category === 'guessing');
    expect(guessing).toHaveLength(4);
  });

  it('has 2 exploration achievements', () => {
    const exploration = ACHIEVEMENT_REGISTRY.filter((a) => a.category === 'exploration');
    expect(exploration).toHaveLength(2);
  });

  it('has 4 milestone achievements', () => {
    const milestones = ACHIEVEMENT_REGISTRY.filter((a) => a.category === 'milestone');
    expect(milestones).toHaveLength(4);
  });
});

describe('getAchievementByKey', () => {
  it('returns correct achievement for valid key', () => {
    const result = getAchievementByKey('first_guess');
    expect(result).toBeDefined();
    expect(result?.name).toBe('Price Whisperer');
    expect(result?.category).toBe('guessing');
  });

  it('returns undefined for unknown key', () => {
    expect(getAchievementByKey('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getAchievementByKey('')).toBeUndefined();
  });
});

describe('getAchievementsByCategory', () => {
  it('returns social achievements', () => {
    const results = getAchievementsByCategory('social');
    expect(results.length).toBe(4);
    for (const a of results) {
      expect(a.category).toBe('social');
    }
  });

  it('returns milestone achievements', () => {
    const results = getAchievementsByCategory('milestone');
    expect(results.length).toBe(4);
    for (const a of results) {
      expect(a.category).toBe('milestone');
    }
  });
});

describe('ACHIEVEMENT_CATEGORY_LABELS', () => {
  it('has labels for all categories', () => {
    expect(ACHIEVEMENT_CATEGORY_LABELS.social).toBe('Social');
    expect(ACHIEVEMENT_CATEGORY_LABELS.guessing).toBe('Guessing');
    expect(ACHIEVEMENT_CATEGORY_LABELS.exploration).toBe('Exploration');
    expect(ACHIEVEMENT_CATEGORY_LABELS.milestone).toBe('Milestones');
  });
});

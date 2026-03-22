/**
 * Achievement types for HuisHype
 *
 * Achievement definitions come from a shared registry.
 * Per-user unlock state comes from the user_achievements table.
 */

export type AchievementCategory = 'social' | 'guessing' | 'exploration' | 'milestone';

export interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
}

export interface EarnedAchievement extends AchievementDefinition {
  awardedAt: string;
}

export interface AchievementsResponse {
  earned: EarnedAchievement[];
  available: AchievementDefinition[];
  totalAvailable: number;
}

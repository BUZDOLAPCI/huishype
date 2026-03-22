/**
 * Achievement registry and award service.
 *
 * Achievements are defined in a shared registry with stable keys.
 * The award service evaluates rules deterministically and records unlocks.
 */

import { db } from '../db/index.js';
import { userAchievements, priceGuesses, comments, reactions, savedProperties } from '../db/schema.js';
import { eq, and, sql, count } from 'drizzle-orm';

// ─── Achievement Registry ──────────────────────────────────────────────

export interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
  icon: string; // Phosphor icon name
  /** Category for grouping in UI */
  category: 'social' | 'guessing' | 'exploration' | 'milestone';
}

/**
 * Canonical achievement registry. Every achievement the system can award.
 * Keys are stable identifiers — never rename them after users earn them.
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
    icon: 'ChatCircleDots',
    category: 'social',
  },
  {
    key: 'first_like_given',
    name: 'Thumbs Up',
    description: 'Liked your first property',
    icon: 'ThumbsUp',
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
    icon: 'Target',
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
    icon: 'FolderStar',
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

const ACHIEVEMENT_MAP = new Map(
  ACHIEVEMENT_REGISTRY.map((a) => [a.key, a])
);

export function getAchievementDefinition(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_MAP.get(key);
}

// ─── Award Service ─────────────────────────────────────────────────────

export interface AwardResult {
  newlyAwarded: string[];
}

/**
 * Evaluate all achievement rules for a user and award any that are newly earned.
 * This is deterministic and idempotent — calling it multiple times won't duplicate awards.
 */
export async function evaluateAchievements(
  userId: string,
  karma: number
): Promise<AwardResult> {
  // Fetch existing achievements for this user
  const existing = await db
    .select({ achievementKey: userAchievements.achievementKey })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));

  const alreadyEarned = new Set(existing.map((e) => e.achievementKey));

  // Fetch counts in parallel
  const [guessCountResult, commentCountResult, likeGivenResult, savedCountResult, commentLikesResult] =
    await Promise.all([
      db.select({ value: count() }).from(priceGuesses).where(eq(priceGuesses.userId, userId)),
      db.select({ value: count() }).from(comments).where(eq(comments.userId, userId)),
      db
        .select({ value: count() })
        .from(reactions)
        .where(and(eq(reactions.userId, userId), eq(reactions.targetType, 'property'), eq(reactions.reactionType, 'like'))),
      db.select({ value: count() }).from(savedProperties).where(eq(savedProperties.userId, userId)),
      // Count how many of the user's comments have been liked by others
      db.execute<{ total: number }>(sql`
        SELECT COUNT(DISTINCT r.id)::int AS total
        FROM reactions r
        INNER JOIN comments c ON c.id = r.target_id
        WHERE r.target_type = 'comment'
          AND r.reaction_type = 'like'
          AND c.user_id = ${userId}
          AND r.user_id != ${userId}
      `),
    ]);

  const guessCount = Number(guessCountResult[0].value);
  const commentCount = Number(commentCountResult[0].value);
  const likeGivenCount = Number(likeGivenResult[0].value);
  const savedCount = Number(savedCountResult[0].value);
  const commentLikesReceived = Number(Array.from(commentLikesResult)[0]?.total ?? 0);

  // Evaluate rules
  const toAward: string[] = [];

  const rules: [string, boolean][] = [
    ['first_guess', guessCount >= 1],
    ['guesser_10', guessCount >= 10],
    ['guesser_50', guessCount >= 50],
    ['first_comment', commentCount >= 1],
    ['commentator_10', commentCount >= 10],
    ['first_like_given', likeGivenCount >= 1],
    ['liked_by_5', commentLikesReceived >= 5],
    ['first_save', savedCount >= 1],
    ['saved_10', savedCount >= 10],
    ['karma_10', karma >= 10],
    ['karma_50', karma >= 50],
    ['karma_100', karma >= 100],
    ['karma_500', karma >= 500],
  ];

  for (const [key, satisfied] of rules) {
    if (satisfied && !alreadyEarned.has(key)) {
      toAward.push(key);
    }
  }

  // Award newly earned achievements
  if (toAward.length > 0) {
    await db.insert(userAchievements).values(
      toAward.map((key) => ({
        userId,
        achievementKey: key,
      }))
    ).onConflictDoNothing();
  }

  return { newlyAwarded: toAward };
}

/**
 * Get all achievements for a user, merging registry metadata with unlock state.
 */
export async function getUserAchievements(userId: string): Promise<{
  earned: Array<AchievementDefinition & { awardedAt: string }>;
  available: AchievementDefinition[];
}> {
  const userRecords = await db
    .select({
      achievementKey: userAchievements.achievementKey,
      awardedAt: userAchievements.awardedAt,
    })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));

  const earnedKeys = new Map(
    userRecords.map((r) => [r.achievementKey, r.awardedAt])
  );

  const earned: Array<AchievementDefinition & { awardedAt: string }> = [];
  const available: AchievementDefinition[] = [];

  for (const def of ACHIEVEMENT_REGISTRY) {
    const awardedAt = earnedKeys.get(def.key);
    if (awardedAt) {
      earned.push({ ...def, awardedAt: awardedAt.toISOString() });
    } else {
      available.push(def);
    }
  }

  return { earned, available };
}

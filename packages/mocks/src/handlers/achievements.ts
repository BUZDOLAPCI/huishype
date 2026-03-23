/**
 * Achievement API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';
import { fixedTimestamp } from '../data/visual-fixtures.js';

// --- Mock achievement data aligned with OpenAPI schema ---

interface AchievementDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: 'social' | 'guessing' | 'exploration' | 'milestone';
}

interface EarnedAchievement extends AchievementDef {
  awardedAt: string;
}

const achievementRegistry: AchievementDef[] = [
  {
    key: 'first_guess',
    name: 'First Guess',
    description: 'Submit your first price guess',
    icon: 'target',
    category: 'guessing',
  },
  {
    key: 'sharp_eye',
    name: 'Sharp Eye',
    description: 'Guess within 5% accuracy on 5 properties',
    icon: 'eye',
    category: 'guessing',
  },
  {
    key: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Leave 10 comments on different properties',
    icon: 'message-circle',
    category: 'social',
  },
  {
    key: 'neighborhood_expert',
    name: 'Neighborhood Expert',
    description: 'Guess on 20 properties in the same city',
    icon: 'map-pin',
    category: 'exploration',
  },
  {
    key: 'century_mark',
    name: 'Century Mark',
    description: 'Submit 100 price guesses',
    icon: 'award',
    category: 'milestone',
  },
  {
    key: 'popular_opinion',
    name: 'Popular Opinion',
    description: 'Receive 50 likes on your comments',
    icon: 'heart',
    category: 'social',
  },
  {
    key: 'early_bird',
    name: 'Early Bird',
    description: 'Be the first to guess on 10 properties',
    icon: 'sunrise',
    category: 'guessing',
  },
  {
    key: 'explorer',
    name: 'Explorer',
    description: 'View properties in 5 different cities',
    icon: 'compass',
    category: 'exploration',
  },
  {
    key: 'karma_collector',
    name: 'Karma Collector',
    description: 'Reach 1000 karma points',
    icon: 'star',
    category: 'milestone',
  },
  {
    key: 'streak_master',
    name: 'Streak Master',
    description: 'Maintain a 7-day activity streak',
    icon: 'zap',
    category: 'milestone',
  },
];

const mockEarned: EarnedAchievement[] = [
  { ...achievementRegistry[0], awardedAt: fixedTimestamp(30, 0) },
  { ...achievementRegistry[1], awardedAt: fixedTimestamp(14, 0) },
  { ...achievementRegistry[7], awardedAt: fixedTimestamp(7, 0) },
];

export const achievementHandlers = [
  /**
   * GET /achievements — list all achievements with user unlock state
   */
  http.get('/achievements', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const earnedKeys = new Set(mockEarned.map((a) => a.key));
    const available = achievementRegistry.filter((a) => !earnedKeys.has(a.key));

    return HttpResponse.json({
      earned: mockEarned,
      available,
      totalAvailable: achievementRegistry.length,
    });
  }),

  /**
   * GET /achievements/registry — list all achievement definitions (public)
   */
  http.get('/achievements/registry', () => {
    return HttpResponse.json({
      achievements: achievementRegistry,
    });
  }),
];

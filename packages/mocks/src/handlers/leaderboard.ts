/**
 * Leaderboard API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';

// --- Mock leaderboard data aligned with OpenAPI schema ---

interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  karma: number;
  karmaRank: { title: string; level: number };
  guessCount: number;
  commentCount: number;
  likeCount: number;
}

const mockRankings: LeaderboardEntry[] = [
  {
    rank: 1,
    userId: 'user-004',
    displayName: 'Sophie Meijer',
    handle: 'sophiemeijer',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    karma: 5200,
    karmaRank: { title: 'Master', level: 5 },
    guessCount: 112,
    commentCount: 45,
    likeCount: 89,
  },
  {
    rank: 2,
    userId: 'user-001',
    displayName: 'Jan de Vries',
    handle: 'jandevries',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    karma: 2500,
    karmaRank: { title: 'Expert', level: 4 },
    guessCount: 45,
    commentCount: 23,
    likeCount: 34,
  },
  {
    rank: 3,
    userId: 'user-006',
    displayName: 'Emma van Dijk',
    handle: 'emmavandijk',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
    karma: 1800,
    karmaRank: { title: 'Expert', level: 4 },
    guessCount: 67,
    commentCount: 31,
    likeCount: 28,
  },
  {
    rank: 4,
    userId: 'user-002',
    displayName: 'Maria Bakker',
    handle: 'mariabakker',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    karma: 850,
    karmaRank: { title: 'Local Legend', level: 3 },
    guessCount: 23,
    commentCount: 15,
    likeCount: 12,
  },
  {
    rank: 5,
    userId: 'user-007',
    displayName: 'Lars Hendriks',
    handle: 'larshendriks',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lars',
    karma: 620,
    karmaRank: { title: 'Local Legend', level: 3 },
    guessCount: 31,
    commentCount: 18,
    likeCount: 22,
  },
  {
    rank: 6,
    userId: 'user-008',
    displayName: 'Anna de Groot',
    handle: 'annadegroot',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=anna',
    karma: 450,
    karmaRank: { title: 'Local Expert', level: 2 },
    guessCount: 19,
    commentCount: 10,
    likeCount: 9,
  },
  {
    rank: 7,
    userId: 'user-003',
    displayName: 'Pieter Jansen',
    handle: 'pieterjansen',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    karma: 125,
    karmaRank: { title: 'Local Expert', level: 2 },
    guessCount: 8,
    commentCount: 5,
    likeCount: 3,
  },
];

const mockFeaturedProperty = {
  id: 'a0000000-0000-4000-a000-000000000001',
  address: 'Prinsengracht 263',
  city: 'Amsterdam',
  postalCode: '1016 GV',
  countryCode: 'NL',
  officialValuation: 2850000,
  commentCount: 15,
  likeCount: 42,
  engagementScore: 57,
};

export const leaderboardHandlers = [
  /**
   * GET /leaderboard — rankings
   */
  http.get('/leaderboard', ({ request }) => {
    const url = new URL(request.url);
    const period = (url.searchParams.get('period') || 'all') as 'week' | 'month' | 'all';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    const rankings = mockRankings.slice(0, limit);

    let currentUserRank: LeaderboardEntry | null = null;
    if (authUser) {
      currentUserRank = rankings.find((r) => r.userId === authUser.id) ?? null;
    }

    return HttpResponse.json({
      rankings,
      currentUserRank,
      featuredProperty: mockFeaturedProperty,
      period,
    });
  }),
];

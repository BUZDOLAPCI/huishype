/**
 * Leaderboard types for HuisHype
 */

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  karma: number;
  karmaRank: {
    title: string;
    level: number;
  };
  guessCount: number;
  commentCount: number;
  likeCount: number;
}

export interface LeaderboardResponse {
  rankings: LeaderboardEntry[];
  currentUserRank: LeaderboardEntry | null;
  featuredProperty: unknown | null;
  period: LeaderboardPeriod;
}

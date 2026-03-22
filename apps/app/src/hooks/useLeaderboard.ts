/**
 * useLeaderboard Hook
 * Fetches leaderboard rankings with period filtering.
 */

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';

// --- Types ---

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardKarmaRank {
  title: string;
  level: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  karma: number;
  karmaRank: LeaderboardKarmaRank;
  guessCount: number;
  commentCount: number;
  likeCount: number;
}

export interface LeaderboardResponse {
  rankings: LeaderboardEntry[];
  currentUserRank: LeaderboardEntry | null;
  featuredProperty: Record<string, unknown> | null;
  period: LeaderboardPeriod;
}

// --- Query Keys ---

export const leaderboardKeys = {
  all: ['leaderboard'] as const,
  list: (period: LeaderboardPeriod) =>
    [...leaderboardKeys.all, { period }] as const,
};

// --- API Function ---

async function fetchLeaderboard(
  period: LeaderboardPeriod,
  limit: number,
  accessToken?: string | null
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({
    period,
    limit: String(limit),
  });

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const resp = await fetch(`${API_URL}/leaderboard?${params.toString()}`, {
    headers,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch leaderboard' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hook ---

/** Fetch leaderboard rankings for a given period. */
export function useLeaderboard(period: LeaderboardPeriod = 'all', limit = 50) {
  const { accessToken } = useAuthContext();

  return useQuery({
    queryKey: leaderboardKeys.list(period),
    queryFn: () => fetchLeaderboard(period, limit, accessToken),
    staleTime: 60 * 1000, // 1 minute
  });
}

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

export interface FeaturedProperty {
  id: string;
  address: string;
  city: string;
  postalCode: string | null;
  countryCode: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  officialValuation: number | null;
  officialValuationYear?: number | null;
  thumbnailUrl: string | null;
  aerialImageUrl?: string | null;
  commentCount: number;
  likeCount: number;
  engagementScore: number;
}

export interface LeaderboardResponse {
  rankings: LeaderboardEntry[];
  currentUserRank: LeaderboardEntry | null;
  featuredProperty: FeaturedProperty | null;
  period: LeaderboardPeriod;
}

// --- Query Keys ---

export const leaderboardKeys = {
  all: ['leaderboard'] as const,
  list: (
    period: LeaderboardPeriod,
    limit: number,
    viewerId: string | null
  ) => [...leaderboardKeys.all, { period, limit, viewerId }] as const,
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
  const { getAccessToken, user } = useAuthContext();

  return useQuery({
    queryKey: leaderboardKeys.list(period, limit, user?.id ?? null),
    queryFn: async () => {
      const token = await getAccessToken();
      return fetchLeaderboard(period, limit, token);
    },
    staleTime: 60 * 1000, // 1 minute
  });
}

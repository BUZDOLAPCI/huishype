/**
 * useAchievements Hook
 * Fetches user achievements from the backend.
 */

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import type { AchievementCategory } from '@huishype/shared';

// --- Types ---

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

export interface PublicAchievementsResponse {
  earned: EarnedAchievement[];
}

// --- Query Keys ---

export const achievementKeys = {
  all: ['achievements'] as const,
  mine: () => [...achievementKeys.all, 'mine'] as const,
  user: (userId: string) => [...achievementKeys.all, 'user', userId] as const,
  registry: () => [...achievementKeys.all, 'registry'] as const,
};

// --- API Functions ---

async function fetchMyAchievements(
  accessToken: string
): Promise<AchievementsResponse> {
  const resp = await fetch(`${API_URL}/achievements`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: 'Failed to fetch achievements' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function fetchPublicAchievements(userId: string): Promise<PublicAchievementsResponse> {
  const resp = await fetch(`${API_URL}/users/${encodeURIComponent(userId)}/achievements`);

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: 'Failed to fetch achievements' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hook ---

/** Fetch achievements with unlock state for the authenticated user. */
export function useAchievements() {
  const { accessToken, isAuthenticated } = useAuthContext();

  return useQuery({
    queryKey: achievementKeys.mine(),
    queryFn: () => fetchMyAchievements(accessToken!),
    enabled: isAuthenticated && !!accessToken,
    staleTime: 60 * 1000, // 1 minute
  });
}

/** Fetch earned public achievements for a user profile. */
export function usePublicAchievements(userId: string | null | undefined) {
  return useQuery({
    queryKey: achievementKeys.user(userId ?? ''),
    queryFn: () => fetchPublicAchievements(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

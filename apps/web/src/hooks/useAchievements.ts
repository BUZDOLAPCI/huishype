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

// --- Query Keys ---

export const achievementKeys = {
  all: ['achievements'] as const,
  mine: () => [...achievementKeys.all, 'mine'] as const,
  registry: () => [...achievementKeys.all, 'registry'] as const,
};

// --- API Functions ---

async function fetchMyAchievements(
): Promise<AchievementsResponse> {
  const resp = await fetch(`${API_URL}/achievements`, {
    credentials: 'include',
  });

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
  const { isAuthenticated } = useAuthContext();

  return useQuery({
    queryKey: achievementKeys.mine(),
    queryFn: () => fetchMyAchievements(),
    enabled: isAuthenticated,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * User-related types for HuisHype
 */

/**
 * Karma rank titles based on credibility score
 */
export type KarmaRank =
  | 'Newbie'
  | 'Regular'
  | 'Trusted'
  | 'Expert'
  | 'Master'
  | 'Legend';

/**
 * Core user information
 */
export interface User {
  id: string;
  /** Unique username handle (cannot be changed) */
  username: string;
  /** Display name (can be changed once per 30 days) */
  displayName: string;
  /** Profile photo URL (optional) */
  profilePhotoUrl?: string;
  /** Public karma/credibility score (starts at 0, never goes below 0) */
  karma: number;
  /** Karma rank title displayed next to username */
  karmaRank: KarmaRank;
  /** Whether user has HuisHype Plus subscription */
  isPlus: boolean;
  /** When the user joined */
  createdAt: string;
}

/**
 * User profile with additional details
 */
export interface UserProfile extends User {
  /** Total number of price guesses submitted */
  totalGuesses: number;
  /** Number of guesses that have been resolved (property sold) */
  resolvedGuesses: number;
  /** Average accuracy percentage of resolved guesses (0-100) */
  averageAccuracy?: number;
  /** Primary areas of activity (cities/neighborhoods) */
  activeAreas: string[];
  /** Earned badges/achievements */
  badges: UserBadge[];
  /** Date when display name can next be changed */
  displayNameChangeAvailableAt?: string;
}

/**
 * User badge/achievement
 */
export interface UserBadge {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  earnedAt: string;
}

/**
 * User session information returned after authentication
 */
export interface UserSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Minimal user info for display in lists, comments, etc.
 */
export type UserSummary = Pick<
  User,
  'id' | 'username' | 'displayName' | 'profilePhotoUrl' | 'karma' | 'karmaRank'
>;

/**
 * Internal karma metrics (not exposed to users)
 * Used for moderation and influence calculations
 */
export interface InternalKarmaMetrics {
  userId: string;
  /** Can go negative internally for banning consideration */
  internalScore: number;
  /** Number of meme/wildly inaccurate guesses */
  outlierGuessCount: number;
  /** Weight applied to this user's guesses in FMV calculation */
  fmvInfluenceWeight: number;
}

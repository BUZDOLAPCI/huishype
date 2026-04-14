/**
 * User-related types for HuisHype
 */

/**
 * Karma rank titles based on credibility score.
 * 7 tiers per the visual design spec (Section 1.10).
 * Must match KARMA_TIERS in utils/karma-tiers.ts.
 */
export type KarmaRank =
  | 'Newcomer'
  | 'Contributor'
  | 'Rising Star'
  | 'Local Expert'
  | 'Expert'
  | 'Local Legend'
  | 'Master';

/**
 * Core user information
 */
export interface User {
  id: string;
  /** Unique username handle (cannot be changed) */
  username: string;
  /** Display name (can be changed once per 30 days) */
  displayName: string;
  /** Profile photo URL, or null when unset */
  profilePhotoUrl: string | null;
  /** Public karma/credibility score (starts at 0, never goes below 0) */
  karma: number;
  /** Karma rank title displayed next to username */
  karmaRank: KarmaRank;
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
 * Browser session information returned after authentication.
 * The active web contract is cookie-backed, so browser sessions do not expose
 * bearer tokens to JavaScript.
 */
export interface UserSession {
  user: User;
  expiresAt: string;
}

/**
 * Explicit token session for non-browser clients that still need bearer tokens.
 */
export interface TokenUserSession extends UserSession {
  accessToken: string;
  refreshToken: string;
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

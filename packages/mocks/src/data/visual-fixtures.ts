/**
 * Deterministic visual fixtures for screenshot-based testing.
 *
 * All timestamps, IDs, and ordering are fixed so visual tests produce
 * identical results across runs. Import these instead of the base fixtures
 * when deterministic output matters (Playwright screenshots, visual regression).
 *
 * Key guarantees:
 * - Fixed ISO timestamps (no Date.now())
 * - Stable sort order (explicit ordering fields where needed)
 * - Stable image URLs (use placeholder service with fixed seeds)
 * - Deterministic user/property/comment IDs
 */

import { mockPropertyIds, mockUserIds } from './fixtures.js';

// ============================================
// Fixed timestamps
// ============================================

/** Epoch used as "now" for all visual fixtures: 2025-01-15T12:00:00Z */
export const VISUAL_FIXTURE_NOW = '2025-01-15T12:00:00.000Z';

/** Helper to create a fixed timestamp relative to VISUAL_FIXTURE_NOW */
export function fixedTimestamp(daysAgo: number, hoursAgo: number = 0): string {
  const base = new Date(VISUAL_FIXTURE_NOW);
  base.setDate(base.getDate() - daysAgo);
  base.setHours(base.getHours() - hoursAgo);
  return base.toISOString();
}

// ============================================
// Notification fixtures
// ============================================

export interface MockNotification {
  id: string;
  type: 'comment_reply' | 'guess_result' | 'property_update' | 'like' | 'achievement';
  title: string;
  body: string;
  imageUrl?: string;
  propertyId?: string;
  userId?: string;
  read: boolean;
  createdAt: string;
}

export const mockNotifications: MockNotification[] = [
  {
    id: 'notif-001',
    type: 'comment_reply',
    title: 'Maria Bakker replied to your comment',
    body: 'Eens! Maar de historische waarde van dit pand is wel uniek.',
    imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    propertyId: mockPropertyIds.prinsengracht263,
    userId: mockUserIds.maria,
    read: false,
    createdAt: fixedTimestamp(0, 2),
  },
  {
    id: 'notif-002',
    type: 'like',
    title: 'Sophie Meijer liked your guess',
    body: 'Your price guess on Prinsengracht 263 received a like',
    imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    propertyId: mockPropertyIds.prinsengracht263,
    userId: mockUserIds.sophie,
    read: false,
    createdAt: fixedTimestamp(0, 5),
  },
  {
    id: 'notif-003',
    type: 'property_update',
    title: 'Price changed on Herengracht 502',
    body: 'The asking price was reduced from \u20AC2,200,000 to \u20AC2,100,000',
    propertyId: mockPropertyIds.herengracht502,
    read: true,
    createdAt: fixedTimestamp(1, 3),
  },
  {
    id: 'notif-004',
    type: 'guess_result',
    title: 'Your guess was close!',
    body: 'Coolsingel 40 sold for \u20AC460,000 \u2014 your guess was within 3%',
    propertyId: mockPropertyIds.coolsingel40,
    read: true,
    createdAt: fixedTimestamp(2, 0),
  },
  {
    id: 'notif-005',
    type: 'achievement',
    title: 'Achievement unlocked: Sharp Eye',
    body: 'You guessed within 5% accuracy on 5 properties',
    read: true,
    createdAt: fixedTimestamp(3, 6),
  },
  {
    id: 'notif-006',
    type: 'comment_reply',
    title: 'Pieter Jansen replied to your comment',
    body: 'Zou het pand ook voor verhuur geschikt zijn?',
    imageUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    propertyId: mockPropertyIds.prinsengracht263,
    userId: mockUserIds.pieter,
    read: true,
    createdAt: fixedTimestamp(4, 1),
  },
];

// ============================================
// Leaderboard fixtures
// ============================================

export interface MockLeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  profilePhotoUrl?: string;
  karma: number;
  karmaRank: string;
  totalGuesses: number;
  averageAccuracy?: number;
  isCurrentUser: boolean;
}

export const mockLeaderboard: MockLeaderboardEntry[] = [
  {
    rank: 1,
    userId: mockUserIds.sophie,
    displayName: 'Sophie Meijer',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    karma: 5200,
    karmaRank: 'Master',
    totalGuesses: 112,
    averageAccuracy: 91.2,
    isCurrentUser: false,
  },
  {
    rank: 2,
    userId: mockUserIds.jan,
    displayName: 'Jan de Vries',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    karma: 2500,
    karmaRank: 'Expert',
    totalGuesses: 45,
    averageAccuracy: 87.5,
    isCurrentUser: true,
  },
  {
    rank: 3,
    userId: mockUserIds.emma,
    displayName: 'Emma van Dijk',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
    karma: 1800,
    karmaRank: 'Expert',
    totalGuesses: 67,
    averageAccuracy: 84.1,
    isCurrentUser: false,
  },
  {
    rank: 4,
    userId: mockUserIds.maria,
    displayName: 'Maria Bakker',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    karma: 850,
    karmaRank: 'Local Legend',
    totalGuesses: 23,
    averageAccuracy: 72.3,
    isCurrentUser: false,
  },
  {
    rank: 5,
    userId: mockUserIds.lars,
    displayName: 'Lars Hendriks',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lars',
    karma: 620,
    karmaRank: 'Local Legend',
    totalGuesses: 31,
    averageAccuracy: 68.9,
    isCurrentUser: false,
  },
  {
    rank: 6,
    userId: mockUserIds.anna,
    displayName: 'Anna de Groot',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=anna',
    karma: 450,
    karmaRank: 'Expert',
    totalGuesses: 19,
    averageAccuracy: 65.4,
    isCurrentUser: false,
  },
  {
    rank: 7,
    userId: mockUserIds.pieter,
    displayName: 'Pieter Jansen',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    karma: 125,
    karmaRank: 'Expert',
    totalGuesses: 8,
    averageAccuracy: 65.0,
    isCurrentUser: false,
  },
];

// ============================================
// Profile activity fixtures
// ============================================

export interface MockActivityItem {
  id: string;
  type: 'guess' | 'comment' | 'like' | 'save';
  description: string;
  propertyAddress: string;
  propertyId: string;
  createdAt: string;
}

export const mockProfileActivity: MockActivityItem[] = [
  {
    id: 'activity-001',
    type: 'guess',
    description: 'Guessed \u20AC2,850,000 on Prinsengracht 263',
    propertyAddress: 'Prinsengracht 263, Amsterdam',
    propertyId: mockPropertyIds.prinsengracht263,
    createdAt: fixedTimestamp(0, 3),
  },
  {
    id: 'activity-002',
    type: 'comment',
    description: 'Commented on Herengracht 502',
    propertyAddress: 'Herengracht 502, Amsterdam',
    propertyId: mockPropertyIds.herengracht502,
    createdAt: fixedTimestamp(1, 1),
  },
  {
    id: 'activity-003',
    type: 'like',
    description: 'Liked Coolsingel 40',
    propertyAddress: 'Coolsingel 40, Rotterdam',
    propertyId: mockPropertyIds.coolsingel40,
    createdAt: fixedTimestamp(2, 5),
  },
  {
    id: 'activity-004',
    type: 'save',
    description: 'Saved Lange Voorhout 102',
    propertyAddress: 'Lange Voorhout 102, Den Haag',
    propertyId: mockPropertyIds.langeVoorhout102,
    createdAt: fixedTimestamp(3, 2),
  },
  {
    id: 'activity-005',
    type: 'guess',
    description: 'Guessed \u20AC1,800,000 on Herengracht 502',
    propertyAddress: 'Herengracht 502, Amsterdam',
    propertyId: mockPropertyIds.herengracht502,
    createdAt: fixedTimestamp(5, 0),
  },
];

// ============================================
// Stable image placeholders
// ============================================

/**
 * Placeholder image URLs using fixed seeds for deterministic rendering.
 * These don't depend on external services being available.
 */
export const PLACEHOLDER_IMAGES = {
  /** Property photo placeholder (warm orange/brown tone) */
  property: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23E8D5B7" width="400" height="300"/%3E%3Ctext x="200" y="150" text-anchor="middle" fill="%23A0845C" font-size="18"%3EProperty Photo%3C/text%3E%3C/svg%3E',
  /** Avatar placeholder */
  avatar: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="10%25" y1="8%25" x2="92%25" y2="100%25"%3E%3Cstop offset="0%25" stop-color="%23F8E5EC"/%3E%3Cstop offset="100%25" stop-color="%23FFF8F8"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="48" height="48" fill="url(%23g)"/%3E%3Ccircle cx="34" cy="11" r="10" fill="%23F0CDD8" fill-opacity=".82"/%3E%3Cpath d="M0 34 C 10 30 18 29 25 32 C 33 36 39 35 48 28 L 48 48 L 0 48 Z" fill="%23E1BAC9" fill-opacity=".84"/%3E%3Cellipse cx="24" cy="27" rx="10" ry="8" fill="%23FFFFFF" fill-opacity=".18"/%3E%3Ctext x="24" y="27" text-anchor="middle" dominant-baseline="middle" fill="%23715B68" font-size="15" font-weight="700"%3EAH%3C/text%3E%3C/svg%3E',
  /** Map thumbnail placeholder */
  mapThumbnail: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23D1FAE5" width="200" height="200"/%3E%3Ctext x="100" y="100" text-anchor="middle" fill="%23065F46" font-size="14"%3EMap%3C/text%3E%3C/svg%3E',
} as const;

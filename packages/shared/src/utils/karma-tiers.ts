/**
 * Unified karma tier definitions.
 *
 * Single source of truth for both frontend badge rendering and backend
 * rank calculation. 7 tiers per the visual design spec (Section 1.10).
 *
 * Import from `@huishype/shared`:
 *   import { KARMA_TIERS, getKarmaTier, type KarmaTier } from '@huishype/shared';
 */

export interface KarmaTier {
  /** Tier level (1-7, ascending). */
  level: number;
  /** English display label. */
  label: string;
  /** Minimum karma required (inclusive). */
  minKarma: number;
  /** Badge background colour (light surface). */
  bgColor: string;
  /** Badge text colour. */
  textColor: string;
}

/**
 * All 7 karma tiers ordered highest-first for efficient lookup.
 *
 * | Tier          | Level | Min Karma | Bg              | Text             |
 * |---------------|-------|-----------|-----------------|------------------|
 * | Master        | 7     | 1000      | hot-red-100     | hot-red-700      |
 * | Local Legend   | 6     | 500       | error-red-100   | error-red-700    |
 * | Expert        | 5     | 200       | gold-100        | gold-700         |
 * | Local Expert  | 4     | 100       | purple-100      | purple-700       |
 * | Rising Star   | 3     | 50        | info-blue-100   | info-blue-700    |
 * | Contributor   | 2     | 10        | crowd-green-100 | crowd-green-700  |
 * | Newcomer      | 1     | 0         | warm-200        | warm-500         |
 */
export const KARMA_TIERS: readonly KarmaTier[] = [
  { level: 7, label: 'Master',       minKarma: 1000, bgColor: '#FFE0D6', textColor: '#C43E00' },
  { level: 6, label: 'Local Legend',  minKarma: 500,  bgColor: '#FFCDD2', textColor: '#C62828' },
  { level: 5, label: 'Expert',       minKarma: 200,  bgColor: '#FFF3C4', textColor: '#B47712' },
  { level: 4, label: 'Local Expert', minKarma: 100,  bgColor: '#EDE9FE', textColor: '#7C3AED' },
  { level: 3, label: 'Rising Star',  minKarma: 50,   bgColor: '#BBDEFB', textColor: '#1565C0' },
  { level: 2, label: 'Contributor',  minKarma: 10,   bgColor: '#D1FAE5', textColor: '#15803D' },
  { level: 1, label: 'Newcomer',     minKarma: 0,    bgColor: '#F5F0E8', textColor: '#9C958A' },
] as const;

/**
 * Look up the karma tier for a given karma score.
 * Public karma is clamped to >= 0.
 */
export function getKarmaTier(karma: number): KarmaTier {
  const publicKarma = Math.max(0, karma);
  for (const tier of KARMA_TIERS) {
    if (publicKarma >= tier.minKarma) {
      return tier;
    }
  }
  // Fallback — should never reach here since last tier has minKarma 0
  return KARMA_TIERS[KARMA_TIERS.length - 1];
}

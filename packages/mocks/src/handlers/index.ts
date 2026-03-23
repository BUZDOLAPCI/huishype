/**
 * MSW Handler exports
 *
 * All handlers use paths matching the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for the canonical path list.
 */

import { authHandlers } from './auth.js';
import { propertyHandlers } from './properties.js';
import { guessHandlers } from './guesses.js';
import { commentHandlers } from './comments.js';
import { geocodeHandlers } from './geocode.js';
import { feedHandlers } from './feed.js';
import { userHandlers } from './users.js';
import { listingHandlers } from './listings.js';
import { notificationHandlers } from './notifications.js';
import { leaderboardHandlers } from './leaderboard.js';
import { activityHandlers } from './activity.js';
import { achievementHandlers } from './achievements.js';
import { emailAuthHandlers } from './email-auth.js';

/**
 * All API mock handlers combined.
 *
 * Handler order matters: more specific paths must come before parameterized ones.
 * The property handlers are ordered so /properties/resolve, /properties/nearby,
 * /properties/batch come before /properties/:id.
 */
export const handlers = [
  ...authHandlers,
  ...emailAuthHandlers,
  ...userHandlers,
  ...feedHandlers,
  ...listingHandlers,
  ...propertyHandlers,
  ...guessHandlers,
  ...commentHandlers,
  ...geocodeHandlers,
  ...notificationHandlers,
  ...leaderboardHandlers,
  ...activityHandlers,
  ...achievementHandlers,
];

// Export individual handler groups for selective use
export { authHandlers } from './auth.js';
export { propertyHandlers } from './properties.js';
export { guessHandlers } from './guesses.js';
export { commentHandlers } from './comments.js';
export { geocodeHandlers, mockGeocodeSuggestions, addMockGeocodeSuggestion, clearMockGeocodeSuggestions } from './geocode.js';
export { feedHandlers } from './feed.js';
export { userHandlers } from './users.js';
export { listingHandlers } from './listings.js';
export { notificationHandlers } from './notifications.js';
export { leaderboardHandlers } from './leaderboard.js';
export { activityHandlers } from './activity.js';
export { achievementHandlers } from './achievements.js';
export { emailAuthHandlers } from './email-auth.js';

// Export auth helpers
export { validateMockToken, getMockAuthUser, resetMockSessions } from './auth.js';

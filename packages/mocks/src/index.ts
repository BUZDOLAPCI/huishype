/**
 * @huishype/mocks
 *
 * MSW (Mock Service Worker) handlers for HuisHype API.
 * Used for frontend development and testing.
 *
 * All handler paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for the canonical path list.
 */

// Export all handlers
export { handlers } from './handlers/index.js';

// Export individual handler groups
export {
  authHandlers,
  propertyHandlers,
  guessHandlers,
  commentHandlers,
  geocodeHandlers,
  feedHandlers,
  userHandlers,
  listingHandlers,
  notificationHandlers,
  leaderboardHandlers,
  activityHandlers,
  achievementHandlers,
  emailAuthHandlers,
} from './handlers/index.js';

// Export auth helpers
export { validateMockToken, getMockAuthUser, resetMockSessions } from './handlers/index.js';

// Export fixtures for direct use in tests
export {
  mockUsers,
  mockUserProfiles,
  mockProperties,
  mockPropertyDetails,
  mockPropertySummaries,
  mockListings,
  mockListingSummaries,
  mockGuesses,
  mockFMV,
  mockComments,
  mockMapProperties,
  mockPropertyClusters,
  getMockUser,
  getMockProperty,
  getMockComments,
  getMockGuesses,
} from './data/fixtures.js';

// Export visual fixtures for deterministic screenshot testing
export {
  VISUAL_FIXTURE_NOW,
  fixedTimestamp,
  mockNotifications,
  mockLeaderboard,
  mockProfileActivity,
  PLACEHOLDER_IMAGES,
} from './data/visual-fixtures.js';
export type {
  MockNotification,
  MockLeaderboardEntry,
  MockActivityItem,
} from './data/visual-fixtures.js';

// Package metadata
export const PACKAGE_NAME = '@huishype/mocks';
export const PACKAGE_VERSION = '0.0.1';

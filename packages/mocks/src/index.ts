/**
 * @huishype/mocks
 *
 * MSW (Mock Service Worker) handlers for HuisHype API
 * Used for frontend development and testing
 */

// Export all handlers
export { handlers } from './handlers';

// Export individual handler groups
export {
  authHandlers,
  propertyHandlers,
  guessHandlers,
  commentHandlers,
} from './handlers';

// Export auth helpers
export { validateMockToken, getMockAuthUser } from './handlers';

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
} from './data/fixtures';

// Package metadata
export const PACKAGE_NAME = '@huishype/mocks';
export const PACKAGE_VERSION = '0.0.1';

/**
 * MSW Handler exports
 */

import { authHandlers } from './auth';
import { propertyHandlers } from './properties';
import { guessHandlers } from './guesses';
import { commentHandlers } from './comments';
import { geocodeHandlers } from './geocode';

/**
 * All API mock handlers combined
 */
export const handlers = [
  ...authHandlers,
  ...propertyHandlers,
  ...guessHandlers,
  ...commentHandlers,
  ...geocodeHandlers,
];

// Export individual handler groups for selective use
export { authHandlers } from './auth';
export { propertyHandlers } from './properties';
export { guessHandlers } from './guesses';
export { commentHandlers } from './comments';
export { geocodeHandlers, mockGeocodeSuggestions, addMockGeocodeSuggestion, clearMockGeocodeSuggestions } from './geocode';

// Export auth helpers
export { validateMockToken, getMockAuthUser } from './auth';

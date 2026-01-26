/**
 * MSW Handler exports
 */

import { authHandlers } from './auth';
import { propertyHandlers } from './properties';
import { guessHandlers } from './guesses';
import { commentHandlers } from './comments';

/**
 * All API mock handlers combined
 */
export const handlers = [
  ...authHandlers,
  ...propertyHandlers,
  ...guessHandlers,
  ...commentHandlers,
];

// Export individual handler groups for selective use
export { authHandlers } from './auth';
export { propertyHandlers } from './properties';
export { guessHandlers } from './guesses';
export { commentHandlers } from './comments';

// Export auth helpers
export { validateMockToken, getMockAuthUser } from './auth';

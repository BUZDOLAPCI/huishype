/**
 * MSW Handler exports
 */

import { authHandlers } from './auth';
import { propertyHandlers } from './properties';
import { guessHandlers } from './guesses';
import { commentHandlers } from './comments';
import { pdokHandlers } from './pdok';

/**
 * All API mock handlers combined
 */
export const handlers = [
  ...authHandlers,
  ...propertyHandlers,
  ...guessHandlers,
  ...commentHandlers,
  ...pdokHandlers,
];

// Export individual handler groups for selective use
export { authHandlers } from './auth';
export { propertyHandlers } from './properties';
export { guessHandlers } from './guesses';
export { commentHandlers } from './comments';
export { pdokHandlers, mockPDOKAddresses, addMockPDOKAddress, clearMockPDOKAddresses } from './pdok';

// Export auth helpers
export { validateMockToken, getMockAuthUser } from './auth';

/**
 * MSW Server setup for Node.js testing (Jest, Vitest, etc.)
 *
 * Usage in tests:
 * ```
 * import { server } from '@huishype/mocks/server';
 *
 * beforeAll(() => server.listen());
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW server instance for Node.js
 */
export const server = setupServer(...handlers);

/**
 * Start the mock server for testing
 */
export function startServer(options?: {
  /** Callback for unhandled requests */
  onUnhandledRequest?: 'bypass' | 'warn' | 'error';
}) {
  const { onUnhandledRequest = 'warn' } = options || {};

  server.listen({
    onUnhandledRequest,
  });
}

/**
 * Stop the mock server
 */
export function stopServer() {
  server.close();
}

/**
 * Reset handlers to initial state
 */
export function resetHandlers() {
  server.resetHandlers();
}

/**
 * Add runtime handlers for specific test scenarios
 */
export function addHandlers(...newHandlers: Parameters<typeof server.use>) {
  server.use(...newHandlers);
}

/**
 * Common test setup helper
 * Use in your test setup file:
 *
 * ```
 * import { server } from '@huishype/mocks/server';
 *
 * beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 *
 * Or use with setupTests if you have globals defined:
 * ```
 * import { setupTests, server } from '@huishype/mocks/server';
 * setupTests(beforeAll, afterEach, afterAll);
 * ```
 */
export function setupTests(
  beforeAllFn: (fn: () => void) => void,
  afterEachFn: (fn: () => void) => void,
  afterAllFn: (fn: () => void) => void
) {
  beforeAllFn(() => server.listen({ onUnhandledRequest: 'warn' }));
  afterEachFn(() => server.resetHandlers());
  afterAllFn(() => server.close());
}

/**
 * MSW Browser setup for development and browser-based testing
 *
 * Usage in app:
 * ```
 * import { setupMockServer } from '@huishype/mocks/browser';
 *
 * if (process.env.NODE_ENV === 'development') {
 *   setupMockServer();
 * }
 * ```
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * MSW worker instance for browser
 */
export const worker = setupWorker(...handlers);

/**
 * Setup and start the mock server in browser
 */
export async function setupMockServer(options?: {
  /** Don't show console warnings for unhandled requests */
  quiet?: boolean;
  /** URL patterns to bypass (not mock) */
  bypassUrls?: string[];
}) {
  const { quiet = false, bypassUrls = [] } = options || {};

  return worker.start({
    onUnhandledRequest(request, print) {
      // Don't warn about bypassed URLs
      const url = new URL(request.url);
      if (bypassUrls.some((pattern) => url.pathname.startsWith(pattern))) {
        return;
      }

      // Don't warn about static assets
      if (
        url.pathname.match(
          /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/
        )
      ) {
        return;
      }

      if (!quiet) {
        print.warning();
      }
    },
    // Service worker options
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
  });
}

/**
 * Stop the mock server
 */
export function stopMockServer() {
  worker.stop();
}

/**
 * Reset handlers to initial state (useful between tests)
 */
export function resetHandlers() {
  worker.resetHandlers();
}

/**
 * Add runtime handlers (useful for testing specific scenarios)
 */
export function addHandlers(...newHandlers: Parameters<typeof worker.use>) {
  worker.use(...newHandlers);
}

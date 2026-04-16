import { expect, type Page } from '@playwright/test';

export type ConsoleAllowPattern = RegExp | string;

export const BASE_ALLOWED_CONSOLE_PATTERNS: ConsoleAllowPattern[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /net::ERR_ABORTED/,
];

export const MAP_ALLOWED_CONSOLE_PATTERNS: ConsoleAllowPattern[] = [
  ...BASE_ALLOWED_CONSOLE_PATTERNS,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
  /Failed to load resource.*\.pbf/,
  /font/i,
];

export const NETWORK_ALLOWED_CONSOLE_PATTERNS: ConsoleAllowPattern[] = [
  ...MAP_ALLOWED_CONSOLE_PATTERNS,
  /net::ERR_NAME_NOT_RESOLVED/,
  /net::ERR_CONNECTION_REFUSED/,
  /Failed to load resource/,
  /the server responded with a status of 404 \(Not Found\)/,
  /the server responded with a status of 500 \(Internal Server Error\)/,
  /Page Error: A network error occurred\./,
  /MapLibre error: AJAXError: Failed to fetch/,
];

export function isAllowedConsoleMessage(
  message: string,
  patterns: ConsoleAllowPattern[] = BASE_ALLOWED_CONSOLE_PATTERNS,
): boolean {
  const lowerMessage = message.toLowerCase();
  return patterns.some((pattern) =>
    typeof pattern === 'string'
      ? lowerMessage.includes(pattern.toLowerCase())
      : pattern.test(message),
  );
}

export function expectNoConsoleErrors(
  consoleErrors: string[],
  context = 'console errors',
): void {
  expect(
    consoleErrors,
    `Expected zero ${context} but found ${consoleErrors.length}`,
  ).toHaveLength(0);
}

export function attachConsoleErrorCollector(
  page: Page,
  patterns: ConsoleAllowPattern[] = BASE_ALLOWED_CONSOLE_PATTERNS,
): string[] {
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return;
    }

    const text = msg.text();
    if (!isAllowedConsoleMessage(text, patterns)) {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    const text = `Page Error: ${error.message}`;
    if (!isAllowedConsoleMessage(text, patterns)) {
      consoleErrors.push(text);
    }
  });

  return consoleErrors;
}

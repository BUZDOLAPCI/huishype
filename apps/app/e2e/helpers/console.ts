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
  /MapLibre error: AJAXError: Failed to fetch/,
];

// Keep shared network exceptions tight. Localhost / runtime connectivity
// failures must stay fatal unless an individual spec explicitly scopes them.
export const NETWORK_ALLOWED_CONSOLE_PATTERNS: ConsoleAllowPattern[] = [
  ...MAP_ALLOWED_CONSOLE_PATTERNS,
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

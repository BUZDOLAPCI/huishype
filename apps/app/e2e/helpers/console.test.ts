import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page } from '@playwright/test';
import {
  attachConsoleErrorCollector,
  BASE_ALLOWED_CONSOLE_PATTERNS,
  MAP_ALLOWED_CONSOLE_PATTERNS,
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
  isAllowedConsoleMessage,
} from './console';

function createConsoleMessage(type: string, text: string) {
  return {
    type: () => type,
    text: () => text,
  };
}

test('isAllowedConsoleMessage keeps the base allowlist narrow', () => {
  assert.equal(
    isAllowedConsoleMessage(
      'ResizeObserver loop completed with undelivered notifications.',
    ),
    true,
  );
  assert.equal(
    isAllowedConsoleMessage('MapLibre error: AJAXError: Failed to fetch'),
    false,
  );
  assert.equal(
    isAllowedConsoleMessage('Failed to load resource: the server responded with a status of 404 (Not Found)'),
    false,
  );
  assert.equal(
    isAllowedConsoleMessage('pointerEvents is deprecated'),
    false,
  );
});

test('map and network allowlists stay narrow and explicit', () => {
  assert.equal(
    isAllowedConsoleMessage('MapLibre error: AJAXError: Failed to fetch', MAP_ALLOWED_CONSOLE_PATTERNS),
    true,
  );
  assert.equal(
    isAllowedConsoleMessage('Failed to load resource: the server responded with a status of 404 (Not Found)', MAP_ALLOWED_CONSOLE_PATTERNS),
    false,
  );
  assert.equal(
    isAllowedConsoleMessage('net::ERR_CONNECTION_REFUSED', NETWORK_ALLOWED_CONSOLE_PATTERNS),
    false,
  );
  assert.equal(
    isAllowedConsoleMessage('net::ERR_NAME_NOT_RESOLVED', NETWORK_ALLOWED_CONSOLE_PATTERNS),
    false,
  );
  assert.equal(
    isAllowedConsoleMessage('Failed to load resource: the server responded with a status of 404 (Not Found)', NETWORK_ALLOWED_CONSOLE_PATTERNS),
    false,
  );
  assert.equal(BASE_ALLOWED_CONSOLE_PATTERNS.length, 4);
  assert.equal(NETWORK_ALLOWED_CONSOLE_PATTERNS.length, MAP_ALLOWED_CONSOLE_PATTERNS.length);
});

test('attachConsoleErrorCollector records only unallowed console errors by default', () => {
  const page = new EventEmitter();
  const consoleErrors = attachConsoleErrorCollector(page as unknown as Page);

  page.emit('console', createConsoleMessage('error', 'MapLibre error: AJAXError: Failed to fetch'));
  page.emit(
    'console',
    createConsoleMessage(
      'error',
      'Failed to load resource: the server responded with a status of 404 (Not Found)',
    ),
  );
  page.emit('console', createConsoleMessage('info', 'informational message'));
  page.emit('pageerror', new Error('boom'));

  assert.deepEqual(consoleErrors, [
    'MapLibre error: AJAXError: Failed to fetch',
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'Page Error: boom',
  ]);
});

test('attachConsoleErrorCollector keeps runtime connectivity failures fatal in the shared network allowlist', () => {
  const page = new EventEmitter();
  const consoleErrors = attachConsoleErrorCollector(
    page as unknown as Page,
    NETWORK_ALLOWED_CONSOLE_PATTERNS,
  );

  page.emit('console', createConsoleMessage('error', 'net::ERR_CONNECTION_REFUSED'));
  page.emit(
    'console',
    createConsoleMessage(
      'error',
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    ),
  );

  assert.deepEqual(consoleErrors, [
    'net::ERR_CONNECTION_REFUSED',
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  ]);
});

test('attachConsoleErrorCollector can use a suite-specific connectivity exception when explicitly scoped', () => {
  const page = new EventEmitter();
  const consoleErrors = attachConsoleErrorCollector(
    page as unknown as Page,
    [...NETWORK_ALLOWED_CONSOLE_PATTERNS, /net::ERR_NAME_NOT_RESOLVED/],
  );

  page.emit('console', createConsoleMessage('error', 'net::ERR_NAME_NOT_RESOLVED'));
  page.emit(
    'console',
    createConsoleMessage(
      'error',
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    ),
  );

  assert.deepEqual(consoleErrors, [
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  ]);
});

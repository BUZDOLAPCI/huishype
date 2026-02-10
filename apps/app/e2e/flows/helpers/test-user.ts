/**
 * Shared test helper for creating test users via the mock Google auth endpoint.
 * Used by flow E2E tests that require authenticated API calls.
 */

import { expect, type APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

export async function createTestUser(request: APIRequestContext, suffix: string = 'test') {
  const unique = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`${API_BASE_URL}/auth/google`, {
    data: { idToken: `mock-google-e2e${suffix}${unique}-gid${unique}` },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return {
    userId: body.session.user.id as string,
    accessToken: body.session.accessToken as string,
    username: body.session.user.username as string,
  };
}

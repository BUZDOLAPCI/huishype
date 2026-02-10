/**
 * Shared test helper for creating test users via the mock Google auth endpoint.
 * Used by flow E2E tests that require authenticated API calls.
 */

import { expect, type APIRequestContext } from '@playwright/test';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

export async function createTestUser(request: APIRequestContext, suffix: string = 'test') {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const unique = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const response = await request.post(`${API_BASE_URL}/auth/google`, {
      data: { idToken: `mock-google-e2e${suffix}${unique}-gid${unique}` },
    });

    if (response.ok()) {
      const body = await response.json();
      return {
        userId: body.session.user.id as string,
        accessToken: body.session.accessToken as string,
        username: body.session.user.username as string,
      };
    }

    // Log failure details for debugging
    const status = response.status();
    const errorBody = await response.text().catch(() => 'no body');
    lastError = new Error(
      `createTestUser attempt ${attempt + 1}/${MAX_RETRIES} failed: ${status} ${errorBody}`
    );
    console.warn(lastError.message);

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  throw lastError ?? new Error('createTestUser failed after retries');
}

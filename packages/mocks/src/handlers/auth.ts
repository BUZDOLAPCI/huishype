/**
 * Auth API mock handlers
 */

import { http, HttpResponse } from 'msw';
import { mockUsers, mockUserProfiles } from '../data/fixtures';
import type { AuthLoginResponse, AuthRefreshResponse } from '@huishype/shared';

const API_BASE = '/api/v1';

// Simulated token storage for mock sessions
let mockSessions: Map<string, { userId: string; expiresAt: Date }> = new Map();

export const authHandlers = [
  /**
   * POST /auth/login - Login with OAuth provider
   */
  http.post(`${API_BASE}/auth/login`, async ({ request }) => {
    const body = await request.json() as { provider: string; idToken: string };

    // Simulate validation
    if (!body.provider || !body.idToken) {
      return HttpResponse.json(
        { code: 'INVALID_REQUEST', message: 'Missing provider or idToken' },
        { status: 400 }
      );
    }

    if (!['google', 'apple'].includes(body.provider)) {
      return HttpResponse.json(
        { code: 'INVALID_PROVIDER', message: 'Invalid auth provider' },
        { status: 400 }
      );
    }

    // Simulate token validation - in real world this would verify with Google/Apple
    // For mock, we'll create/return a user based on the idToken
    const isNewUser = body.idToken.includes('new');
    const user = isNewUser ? mockUsers[4] : mockUsers[0]; // newuser or jandevries

    const accessToken = `mock-access-token-${Date.now()}`;
    const refreshToken = `mock-refresh-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    // Store session
    mockSessions.set(accessToken, {
      userId: user.id,
      expiresAt: new Date(expiresAt),
    });

    const response: AuthLoginResponse = {
      session: {
        user,
        accessToken,
        refreshToken,
        expiresAt,
      },
      isNewUser,
    };

    return HttpResponse.json(response);
  }),

  /**
   * POST /auth/refresh - Refresh access token
   */
  http.post(`${API_BASE}/auth/refresh`, async ({ request }) => {
    const body = await request.json() as { refreshToken: string };

    if (!body.refreshToken) {
      return HttpResponse.json(
        { code: 'INVALID_REQUEST', message: 'Missing refresh token' },
        { status: 400 }
      );
    }

    // Simulate refresh token validation
    if (!body.refreshToken.startsWith('mock-refresh-token-')) {
      return HttpResponse.json(
        { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        { status: 401 }
      );
    }

    const newAccessToken = `mock-access-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    // Store new session
    mockSessions.set(newAccessToken, {
      userId: 'user-001',
      expiresAt: new Date(expiresAt),
    });

    const response: AuthRefreshResponse = {
      accessToken: newAccessToken,
      expiresAt,
    };

    return HttpResponse.json(response);
  }),

  /**
   * POST /auth/logout - Logout
   */
  http.post(`${API_BASE}/auth/logout`, async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      mockSessions.delete(token);
    }

    return new HttpResponse(null, { status: 204 });
  }),
];

/**
 * Helper to validate mock auth token and get user ID
 */
export function validateMockToken(
  authHeader: string | null
): { userId: string } | null {
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const session = mockSessions.get(token);

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    mockSessions.delete(token);
    return null;
  }

  return { userId: session.userId };
}

/**
 * Get mock user from auth header
 */
export function getMockAuthUser(authHeader: string | null) {
  const session = validateMockToken(authHeader);
  if (!session) return null;

  return mockUserProfiles.find((u) => u.id === session.userId);
}

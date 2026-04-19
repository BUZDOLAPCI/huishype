/**
 * Auth API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUserIds, mockUsers, mockUserProfiles } from '../data/fixtures.js';
import type { AuthLoginResponse, AuthRefreshResponse } from '@huishype/shared';

// Simulated token storage for mock sessions
let mockSessions: Map<string, { userId: string; expiresAt: Date }> = new Map();

function buildLoginHandler(path: string) {
  return http.post(`*${path}`, async ({ request }) => {
    const body = await request.json() as { idToken: string };

    if (!body.idToken) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Missing idToken' },
        { status: 400 }
      );
    }

    const isNewUser = body.idToken.includes('new');
    const user = isNewUser ? mockUsers[4] : mockUsers[0];

    const accessToken = `mock-access-token-${Date.now()}`;
    const refreshToken = `mock-refresh-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

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
  });
}

export const authHandlers = [
  /**
   * POST /auth/google - Login with Google
   */
  buildLoginHandler('/auth/google'),

  /**
   * POST /auth/apple - Login with Apple
   */
  buildLoginHandler('/auth/apple'),

  /**
   * POST /auth/refresh - Refresh access token
   */
  http.post('*/auth/refresh', async ({ request }) => {
    const body = await request.json() as { refreshToken: string };

    if (!body.refreshToken) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Missing refresh token' },
        { status: 400 }
      );
    }

    if (!body.refreshToken.startsWith('mock-refresh-token-')) {
      return HttpResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        { status: 401 }
      );
    }

    const newAccessToken = `mock-access-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    mockSessions.set(newAccessToken, {
      userId: mockUserIds.jan,
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
  http.post('*/auth/logout', async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      mockSessions.delete(token);
    }

    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /auth/me - Get current auth user
   */
  http.get('*/auth/me', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    return HttpResponse.json({ user: authUser });
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

/**
 * Register a mock session (used by other auth handlers like email-auth)
 */
export function registerMockSession(accessToken: string, userId: string, expiresAt: Date) {
  mockSessions.set(accessToken, { userId, expiresAt });
}

/**
 * Reset mock session state (for test isolation)
 */
export function resetMockSessions() {
  mockSessions = new Map();
}

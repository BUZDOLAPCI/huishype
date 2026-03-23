/**
 * Email auth API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUsers } from '../data/fixtures.js';
import { registerMockSession } from './auth.js';
import type { AuthLoginResponse } from '@huishype/shared';

// In-memory token storage for mock email auth
const pendingTokens = new Map<string, { email: string; createdAt: Date }>();
let tokenCounter = 0;

export const emailAuthHandlers = [
  /**
   * POST /auth/email/request — request a magic link
   */
  http.post('*/auth/email/request', async ({ request }) => {
    const body = await request.json() as { email: string };

    if (!body.email || !body.email.includes('@')) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Generate a deterministic mock token
    tokenCounter++;
    const token = `mock-email-token-${tokenCounter.toString().padStart(4, '0')}`.padEnd(64, '0');

    pendingTokens.set(token, {
      email: body.email.toLowerCase().trim(),
      createdAt: new Date(),
    });

    return HttpResponse.json({
      message: 'If an account with this email exists, a magic link has been sent.',
      // Dev mode: return the token directly
      token,
    });
  }),

  /**
   * POST /auth/email/verify — verify magic link token
   */
  http.post('*/auth/email/verify', async ({ request }) => {
    const body = await request.json() as { token: string };

    if (!body.token || body.token.length !== 64) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Token must be 64 characters' },
        { status: 400 }
      );
    }

    const pending = pendingTokens.get(body.token);

    if (!pending) {
      return HttpResponse.json(
        { error: 'INVALID_TOKEN', message: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Check expiry (15 minutes)
    const elapsed = Date.now() - pending.createdAt.getTime();
    if (elapsed > 15 * 60 * 1000) {
      pendingTokens.delete(body.token);
      return HttpResponse.json(
        { error: 'TOKEN_EXPIRED', message: 'Token has expired. Please request a new one.' },
        { status: 401 }
      );
    }

    // Mark token as used
    pendingTokens.delete(body.token);

    // Find or create user — use first mock user for existing, fifth for new
    const existingUser = mockUsers.find(
      (u) => pending.email.includes(u.username.toLowerCase().slice(0, 5))
    );
    const isNewUser = !existingUser;
    const user = existingUser || mockUsers[4];

    const accessToken = `mock-access-token-email-${Date.now()}`;
    const refreshToken = `mock-refresh-token-email-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    // Register the session so subsequent auth-gated requests succeed
    registerMockSession(accessToken, user.id, new Date(expiresAt));

    const response: {
      session: AuthLoginResponse['session'];
      isNewUser: boolean;
    } = {
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
];

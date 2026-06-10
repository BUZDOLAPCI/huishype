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

const MOCK_EMAIL_CODE = '123456';
const MAX_CODE_ATTEMPTS = 5;

type PendingEmailCredential = {
  email: string;
  token: string;
  code: string;
  createdAt: Date;
  attempts: number;
};

// In-memory credential storage for mock email auth
const pendingTokens = new Map<string, PendingEmailCredential>();
const pendingCredentialsByEmail = new Map<string, PendingEmailCredential>();
let tokenCounter = 0;

function deletePendingCredential(pending: PendingEmailCredential): void {
  pendingTokens.delete(pending.token);
  const emailCredential = pendingCredentialsByEmail.get(pending.email);
  if (emailCredential?.token === pending.token) {
    pendingCredentialsByEmail.delete(pending.email);
  }
}

function createEmailAuthResponse(pending: PendingEmailCredential): AuthLoginResponse {
  // Find or create user — use first mock user for existing, fifth for new
  const existingUser = mockUsers.find(
    (u) => pending.email.includes(u.handle.toLowerCase().slice(0, 5))
  );
  const isNewUser = !existingUser;
  const user = existingUser || mockUsers[4];

  const accessToken = `mock-access-token-email-${Date.now()}`;
  const refreshToken = `mock-refresh-token-email-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 3600000).toISOString();

  // Register the session so subsequent auth-gated requests succeed
  registerMockSession(accessToken, user.id, new Date(expiresAt));

  return {
    session: {
      user,
      accessToken,
      refreshToken,
      expiresAt,
    },
    isNewUser,
  };
}

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
    const email = body.email.toLowerCase().trim();

    const pending: PendingEmailCredential = {
      email,
      token,
      code: MOCK_EMAIL_CODE,
      createdAt: new Date(),
      attempts: 0,
    };

    const previousPending = pendingCredentialsByEmail.get(email);
    if (previousPending) {
      deletePendingCredential(previousPending);
    }

    pendingTokens.set(token, pending);
    pendingCredentialsByEmail.set(email, pending);

    return HttpResponse.json({
      message: 'If an account with this email exists, a magic link has been sent.',
      // Dev mode: return the token and deterministic code directly.
      token,
      code: MOCK_EMAIL_CODE,
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
      deletePendingCredential(pending);
      return HttpResponse.json(
        { error: 'TOKEN_EXPIRED', message: 'Token has expired. Please request a new one.' },
        { status: 401 }
      );
    }

    // Mark credential as used for both token and code verification.
    deletePendingCredential(pending);

    return HttpResponse.json(createEmailAuthResponse(pending));
  }),

  /**
   * POST /auth/email/verify-code — verify email sign-in code
   */
  http.post('*/auth/email/verify-code', async ({ request }) => {
    const body = await request.json() as { email: string; code: string };
    const email = body.email?.toLowerCase().trim();
    const code = body.code?.replace(/\D/g, '');

    if (!email || !email.includes('@') || !code || code.length !== 6) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Email and 6-digit code are required' },
        { status: 400 }
      );
    }

    const pending = pendingCredentialsByEmail.get(email);

    if (!pending) {
      return HttpResponse.json(
        { error: 'INVALID_CODE', message: 'Invalid or expired code' },
        { status: 401 }
      );
    }

    // Check expiry (15 minutes)
    const elapsed = Date.now() - pending.createdAt.getTime();
    if (elapsed > 15 * 60 * 1000) {
      deletePendingCredential(pending);
      return HttpResponse.json(
        { error: 'CODE_EXPIRED', message: 'Code has expired. Please request a new one.' },
        { status: 401 }
      );
    }

    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      return HttpResponse.json(
        {
          error: 'TOO_MANY_CODE_ATTEMPTS',
          message: 'Too many attempts. Request a new sign-in email.',
        },
        { status: 429 }
      );
    }

    if (code !== pending.code) {
      pending.attempts += 1;
      if (pending.attempts >= MAX_CODE_ATTEMPTS) {
        return HttpResponse.json(
          {
            error: 'TOO_MANY_CODE_ATTEMPTS',
            message: 'Too many attempts. Request a new sign-in email.',
          },
          { status: 429 }
        );
      }

      return HttpResponse.json(
        { error: 'INVALID_CODE', message: 'Invalid or expired code' },
        { status: 401 }
      );
    }

    // Mark credential as used for both token and code verification.
    deletePendingCredential(pending);

    return HttpResponse.json(createEmailAuthResponse(pending));
  }),
];

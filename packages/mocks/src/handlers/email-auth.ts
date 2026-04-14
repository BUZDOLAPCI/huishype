/**
 * Email auth API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUsers } from '../data/fixtures.js';
import { issueRegisteredMockSession } from './auth.js';

type BrowserSessionEnvelope = {
  session: {
    user: (typeof mockUsers)[number];
    expiresAt: string;
  };
  isNewUser: boolean;
};

type TokenSessionEnvelope = {
  session: {
    user: (typeof mockUsers)[number];
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
  isNewUser: boolean;
};

const ACCESS_COOKIE_NAME = 'huishype_access';
const REFRESH_COOKIE_NAME = 'huishype_refresh';

const pendingTokens = new Map<string, { email: string; createdAt: Date }>();
let tokenCounter = 0;

function appendSessionCookies(response: Response, accessToken: string, refreshToken: string, expiresAt: Date): Response {
  response.headers.append(
    'Set-Cookie',
    `${ACCESS_COOKIE_NAME}=${accessToken}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax`,
  );
  response.headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${refreshToken}; Path=/; Expires=${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString()}; HttpOnly; SameSite=Lax`,
  );
  return response;
}

function consumePendingToken(token: string) {
  const pending = pendingTokens.get(token);
  if (!pending) {
    return {
      error: 'INVALID_TOKEN' as const,
      message: 'Invalid or expired token',
    };
  }

  const elapsed = Date.now() - pending.createdAt.getTime();
  if (elapsed > 15 * 60 * 1000) {
    pendingTokens.delete(token);
    return {
      error: 'TOKEN_EXPIRED' as const,
      message: 'Token has expired. Please request a new one.',
    };
  }

  pendingTokens.delete(token);

  const existingUser = mockUsers.find(
    (user) => pending.email.includes(user.username.toLowerCase().slice(0, 5)),
  );
  const isNewUser = !existingUser;
  const user = existingUser || mockUsers[4];
  const session = issueRegisteredMockSession(user.id, 'mock-email');

  return { user, isNewUser, session };
}

export const emailAuthHandlers = [
  http.post('*/auth/email/request', async ({ request }) => {
    const body = await request.json() as { email?: string };

    if (!body.email || !body.email.includes('@')) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid email address' },
        { status: 400 },
      );
    }

    tokenCounter += 1;
    const token = `mock-email-token-${tokenCounter.toString().padStart(4, '0')}`.padEnd(64, '0');

    pendingTokens.set(token, {
      email: body.email.toLowerCase().trim(),
      createdAt: new Date(),
    });

    return HttpResponse.json({
      message: 'If an account with this email exists, a magic link has been sent.',
      token,
    });
  }),

  http.post('*/auth/email/verify', async ({ request }) => {
    const body = await request.json() as { token?: string };

    if (!body.token || body.token.length !== 64) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Token must be 64 characters' },
        { status: 400 },
      );
    }

    const result = consumePendingToken(body.token);
    if ('error' in result) {
      return HttpResponse.json(result, { status: 401 });
    }

    const response: BrowserSessionEnvelope = {
      session: {
        user: result.user,
        expiresAt: result.session.accessExpiresAt.toISOString(),
      },
      isNewUser: result.isNewUser,
    };

    return appendSessionCookies(
      HttpResponse.json(response),
      result.session.accessToken,
      result.session.refreshToken,
      result.session.accessExpiresAt,
    );
  }),

  http.post('*/auth/token/email/verify', async ({ request }) => {
    const body = await request.json() as { token?: string };

    if (!body.token || body.token.length !== 64) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Token must be 64 characters' },
        { status: 400 },
      );
    }

    const result = consumePendingToken(body.token);
    if ('error' in result) {
      return HttpResponse.json(result, { status: 401 });
    }

    const response: TokenSessionEnvelope = {
      session: {
        user: result.user,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.accessExpiresAt.toISOString(),
      },
      isNewUser: result.isNewUser,
    };

    return HttpResponse.json(response);
  }),
];

export function resetMockEmailAuthState() {
  pendingTokens.clear();
  tokenCounter = 0;
}

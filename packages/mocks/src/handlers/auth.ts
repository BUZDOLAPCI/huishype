/**
 * Auth API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUserProfiles, mockUsers } from '../data/fixtures.js';

type BrowserSessionEnvelope = {
  session: {
    user: (typeof mockUsers)[number];
    expiresAt: string;
  };
  isNewUser: boolean;
};

type BrowserRefreshEnvelope = {
  session: {
    user: (typeof mockUsers)[number];
    expiresAt: string;
  };
};

type BrowserSessionStateEnvelope = {
  user: ((typeof mockUserProfiles)[number] & { email: string }) | null;
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

type TokenRefreshEnvelope = {
  session: {
    user: (typeof mockUsers)[number];
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
};

const ACCESS_COOKIE_NAME = 'huishype_access';
const REFRESH_COOKIE_NAME = 'huishype_refresh';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type MockSession = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

let accessSessions = new Map<string, MockSession>();
let refreshSessions = new Map<string, MockSession>();

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...valueParts] = part.trim().split('=');
    if (!rawName || valueParts.length === 0) {
      continue;
    }
    cookies.set(rawName, valueParts.join('='));
  }

  return cookies;
}

function issueMockSession(userId: string, namespace: string): MockSession {
  const now = Date.now();
  const session: MockSession = {
    userId,
    accessToken: `${namespace}-access-token-${now}`,
    refreshToken: `${namespace}-refresh-token-${now}`,
    accessExpiresAt: new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
  };

  accessSessions.set(session.accessToken, session);
  refreshSessions.set(session.refreshToken, session);

  return session;
}

function revokeMockSessionByRefreshToken(refreshToken: string | null | undefined): void {
  if (!refreshToken) {
    return;
  }

  const session = refreshSessions.get(refreshToken);
  if (!session) {
    return;
  }

  refreshSessions.delete(refreshToken);
  accessSessions.delete(session.accessToken);
}

function appendSessionCookies(response: Response, session: MockSession): Response {
  response.headers.append(
    'Set-Cookie',
    `${ACCESS_COOKIE_NAME}=${session.accessToken}; Path=/; Expires=${session.accessExpiresAt.toUTCString()}; HttpOnly; SameSite=Lax`,
  );
  response.headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${session.refreshToken}; Path=/; Expires=${session.refreshExpiresAt.toUTCString()}; HttpOnly; SameSite=Lax`,
  );
  return response;
}

function appendClearedSessionCookies(response: Response): Response {
  response.headers.append(
    'Set-Cookie',
    `${ACCESS_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
  );
  response.headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
  );
  return response;
}

function getSessionFromAccessToken(accessToken: string | null | undefined): MockSession | null {
  if (!accessToken) {
    return null;
  }

  const session = accessSessions.get(accessToken);
  if (!session) {
    return null;
  }

  if (session.accessExpiresAt < new Date()) {
    accessSessions.delete(accessToken);
    refreshSessions.delete(session.refreshToken);
    return null;
  }

  return session;
}

function getSessionFromRefreshToken(refreshToken: string | null | undefined): MockSession | null {
  if (!refreshToken) {
    return null;
  }

  const session = refreshSessions.get(refreshToken);
  if (!session) {
    return null;
  }

  if (session.refreshExpiresAt < new Date()) {
    refreshSessions.delete(refreshToken);
    accessSessions.delete(session.accessToken);
    return null;
  }

  return session;
}

function getRefreshTokenFromRequest(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  return cookies.get(REFRESH_COOKIE_NAME) ?? null;
}

function buildBrowserLoginResponse(userIndex: number, idToken: string): Response {
  const isNewUser = idToken.includes('new');
  const user = isNewUser ? mockUsers[4] : mockUsers[userIndex];
  const session = issueMockSession(user.id, 'mock');

  const body: BrowserSessionEnvelope = {
    session: {
      user,
      expiresAt: session.accessExpiresAt.toISOString(),
    },
    isNewUser,
  };

  return appendSessionCookies(HttpResponse.json(body), session);
}

function buildTokenLoginResponse(userIndex: number, idToken: string): Response {
  const isNewUser = idToken.includes('new');
  const user = isNewUser ? mockUsers[4] : mockUsers[userIndex];
  const session = issueMockSession(user.id, 'mock');

  const body: TokenSessionEnvelope = {
    session: {
      user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.accessExpiresAt.toISOString(),
    },
    isNewUser,
  };

  return HttpResponse.json(body);
}

function buildLoginHandler(path: string, type: 'browser' | 'token', userIndex: number) {
  return http.post(`*${path}`, async ({ request }) => {
    const body = await request.json() as { idToken?: string };

    if (!body.idToken) {
      return HttpResponse.json(
        { error: 'INVALID_REQUEST', message: 'Missing idToken' },
        { status: 400 },
      );
    }

    return type === 'browser'
      ? buildBrowserLoginResponse(userIndex, body.idToken)
      : buildTokenLoginResponse(userIndex, body.idToken);
  });
}

export const authHandlers = [
  buildLoginHandler('/auth/google', 'browser', 0),
  buildLoginHandler('/auth/apple', 'browser', 0),
  buildLoginHandler('/auth/token/google', 'token', 0),
  buildLoginHandler('/auth/token/apple', 'token', 0),

  http.post('*/auth/refresh', ({ request }) => {
    const refreshToken = getRefreshTokenFromRequest(request);
    const currentSession = getSessionFromRefreshToken(refreshToken);

    if (!currentSession) {
      return appendClearedSessionCookies(
        HttpResponse.json(
          { error: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
          { status: 401 },
        ),
      );
    }

    revokeMockSessionByRefreshToken(currentSession.refreshToken);
    const nextSession = issueMockSession(currentSession.userId, 'mock');
    const user = mockUsers.find((candidate) => candidate.id === currentSession.userId) ?? mockUsers[0];
    const body: BrowserRefreshEnvelope = {
      session: {
        user,
        expiresAt: nextSession.accessExpiresAt.toISOString(),
      },
    };

    return appendSessionCookies(HttpResponse.json(body), nextSession);
  }),

  http.post('*/auth/token/refresh', async ({ request }) => {
    const body = await request.json() as { refreshToken?: string };
    const currentSession = getSessionFromRefreshToken(body.refreshToken);

    if (!currentSession) {
      return HttpResponse.json(
        { error: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
        { status: 401 },
      );
    }

    revokeMockSessionByRefreshToken(currentSession.refreshToken);
    const nextSession = issueMockSession(currentSession.userId, 'mock');
    const user = mockUsers.find((candidate) => candidate.id === currentSession.userId) ?? mockUsers[0];
    const response: TokenRefreshEnvelope = {
      session: {
        user,
        accessToken: nextSession.accessToken,
        refreshToken: nextSession.refreshToken,
        expiresAt: nextSession.accessExpiresAt.toISOString(),
      },
    };

    return HttpResponse.json(response);
  }),

  http.post('*/auth/logout', ({ request }) => {
    revokeMockSessionByRefreshToken(getRefreshTokenFromRequest(request));
    return appendClearedSessionCookies(new HttpResponse(null, { status: 204 }));
  }),

  http.post('*/auth/token/logout', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { refreshToken?: string };
    revokeMockSessionByRefreshToken(body.refreshToken);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/auth/session', ({ request }) => {
    const authUser = getMockAuthUserFromRequest(request);

    if (!authUser) {
      const response: BrowserSessionStateEnvelope = {
        user: null,
      };

      return HttpResponse.json(response);
    }

    return HttpResponse.json({
      user: {
        ...authUser,
        email: `${authUser.username}@example.com`,
      },
    });
  }),

  http.get('*/auth/me', ({ request }) => {
    const authUser = getMockAuthUserFromRequest(request);

    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 },
      );
    }

    return HttpResponse.json({
      user: {
        ...authUser,
        email: `${authUser.username}@example.com`,
      },
    });
  }),
];

export function validateMockToken(
  authHeader: string | null,
  cookieHeader?: string | null,
): { userId: string } | null {
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : parseCookieHeader(cookieHeader ?? null).get(ACCESS_COOKIE_NAME);
  const session = getSessionFromAccessToken(accessToken);

  return session ? { userId: session.userId } : null;
}

export function getMockAuthUser(
  authHeader: string | null,
  cookieHeader?: string | null,
) {
  const session = validateMockToken(authHeader, cookieHeader);
  if (!session) {
    return null;
  }

  return mockUserProfiles.find((user) => user.id === session.userId) ?? null;
}

export function getMockAuthUserFromRequest(request: Request) {
  return getMockAuthUser(
    request.headers.get('Authorization'),
    request.headers.get('Cookie'),
  );
}

export function registerMockSession(accessToken: string, userId: string, expiresAt: Date, refreshToken?: string) {
  const session: MockSession = {
    userId,
    accessToken,
    refreshToken: refreshToken ?? `mock-refresh-token-${Date.now()}`,
    accessExpiresAt: expiresAt,
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  };

  accessSessions.set(session.accessToken, session);
  refreshSessions.set(session.refreshToken, session);
}

export function issueRegisteredMockSession(userId: string, namespace = 'mock') {
  return issueMockSession(userId, namespace);
}

export function resetMockSessions() {
  accessSessions = new Map();
  refreshSessions = new Map();
}

/**
 * Authentication routes.
 *
 * Browser endpoints establish and refresh HTTP-only cookie-backed sessions.
 * Explicit `/auth/token/*` endpoints remain available for non-browser clients
 * that still need bearer tokens.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import { db } from '../db/index.js';
import { refreshTokenRevocations, users } from '../db/schema.js';
import { config } from '../config.js';
import type { RefreshTokenPayload } from '../plugins/auth.js';
import {
  getRefreshTokenFromRequest,
  verifyRefreshToken,
} from '../plugins/auth.js';
import {
  assertAllowedBrowserOrigin,
  clearBrowserSession,
  issueBrowserSession,
  issueTokenSession,
  serializeSessionUser,
} from './auth-session.js';
import { withGeneratedUniqueUsername } from '../utils/username.js';

const loginBodySchema = z.object({
  idToken: z.string().min(1),
});

const sessionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  profilePhotoUrl: z.string().nullable(),
  karma: z.number(),
  karmaRank: z.string(),
  createdAt: z.string(),
});

const browserSessionSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.string(),
});

const tokenSessionSchema = browserSessionSchema.extend({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const browserLoginResponseSchema = z.object({
  session: browserSessionSchema,
  isNewUser: z.boolean(),
});

const tokenLoginResponseSchema = z.object({
  session: tokenSessionSchema,
  isNewUser: z.boolean(),
});

const tokenRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

const authErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const browserCookieSecurity = [{ cookieAuth: [] }] as const;
const browserOrBearerSecurity = [{ cookieAuth: [] }, { bearerAuth: [] }] as const;

interface AppleTokenHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface AppleTokenClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
}

function decodeJwtSegment<T>(token: string, index: number): T | null {
  const segment = token.split('.')[index];
  if (!segment) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

async function fetchAppleSigningKey(kid: string) {
  const response = await fetch('https://appleid.apple.com/auth/keys', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    keys?: Array<JsonWebKey & { kid?: string }>;
  };
  const jwk = body.keys?.find((candidate) => candidate.kid === kid);
  if (!jwk) {
    return null;
  }

  return createPublicKey({
    key: jwk,
    format: 'jwk',
  });
}

async function verifyAppleJwt(idToken: string): Promise<AppleTokenClaims | null> {
  const header = decodeJwtSegment<AppleTokenHeader>(idToken, 0);
  const claims = decodeJwtSegment<AppleTokenClaims>(idToken, 1);

  if (!header || !claims || header.alg !== 'RS256' || !header.kid) {
    return null;
  }

  const expectedAudience = config.auth.appleClientId;
  const audienceMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(expectedAudience)
    : claims.aud === expectedAudience;

  if (
    claims.iss !== 'https://appleid.apple.com' ||
    !audienceMatches ||
    claims.exp * 1000 <= Date.now() ||
    !claims.sub
  ) {
    return null;
  }

  const signingKey = await fetchAppleSigningKey(header.kid);
  if (!signingKey) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const valid = verifier.verify(signingKey, Buffer.from(encodedSignature, 'base64url'));

  return valid ? claims : null;
}

async function validateGoogleToken(
  idToken: string,
): Promise<{ email: string; googleId: string; name?: string } | null> {
  if (config.isDev === true) {
    if (idToken.startsWith('mock-google-')) {
      const parts = idToken.split('-');
      if (parts.length >= 4) {
        return {
          email: `${parts[2]}@gmail.com`,
          googleId: parts[3],
          name: parts[2],
        };
      }
    }

    const timestamp = Date.now();
    return {
      email: `testuser${timestamp}@gmail.com`,
      googleId: `google-${timestamp}`,
      name: 'Test User',
    };
  }

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      email: string;
      sub: string;
      name?: string;
      aud: string;
    };

    if (data.aud !== config.auth.googleClientId) {
      return null;
    }

    return {
      email: data.email,
      googleId: data.sub,
      name: data.name,
    };
  } catch {
    return null;
  }
}

async function validateAppleToken(
  idToken: string,
): Promise<{ email: string | null; appleId: string; name?: string } | null> {
  if (config.isDev === true) {
    if (idToken.startsWith('mock-apple-')) {
      const parts = idToken.split('-');
      if (parts.length >= 4) {
        return {
          email: `${parts[2]}@privaterelay.appleid.com`,
          appleId: parts[3],
          name: parts[2],
        };
      }
    }

    const timestamp = Date.now();
    return {
      email: `testuser${timestamp}@privaterelay.appleid.com`,
      appleId: `apple-${timestamp}`,
      name: 'Test User',
    };
  }

  try {
    const claims = await verifyAppleJwt(idToken);
    if (!claims) {
      return null;
    }

    return {
      email: claims.email?.toLowerCase() ?? null,
      appleId: claims.sub,
      name: claims.email?.split('@')[0],
    };
  } catch {
    return null;
  }
}

function getRefreshTokenMetadata(token: string): RefreshTokenPayload | null {
  const payload = verifyRefreshToken(token);
  if (!payload?.jti || typeof payload.exp !== 'number') {
    return null;
  }
  return payload;
}

async function isRefreshTokenRevoked(tokenId: string): Promise<boolean> {
  const rows = await db
    .select({ id: refreshTokenRevocations.id })
    .from(refreshTokenRevocations)
    .where(eq(refreshTokenRevocations.tokenId, tokenId))
    .limit(1);

  return rows.length > 0;
}

async function revokeRefreshToken(payload: RefreshTokenPayload): Promise<void> {
  if (!payload.jti || typeof payload.exp !== 'number') {
    return;
  }

  await db
    .insert(refreshTokenRevocations)
    .values({
      tokenId: payload.jti,
      userId: payload.userId,
      expiresAt: new Date(payload.exp * 1000),
    })
    .onConflictDoNothing();
}

async function upsertGoogleUser(idToken: string) {
  const googleUser = await validateGoogleToken(idToken);
  if (!googleUser) {
    return null;
  }

  let user = await db.query.users.findFirst({
    where: or(eq(users.googleId, googleUser.googleId), eq(users.email, googleUser.email)),
  });

  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = await withGeneratedUniqueUsername(async (username) => {
      const displayName = googleUser.name || username;
      const [newUser] = await db
        .insert(users)
        .values({
          googleId: googleUser.googleId,
          email: googleUser.email,
          username,
          displayName,
        })
        .returning();

      return newUser;
    });
  } else if (!user.googleId) {
    await db.update(users).set({ googleId: googleUser.googleId }).where(eq(users.id, user.id));
  }

  return { user, isNewUser };
}

async function upsertAppleUser(idToken: string) {
  const appleUser = await validateAppleToken(idToken);
  if (!appleUser) {
    return null;
  }

  let user = await db.query.users.findFirst({
    where: appleUser.email
      ? or(eq(users.appleId, appleUser.appleId), eq(users.email, appleUser.email))
      : eq(users.appleId, appleUser.appleId),
  });

  let isNewUser = false;

  if (!user) {
    if (!appleUser.email) {
      return { error: 'EMAIL_REQUIRED' as const };
    }

    const email = appleUser.email;
    isNewUser = true;
    user = await withGeneratedUniqueUsername(async (username) => {
      const displayName = appleUser.name || username;
      const [newUser] = await db
        .insert(users)
        .values({
          appleId: appleUser.appleId,
          email,
          username,
          displayName,
        })
        .returning();

      return newUser;
    });
  } else if (!user.appleId) {
    await db.update(users).set({ appleId: appleUser.appleId }).where(eq(users.id, user.id));
  }

  return { user, isNewUser };
}

async function refreshUserSession(
  refreshToken: string,
): Promise<{ user: typeof users.$inferSelect } | { error: string; message: string }> {
  const payload = getRefreshTokenMetadata(refreshToken);
  if (!payload) {
    return {
      error: 'INVALID_REFRESH_TOKEN',
      message: 'Invalid or expired refresh token',
    };
  }

  if (await isRefreshTokenRevoked(payload.jti)) {
    return {
      error: 'INVALID_REFRESH_TOKEN',
      message: 'Invalid or expired refresh token',
    };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });

  if (!user) {
    return {
      error: 'USER_NOT_FOUND',
      message: 'User no longer exists',
    };
  }

  await revokeRefreshToken(payload);
  return { user };
}

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/auth/google',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Google for the browser session flow',
        description:
          'Validates a Google ID token, establishes an HTTP-only browser session, and returns the authenticated user.',
        body: loginBodySchema,
        response: {
          200: browserLoginResponseSchema,
          400: authErrorSchema,
          401: authErrorSchema,
          403: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!assertAllowedBrowserOrigin(request, reply)) {
        return reply;
      }

      const login = await upsertGoogleUser(request.body.idToken);
      if (!login) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Google ID token',
        });
      }

      return {
        session: issueBrowserSession(fastify, reply, login.user),
        isNewUser: login.isNewUser,
      };
    },
  );

  app.post(
    '/auth/token/google',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Google for explicit token clients',
        description:
          'Validates a Google ID token and returns bearer tokens for non-browser clients.',
        body: loginBodySchema,
        response: {
          200: tokenLoginResponseSchema,
          400: authErrorSchema,
          401: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const login = await upsertGoogleUser(request.body.idToken);
      if (!login) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Google ID token',
        });
      }

      return {
        session: issueTokenSession(fastify, login.user),
        isNewUser: login.isNewUser,
      };
    },
  );

  app.post(
    '/auth/apple',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Apple for the browser session flow',
        description:
          'Validates an Apple ID token, establishes an HTTP-only browser session, and returns the authenticated user.',
        body: loginBodySchema,
        response: {
          200: browserLoginResponseSchema,
          400: authErrorSchema,
          401: authErrorSchema,
          403: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!assertAllowedBrowserOrigin(request, reply)) {
        return reply;
      }

      const login = await upsertAppleUser(request.body.idToken);
      if (!login) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Apple ID token',
        });
      }
      if ('error' in login) {
        return reply.status(400).send({
          error: 'EMAIL_REQUIRED',
          message:
            'Apple did not provide an email for this sign-in. Sign in with Apple again and share your email address.',
        });
      }

      return {
        session: issueBrowserSession(fastify, reply, login.user),
        isNewUser: login.isNewUser,
      };
    },
  );

  app.post(
    '/auth/token/apple',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Apple for explicit token clients',
        description:
          'Validates an Apple ID token and returns bearer tokens for non-browser clients.',
        body: loginBodySchema,
        response: {
          200: tokenLoginResponseSchema,
          400: authErrorSchema,
          401: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const login = await upsertAppleUser(request.body.idToken);
      if (!login) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Apple ID token',
        });
      }
      if ('error' in login) {
        return reply.status(400).send({
          error: 'EMAIL_REQUIRED',
          message:
            'Apple did not provide an email for this sign-in. Sign in with Apple again and share your email address.',
        });
      }

      return {
        session: issueTokenSession(fastify, login.user),
        isNewUser: login.isNewUser,
      };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh the browser session from the refresh cookie',
        description:
          'Rotates the browser session cookies using the refresh-token cookie and returns the refreshed session envelope.',
        security: browserCookieSecurity,
        response: {
          200: z.object({
            session: browserSessionSchema,
          }),
          401: authErrorSchema,
          403: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!assertAllowedBrowserOrigin(request, reply)) {
        return reply;
      }

      const refreshToken = getRefreshTokenFromRequest(request);
      if (!refreshToken) {
        clearBrowserSession(reply);
        return reply.status(401).send({
          error: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        });
      }

      const refreshed = await refreshUserSession(refreshToken);
      if ('error' in refreshed) {
        clearBrowserSession(reply);
        return reply.status(401).send(refreshed);
      }

      return {
        session: issueBrowserSession(fastify, reply, refreshed.user),
      };
    },
  );

  app.post(
    '/auth/token/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh a token session explicitly',
        description:
          'Rotates the supplied refresh token and returns a new access/refresh token pair for non-browser clients.',
        body: tokenRefreshSchema,
        response: {
          200: z.object({
            session: tokenSessionSchema,
          }),
          401: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const refreshed = await refreshUserSession(request.body.refreshToken);
      if ('error' in refreshed) {
        return reply.status(401).send(refreshed);
      }

      return {
        session: issueTokenSession(fastify, refreshed.user),
      };
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Logout the browser session',
        description:
          'Revokes the refresh-token cookie when present and clears both browser session cookies.',
        security: browserCookieSecurity,
        response: {
          204: z.null(),
          403: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!assertAllowedBrowserOrigin(request, reply)) {
        return reply;
      }

      const refreshToken = getRefreshTokenFromRequest(request);
      if (refreshToken) {
        const payload = getRefreshTokenMetadata(refreshToken);
        if (payload) {
          await revokeRefreshToken(payload);
        }
      }

      clearBrowserSession(reply);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/auth/token/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Logout an explicit token session',
        description: 'Revokes the supplied refresh token for non-browser token clients.',
        body: logoutSchema,
        response: {
          204: z.null(),
        },
      },
    },
    async (request, reply) => {
      const refreshToken = request.body.refreshToken;
      if (refreshToken) {
        const payload = getRefreshTokenMetadata(refreshToken);
        if (payload) {
          await revokeRefreshToken(payload);
        }
      }

      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/session',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['Auth'],
        summary: 'Get the current browser or token session state',
        description:
          'Returns the active user when a browser cookie session or bearer token is present, otherwise returns user=null without raising an auth error.',
        security: browserOrBearerSecurity,
        response: {
          200: z.object({
            user: sessionUserSchema.extend({
              email: z.string(),
            }).nullable(),
          }),
        },
      },
    },
    async (request) => {
      const userId = request.userId;
      if (!userId) {
        return {
          user: null,
        };
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return {
          user: null,
        };
      }

      return {
        user: {
          ...serializeSessionUser(user),
          email: user.email,
        },
      };
    },
  );

  app.get(
    '/auth/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Get the current authenticated user',
        description:
          'Returns the active user for the browser cookie session or an explicit bearer token.',
        security: browserOrBearerSecurity,
        response: {
          200: z.object({
            user: sessionUserSchema.extend({
              email: z.string(),
            }),
          }),
          401: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return {
        user: {
          ...serializeSessionUser(user),
          email: user.email,
        },
      };
    },
  );
}

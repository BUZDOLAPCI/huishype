/**
 * Authentication routes
 * Handles login with Google/Apple, token refresh, and logout
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import { db } from '../db/index.js';
import { refreshTokenRevocations, users } from '../db/schema.js';
import { config } from '../config.js';
import {
  generateAccessToken,
  type RefreshTokenPayload,
  generateRefreshToken,
  verifyRefreshToken,
  getAccessTokenExpiry,
} from '../plugins/auth.js';
import { getKarmaRank } from '../services/karma.js';
import { withGeneratedUniqueUsername } from '../utils/username.js';

// Validation schemas
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

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

interface MockGoogleTokenPayload {
  email?: string;
  googleId?: string;
  name?: string;
}

type UserIdentityInsertError = {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  detail?: string;
};

const GOOGLE_IDENTITY_UNIQUE_CONSTRAINTS = new Set([
  'users_email_idx',
  'users_email_key',
  'users_email_unique',
  'users_google_id_idx',
  'users_google_id_key',
  'users_google_id_unique',
]);

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

  const valid = verifier.verify(
    signingKey,
    Buffer.from(encodedSignature, 'base64url'),
  );

  return valid ? claims : null;
}

function parseMockGoogleToken(
  idToken: string,
): { email: string; googleId: string; name?: string } | null {
  if (idToken.startsWith('mock-google:')) {
    const encodedPayload = idToken.slice('mock-google:'.length);
    if (!encodedPayload) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as MockGoogleTokenPayload;

      if (!payload.email || !payload.googleId) {
        return null;
      }

      return {
        email: payload.email.toLowerCase(),
        googleId: payload.googleId,
        name: payload.name,
      };
    } catch {
      return null;
    }
  }

  if (!idToken.startsWith('mock-google-')) {
    return null;
  }

  const legacyPayload = idToken.slice('mock-google-'.length);
  const separatorIndex = legacyPayload.lastIndexOf('-gid');
  if (separatorIndex <= 0) {
    return null;
  }

  const legacyLabel = legacyPayload.slice(0, separatorIndex);
  const legacyGoogleId = legacyPayload.slice(separatorIndex + 1);
  if (!legacyLabel || !legacyGoogleId) {
    return null;
  }

  return {
    email: `${legacyLabel}@gmail.com`,
    googleId: legacyGoogleId,
    name: legacyLabel,
  };
}

function isGoogleIdentityUniqueViolation(error: unknown): boolean {
  const pending: unknown[] = [error];

  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const dbError = candidate as UserIdentityInsertError & { cause?: unknown };
    if (dbError.code === '23505') {
      const constraintName = dbError.constraint_name ?? dbError.constraint ?? '';
      if (GOOGLE_IDENTITY_UNIQUE_CONSTRAINTS.has(constraintName)) {
        return true;
      }

      const detail = dbError.detail ?? '';
      if (detail.includes('(email)') || detail.includes('(google_id)')) {
        return true;
      }
    }

    if ('cause' in dbError) {
      pending.push(dbError.cause);
    }
  }

  return false;
}

async function verifyGoogleTokenWithGoogle(
  idToken: string,
): Promise<{ email: string; googleId: string; name?: string } | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      email?: string;
      sub?: string;
      name?: string;
      aud?: string;
    };

    // Verify the audience matches our client ID
    if (
      data.aud !== config.auth.googleClientId ||
      !data.email ||
      !data.sub
    ) {
      return null;
    }

    return {
      email: data.email.toLowerCase(),
      googleId: data.sub,
      name: data.name,
    };
  } catch {
    return null;
  }
}

/**
 * Validate Google ID token.
 *
 * Development and test runs support explicit `mock-google...` tokens for local
 * automation. Real Google tokens are still verified with Google so local dev
 * sign-in uses the actual account email.
 */
async function validateGoogleToken(
  idToken: string
): Promise<{ email: string; googleId: string; name?: string } | null> {
  if (config.isDev === true) {
    const mockGoogleUser = parseMockGoogleToken(idToken);
    if (mockGoogleUser) {
      return mockGoogleUser;
    }
  }

  return verifyGoogleTokenWithGoogle(idToken);
}

async function findUserByGoogleIdentity(googleUser: {
  email: string;
  googleId: string;
}) {
  return db.query.users.findFirst({
    where: or(
      eq(users.googleId, googleUser.googleId),
      eq(users.email, googleUser.email),
    ),
  });
}

function parseMockAppleToken(
  idToken: string,
): { email: string; appleId: string; name?: string } | null {
  if (!idToken.startsWith('mock-apple-')) {
    return null;
  }

  const parts = idToken.split('-');
  if (parts.length < 4) {
    return null;
  }

  return {
    email: parts[2] + '@privaterelay.appleid.com',
    appleId: parts[3],
    name: parts[2],
  };
}

/**
 * Validate Apple ID token.
 *
 * Development and test runs support explicit `mock-apple...` tokens. Real
 * Apple tokens are verified against Apple's signing keys in every environment.
 */
async function validateAppleToken(
  idToken: string
): Promise<{ email: string | null; appleId: string; name?: string } | null> {
  if (config.isDev === true) {
    const mockAppleUser = parseMockAppleToken(idToken);
    if (mockAppleUser) {
      return mockAppleUser;
    }
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

function getRefreshTokenMetadata(
  token: string,
): RefreshTokenPayload | null {
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

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /auth/google - Login with Google
   */
  app.post(
    '/auth/google',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Google',
        description: 'Validate Google ID token, create or find user, return JWT tokens',
        body: z.object({
          idToken: z.string().min(1),
        }),
        response: {
          200: z.object({
            session: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                displayName: z.string(),
                profilePhotoUrl: z.string().nullable(),
                email: z.string(),
                karma: z.number(),
                karmaRank: z.string(),
                createdAt: z.string(),
                isAdmin: z.boolean(),
              }),
              accessToken: z.string(),
              refreshToken: z.string(),
              expiresAt: z.string(),
            }),
            isNewUser: z.boolean(),
          }),
          400: z.object({
            error: z.string(),
            message: z.string(),
          }),
          401: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { idToken } = request.body;

      // Validate Google token
      const googleUser = await validateGoogleToken(idToken);
      if (!googleUser) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Google ID token',
        });
      }

      // Check if user exists by Google ID or email
      let user = await findUserByGoogleIdentity(googleUser);

      let isNewUser = false;

      if (!user) {
        // Create new user
        isNewUser = true;
        try {
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
        } catch (error) {
          if (!isGoogleIdentityUniqueViolation(error)) {
            throw error;
          }

          user = await findUserByGoogleIdentity(googleUser);
          if (!user) {
            throw error;
          }
          isNewUser = false;
        }
      } else if (!user.googleId) {
        // Link Google account to existing user
        await db
          .update(users)
          .set({ googleId: googleUser.googleId })
          .where(eq(users.id, user.id));
      }

      // Generate tokens
      const accessToken = generateAccessToken(fastify, user.id);
      const refreshToken = generateRefreshToken(user.id);
      const expiresAt = getAccessTokenExpiry();

      return {
        session: {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            profilePhotoUrl: user.profilePhotoUrl,
            email: user.email,
            karma: user.karma,
            karmaRank: getKarmaRank(user.karma).title,
            createdAt: user.createdAt.toISOString(),
            isAdmin: user.isAdmin,
          },
          accessToken,
          refreshToken,
          expiresAt: expiresAt.toISOString(),
        },
        isNewUser,
      };
    }
  );

  /**
   * POST /auth/apple - Login with Apple
   */
  app.post(
    '/auth/apple',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with Apple',
        description: 'Validate Apple ID token, create or find user, return JWT tokens',
        body: z.object({
          idToken: z.string().min(1),
        }),
        response: {
          200: z.object({
            session: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                displayName: z.string(),
                profilePhotoUrl: z.string().nullable(),
                email: z.string(),
                karma: z.number(),
                karmaRank: z.string(),
                createdAt: z.string(),
                isAdmin: z.boolean(),
              }),
              accessToken: z.string(),
              refreshToken: z.string(),
              expiresAt: z.string(),
            }),
            isNewUser: z.boolean(),
          }),
          400: z.object({
            error: z.string(),
            message: z.string(),
          }),
          401: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { idToken } = request.body;

      // Validate Apple token
      const appleUser = await validateAppleToken(idToken);
      if (!appleUser) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Apple ID token',
        });
      }

      // Check if user exists by Apple ID or email when Apple returned one.
      let user = await db.query.users.findFirst({
        where: appleUser.email
          ? or(eq(users.appleId, appleUser.appleId), eq(users.email, appleUser.email))
          : eq(users.appleId, appleUser.appleId),
      });

      let isNewUser = false;

      if (!user) {
        if (!appleUser.email) {
          return reply.status(400).send({
            error: 'EMAIL_REQUIRED',
            message:
              'Apple did not provide an email for this sign-in. Sign in with Apple again and share your email address.',
          });
        }
        const email = appleUser.email;

        // Create new user
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
        // Link Apple account to existing user
        await db
          .update(users)
          .set({ appleId: appleUser.appleId })
          .where(eq(users.id, user.id));
      }

      // Generate tokens
      const accessToken = generateAccessToken(fastify, user.id);
      const refreshToken = generateRefreshToken(user.id);
      const expiresAt = getAccessTokenExpiry();

      return {
        session: {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            profilePhotoUrl: user.profilePhotoUrl,
            email: user.email,
            karma: user.karma,
            karmaRank: getKarmaRank(user.karma).title,
            createdAt: user.createdAt.toISOString(),
            isAdmin: user.isAdmin,
          },
          accessToken,
          refreshToken,
          expiresAt: expiresAt.toISOString(),
        },
        isNewUser,
      };
    }
  );

  /**
   * POST /auth/refresh - Refresh access token
   */
  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        description: 'Exchange a refresh token for a new access token',
        body: refreshSchema,
        response: {
          200: z.object({
            accessToken: z.string(),
            expiresAt: z.string(),
          }),
          401: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      const payload = getRefreshTokenMetadata(refreshToken);
      if (!payload) {
        return reply.status(401).send({
          error: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        });
      }

      if (await isRefreshTokenRevoked(payload.jti)) {
        return reply.status(401).send({
          error: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        });
      }

      // Verify user still exists
      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User no longer exists',
        });
      }

      // Generate new access token
      const accessToken = generateAccessToken(fastify, user.id);
      const expiresAt = getAccessTokenExpiry();

      return {
        accessToken,
        expiresAt: expiresAt.toISOString(),
      };
    }
  );

  /**
   * POST /auth/logout - Logout and invalidate refresh token
   */
  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Logout',
        description: 'Invalidate refresh token (client should also clear tokens)',
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
    }
  );

  /**
   * GET /auth/me - Get current user profile
   */
  app.get(
    '/auth/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        description: 'Returns the profile of the currently authenticated user',
        response: {
          200: z.object({
            user: z.object({
              id: z.string(),
              username: z.string(),
              displayName: z.string(),
              profilePhotoUrl: z.string().nullable(),
              email: z.string(),
              karma: z.number(),
              karmaRank: z.string(),
              createdAt: z.string(),
              isAdmin: z.boolean(),
            }),
          }),
          401: z.object({
            error: z.string(),
            message: z.string(),
          }),
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
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          profilePhotoUrl: user.profilePhotoUrl,
          email: user.email,
          karma: user.karma,
          karmaRank: getKarmaRank(user.karma).title,
          createdAt: user.createdAt.toISOString(),
          isAdmin: user.isAdmin,
        },
      };
    }
  );
}

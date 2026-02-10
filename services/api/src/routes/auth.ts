/**
 * Authentication routes
 * Handles login with Google/Apple, token refresh, and logout
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { config } from '../config.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getAccessTokenExpiry,
} from '../plugins/auth.js';
import { getKarmaRank } from '../services/karma.js';

// Validation schemas
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Helper to generate a unique username
function generateUsername(): string {
  const adjectives = ['happy', 'clever', 'swift', 'bright', 'calm', 'bold', 'keen', 'quick'];
  const nouns = ['huis', 'woning', 'pand', 'villa', 'flat', 'kamer', 'gracht', 'straat'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999);
  return `${adj}${noun}${num}`;
}

/**
 * Validate Google ID token
 * In production, this would verify with Google's API
 * For development, we mock the validation
 */
async function validateGoogleToken(
  idToken: string
): Promise<{ email: string; googleId: string; name?: string } | null> {
  if (config.isDev === true) {
    // Mock validation for development
    // Token format: mock-google-{email}-{googleId}
    if (idToken.startsWith('mock-google-')) {
      const parts = idToken.split('-');
      if (parts.length >= 4) {
        return {
          email: parts[2] + '@gmail.com',
          googleId: parts[3],
          name: parts[2],
        };
      }
    }

    // For any token in dev mode, create a test user
    const timestamp = Date.now();
    return {
      email: `testuser${timestamp}@gmail.com`,
      googleId: `google-${timestamp}`,
      name: 'Test User',
    };
  }

  // Production: Verify with Google
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      email: string;
      sub: string;
      name?: string;
      aud: string;
    };

    // Verify the audience matches our client ID
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

/**
 * Validate Apple ID token
 * In production, this would verify with Apple's API
 * For development, we mock the validation
 */
async function validateAppleToken(
  idToken: string
): Promise<{ email: string; appleId: string; name?: string } | null> {
  if (config.isDev === true) {
    // Mock validation for development
    if (idToken.startsWith('mock-apple-')) {
      const parts = idToken.split('-');
      if (parts.length >= 4) {
        return {
          email: parts[2] + '@privaterelay.appleid.com',
          appleId: parts[3],
          name: parts[2],
        };
      }
    }

    // For any token in dev mode, create a test user
    const timestamp = Date.now();
    return {
      email: `testuser${timestamp}@privaterelay.appleid.com`,
      appleId: `apple-${timestamp}`,
      name: 'Test User',
    };
  }

  // Production: Verify with Apple
  // Apple's verification is more complex and requires JWT verification
  // For now, we'll return null in production until properly implemented
  // TODO: Implement Apple token verification using apple-signin-auth or similar
  try {
    // This is a placeholder for Apple token verification
    // In production, you would:
    // 1. Fetch Apple's public keys from https://appleid.apple.com/auth/keys
    // 2. Verify the JWT signature
    // 3. Validate the claims (iss, aud, exp)
    console.warn('Apple token verification not fully implemented for production');
    return null;
  } catch {
    return null;
  }
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
                karma: z.number(),
                karmaRank: z.string(),
                isPlus: z.boolean(),
                createdAt: z.string(),
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
      let user = await db.query.users.findFirst({
        where: or(
          eq(users.googleId, googleUser.googleId),
          eq(users.email, googleUser.email)
        ),
      });

      let isNewUser = false;

      if (!user) {
        // Create new user
        isNewUser = true;
        const username = generateUsername();
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

        user = newUser;
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
            karma: user.karma,
            karmaRank: getKarmaRank(user.karma).title,
            isPlus: false, // TODO: Check subscription status
            createdAt: user.createdAt.toISOString(),
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
                karma: z.number(),
                karmaRank: z.string(),
                isPlus: z.boolean(),
                createdAt: z.string(),
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

      // Check if user exists by Apple ID or email
      let user = await db.query.users.findFirst({
        where: or(
          eq(users.appleId, appleUser.appleId),
          eq(users.email, appleUser.email)
        ),
      });

      let isNewUser = false;

      if (!user) {
        // Create new user
        isNewUser = true;
        const username = generateUsername();
        const displayName = appleUser.name || username;

        const [newUser] = await db
          .insert(users)
          .values({
            appleId: appleUser.appleId,
            email: appleUser.email,
            username,
            displayName,
          })
          .returning();

        user = newUser;
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
            karma: user.karma,
            karmaRank: getKarmaRank(user.karma).title,
            isPlus: false, // TODO: Check subscription status
            createdAt: user.createdAt.toISOString(),
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

      // Verify refresh token
      const payload = verifyRefreshToken(refreshToken);
      if (!payload) {
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
        body: z.object({
          refreshToken: z.string().optional(),
        }),
        response: {
          204: z.null(),
        },
      },
    },
    async (_request, reply) => {
      // In a production system, you would add the refresh token to a blacklist
      // or use a token versioning system to invalidate all tokens for a user
      // For now, we just return 204 and rely on the client to clear tokens
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
              isPlus: z.boolean(),
              createdAt: z.string(),
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
          isPlus: false, // TODO: Check subscription status
          createdAt: user.createdAt.toISOString(),
        },
      };
    }
  );
}

/**
 * Email magic link auth routes
 *
 * POST /auth/email/request  — send a magic link token
 * POST /auth/email/verify   — verify token and return session
 *
 * Email delivery requires external provider configuration.
 * In dev mode, the token is returned in the response for testing.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { emailAuthTokens, users } from '../db/schema.js';
import { config } from '../config.js';
import {
  generateAccessToken,
  generateRefreshToken,
  getAccessTokenExpiry,
} from '../plugins/auth.js';
import { getKarmaRank } from '../services/karma.js';
import { buildResendMagicLinkPayload } from '../services/email-payload.js';
import { withGeneratedUniqueUsername } from '../utils/username.js';

// Token is valid for 15 minutes
const TOKEN_TTL_MS = 15 * 60 * 1000;
const RESEND_API_URL = 'https://api.resend.com/emails';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildMagicLink(token: string): string {
  if (!config.auth.magicLinkBaseUrl) {
    throw new Error('Magic link base URL is not configured');
  }

  const url = new URL(config.auth.magicLinkBaseUrl);
  url.searchParams.set('emailToken', token);
  return url.toString();
}

async function sendMagicLinkEmail(email: string, magicLink: string): Promise<void> {
  if (!config.email.resendApiKey || !config.email.fromAddress) {
    throw new Error('Email delivery is not configured');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildResendMagicLinkPayload(email, magicLink)),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail}`);
  }
}

export async function emailAuthRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /auth/email/request — request a magic link
   */
  app.post(
    '/auth/email/request',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Request email magic link',
        description:
          'Generates a magic link token for the given email. ' +
          'In production, delivers via email. In dev mode, returns the token in the response.',
        body: z.object({
          email: z.string().email(),
        }),
        response: {
          200: z.object({
            message: z.string(),
            /** Only present in dev mode */
            token: z.string().optional(),
          }),
          503: z.object({
            error: z.string(),
            message: z.string(),
          }),
          429: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;
      const normalizedEmail = email.toLowerCase().trim();

      // Rate limit: max 3 tokens per email per hour
      const recentTokens = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM email_auth_tokens
        WHERE email = ${normalizedEmail}
          AND created_at > NOW() - INTERVAL '1 hour'
      `);
      const count = Array.from(recentTokens)[0]?.cnt ?? 0;

      if (count >= 3) {
        return reply.status(429).send({
          error: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
        });
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      await db.insert(emailAuthTokens).values({
        email: normalizedEmail,
        token,
        expiresAt,
      });

      const response: { message: string; token?: string } = {
        message: 'If an account with this email exists, a magic link has been sent.',
      };

      // In dev mode, return the token directly for testing
      if (config.isDev === true) {
        response.token = token;
        return response;
      }

      try {
        const magicLink = buildMagicLink(token);
        await sendMagicLinkEmail(normalizedEmail, magicLink);
      } catch (error) {
        app.log.error({ err: error, email: normalizedEmail }, 'Failed to deliver magic link email');
        return reply.status(503).send({
          error: 'EMAIL_DELIVERY_UNAVAILABLE',
          message: 'Email sign-in is not configured for this environment.',
        });
      }

      return response;
    }
  );

  /**
   * POST /auth/email/verify — verify magic link token
   */
  app.post(
    '/auth/email/verify',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Verify email magic link',
        description: 'Validates the token, creates or finds the user, returns a session.',
        body: z.object({
          token: z.string().length(64),
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
      const { token } = request.body;

      // Find valid token
      const tokenRows = await db
        .select()
        .from(emailAuthTokens)
        .where(
          and(
            eq(emailAuthTokens.token, token),
            isNull(emailAuthTokens.usedAt)
          )
        )
        .limit(1);

      const tokenRow = tokenRows[0];

      if (!tokenRow) {
        return reply.status(401).send({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        });
      }

      // Check expiry
      if (new Date() > tokenRow.expiresAt) {
        return reply.status(401).send({
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired. Please request a new one.',
        });
      }

      // Mark token as used
      await db
        .update(emailAuthTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailAuthTokens.id, tokenRow.id));

      // Find or create user
      let user = await db.query.users.findFirst({
        where: eq(users.email, tokenRow.email),
      });

      let isNewUser = false;

      if (!user) {
        isNewUser = true;
        user = await withGeneratedUniqueUsername(async (username) => {
          const [newUser] = await db
            .insert(users)
            .values({
              email: tokenRow.email,
              username,
              displayName: tokenRow.email.split('@')[0],
            })
            .returning();

          return newUser;
        });
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
}

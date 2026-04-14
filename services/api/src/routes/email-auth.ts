/**
 * Email magic link auth routes.
 *
 * Browser verification establishes HTTP-only cookie sessions.
 * Explicit `/auth/token/email/verify` remains available for non-browser token
 * consumers that need bearer tokens.
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
  assertAllowedBrowserOrigin,
  issueBrowserSession,
  issueTokenSession,
} from './auth-session.js';
import { buildResendMagicLinkPayload } from '../services/email-payload.js';
import { withGeneratedUniqueUsername } from '../utils/username.js';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RESEND_API_URL = 'https://api.resend.com/emails';

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

const authErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

type ConsumedEmailTokenResult =
  | {
      error: 'INVALID_TOKEN' | 'TOKEN_EXPIRED';
      message: string;
    }
  | {
      user: typeof users.$inferSelect;
      isNewUser: boolean;
    };

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildMagicLink(token: string): string {
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

async function consumeEmailToken(token: string): Promise<ConsumedEmailTokenResult> {
  const tokenRows = await db
    .select()
    .from(emailAuthTokens)
    .where(and(eq(emailAuthTokens.token, token), isNull(emailAuthTokens.usedAt)))
    .limit(1);

  const tokenRow = tokenRows[0];
  if (!tokenRow) {
    return {
      error: 'INVALID_TOKEN' as const,
      message: 'Invalid or expired token',
    };
  }

  if (new Date() > tokenRow.expiresAt) {
    return {
      error: 'TOKEN_EXPIRED' as const,
      message: 'Token has expired. Please request a new one.',
    };
  }

  await db.update(emailAuthTokens).set({ usedAt: new Date() }).where(eq(emailAuthTokens.id, tokenRow.id));

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

  return { user, isNewUser };
}

export async function emailAuthRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/auth/email/request',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Request email magic link',
        description:
          'Generates a magic link token for the given email. In development the token is also returned in the response.',
        body: z.object({
          email: z.string().email(),
        }),
        response: {
          200: z.object({
            message: z.string(),
            token: z.string().optional(),
          }),
          429: authErrorSchema,
          503: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const normalizedEmail = request.body.email.toLowerCase().trim();

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

      if (config.isDev) {
        response.token = token;
        return response;
      }

      try {
        await sendMagicLinkEmail(normalizedEmail, buildMagicLink(token));
      } catch (error) {
        app.log.error({ err: error, email: normalizedEmail }, 'Failed to deliver magic link email');
        return reply.status(503).send({
          error: 'EMAIL_DELIVERY_UNAVAILABLE',
          message: 'Email sign-in is not configured for this environment.',
        });
      }

      return response;
    },
  );

  app.post(
    '/auth/email/verify',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Verify email magic link for the browser session flow',
        description:
          'Validates the token, establishes the browser cookie session, and returns the authenticated user.',
        body: z.object({
          token: z.string().length(64),
        }),
        response: {
          200: z.object({
            session: browserSessionSchema,
            isNewUser: z.boolean(),
          }),
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

      const result = await consumeEmailToken(request.body.token);
      if ('error' in result) {
        return reply.status(401).send({
          error: result.error,
          message: result.message,
        });
      }

      return {
        session: issueBrowserSession(fastify, reply, result.user),
        isNewUser: result.isNewUser,
      };
    },
  );

  app.post(
    '/auth/token/email/verify',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Verify email magic link for explicit token clients',
        description:
          'Validates the token and returns bearer tokens for non-browser clients.',
        body: z.object({
          token: z.string().length(64),
        }),
        response: {
          200: z.object({
            session: tokenSessionSchema,
            isNewUser: z.boolean(),
          }),
          400: authErrorSchema,
          401: authErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await consumeEmailToken(request.body.token);
      if ('error' in result) {
        return reply.status(401).send({
          error: result.error,
          message: result.message,
        });
      }

      return {
        session: issueTokenSession(fastify, result.user),
        isNewUser: result.isNewUser,
      };
    },
  );
}

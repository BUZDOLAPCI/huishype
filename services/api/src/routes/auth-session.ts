import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { users } from '../db/schema.js';
import { config } from '../config.js';
import {
  clearBrowserSessionCookies,
  issueAuthSession,
  setBrowserSessionCookies,
  type IssuedAuthSession,
} from '../plugins/auth.js';
import { getKarmaRank } from '../services/karma.js';

type UserRecord = typeof users.$inferSelect;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl: string | null;
  karma: number;
  karmaRank: string;
  createdAt: string;
}

export interface BrowserSessionResponse {
  user: SessionUser;
  expiresAt: string;
}

export interface TokenSessionResponse extends BrowserSessionResponse {
  accessToken: string;
  refreshToken: string;
}

export function serializeSessionUser(user: UserRecord): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    profilePhotoUrl: user.profilePhotoUrl,
    karma: user.karma,
    karmaRank: getKarmaRank(user.karma).title,
    createdAt: user.createdAt.toISOString(),
  };
}

function toBrowserSession(user: UserRecord, session: IssuedAuthSession): BrowserSessionResponse {
  return {
    user: serializeSessionUser(user),
    expiresAt: session.accessExpiresAt.toISOString(),
  };
}

export function issueBrowserSession(
  fastify: FastifyInstance,
  reply: FastifyReply,
  user: UserRecord,
): BrowserSessionResponse {
  const session = issueAuthSession(fastify, user.id);
  setBrowserSessionCookies(reply, session);
  return toBrowserSession(user, session);
}

export function issueTokenSession(
  fastify: FastifyInstance,
  user: UserRecord,
): TokenSessionResponse {
  const session = issueAuthSession(fastify, user.id);

  return {
    ...toBrowserSession(user, session),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}

export function clearBrowserSession(reply: FastifyReply): void {
  clearBrowserSessionCookies(reply);
}

export function assertAllowedBrowserOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (config.isDev) {
    return true;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  if (config.web.allowedOrigins.includes(origin)) {
    return true;
  }

  reply.status(403).send({
    error: 'FORBIDDEN_ORIGIN',
    message: 'Origin is not allowed for browser-authenticated requests',
  });
  return false;
}

/**
 * Authentication plugin for Fastify
 * Configures JWT authentication with access and refresh tokens
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import jwtLib from 'jsonwebtoken';
import { config } from '../config.js';

// Extend FastifyInstance to include auth decorators
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
  }
}

// JWT payload types
export interface AccessTokenPayload {
  userId: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  userId: string;
  type: 'refresh';
  jti: string;
  exp?: number;
  iat?: number;
}

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function getCookieOptions(expires: Date): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: config.auth.cookie.sameSite,
    secure: config.auth.cookie.secure,
    domain: config.auth.cookie.domain,
    expires,
  };
}

async function authPlugin(fastify: FastifyInstance) {
  // Register JWT plugin for access tokens
  await fastify.register(jwt, {
    secret: config.auth.jwtSecret,
    cookie: {
      cookieName: config.auth.cookie.accessTokenName,
      signed: false,
    },
    sign: {
      expiresIn: config.auth.accessTokenExpiresIn,
    },
  });

  /**
   * Decorator for routes that require authentication
   * Returns 401 if no valid token is provided
   */
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const decoded = await request.jwtVerify<AccessTokenPayload>();

        if (decoded.type !== 'access') {
          return reply.status(401).send({
            error: 'INVALID_TOKEN_TYPE',
            message: 'Invalid token type',
          });
        }

        request.userId = decoded.userId;
      } catch (_err) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }
    }
  );

  /**
   * Decorator for routes that work with or without authentication
   * Sets request.userId if a valid token is provided, but doesn't fail if not
   */
  fastify.decorate(
    'optionalAuth',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        const authHeader = request.headers.authorization;
        const accessCookie = request.cookies[config.auth.cookie.accessTokenName];
        if ((!authHeader || !authHeader.startsWith('Bearer ')) && !accessCookie) {
          return; // No token, continue without auth
        }

        const decoded = await request.jwtVerify<AccessTokenPayload>();

        if (decoded.type === 'access') {
          request.userId = decoded.userId;
        }
      } catch {
        // Token invalid or expired, continue without auth
        // This is intentional - optionalAuth doesn't fail on bad tokens
      }
    }
  );
}

/**
 * Generate an access token for a user
 */
export function generateAccessToken(fastify: FastifyInstance, userId: string): string {
  const payload: AccessTokenPayload = {
    userId,
    type: 'access',
  };
  return fastify.jwt.sign(payload);
}

export function getRefreshTokenExpiry(token: string): Date {
  const payload = verifyRefreshToken(token);
  if (!payload?.exp) {
    throw new Error('Failed to read refresh token expiry');
  }

  return new Date(payload.exp * 1000);
}

export function issueAuthSession(fastify: FastifyInstance, userId: string): IssuedAuthSession {
  const accessToken = generateAccessToken(fastify, userId);
  const refreshToken = generateRefreshToken(userId);

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: getAccessTokenExpiry(),
    refreshExpiresAt: getRefreshTokenExpiry(refreshToken),
  };
}

export function setBrowserSessionCookies(
  reply: FastifyReply,
  session: IssuedAuthSession,
): void {
  reply.setCookie(
    config.auth.cookie.accessTokenName,
    session.accessToken,
    getCookieOptions(session.accessExpiresAt),
  );
  reply.setCookie(
    config.auth.cookie.refreshTokenName,
    session.refreshToken,
    getCookieOptions(session.refreshExpiresAt),
  );
}

export function clearBrowserSessionCookies(reply: FastifyReply): void {
  const clearOptions = {
    path: '/',
    httpOnly: true,
    sameSite: config.auth.cookie.sameSite,
    secure: config.auth.cookie.secure,
    domain: config.auth.cookie.domain,
  } satisfies CookieSerializeOptions;

  reply.clearCookie(config.auth.cookie.accessTokenName, clearOptions);
  reply.clearCookie(config.auth.cookie.refreshTokenName, clearOptions);
}

export function getRefreshTokenFromRequest(request: FastifyRequest): string | null {
  return request.cookies[config.auth.cookie.refreshTokenName] ?? null;
}

/**
 * Generate a refresh token for a user
 * Uses a separate secret and longer expiration
 */
export function generateRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = {
    userId,
    type: 'refresh',
    jti: randomUUID(),
  };

  // Use jsonwebtoken directly for refresh tokens with different secret
  return jwtLib.sign(payload, config.auth.jwtRefreshSecret, {
    expiresIn: config.auth.refreshTokenExpiresIn,
  });
}

/**
 * Verify a refresh token
 * Returns the payload if valid, null if invalid
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwtLib.verify(token, config.auth.jwtRefreshSecret) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Calculate token expiration time
 */
export function getAccessTokenExpiry(): Date {
  // Parse the expiration string (e.g., '15m', '1h', '7d')
  const expiry = config.auth.accessTokenExpiresIn;
  const match = expiry.match(/^(\d+)([smhd])$/);

  if (!match) {
    // Default to 15 minutes if parsing fails
    return new Date(Date.now() + 15 * 60 * 1000);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let milliseconds: number;
  switch (unit) {
    case 's':
      milliseconds = value * 1000;
      break;
    case 'm':
      milliseconds = value * 60 * 1000;
      break;
    case 'h':
      milliseconds = value * 60 * 60 * 1000;
      break;
    case 'd':
      milliseconds = value * 24 * 60 * 60 * 1000;
      break;
    default:
      milliseconds = 15 * 60 * 1000;
  }

  return new Date(Date.now() + milliseconds);
}

export default fp(authPlugin, {
  name: 'auth',
});

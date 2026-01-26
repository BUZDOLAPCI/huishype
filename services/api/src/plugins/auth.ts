/**
 * Authentication plugin for Fastify
 * Configures JWT authentication with access and refresh tokens
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
}

async function authPlugin(fastify: FastifyInstance) {
  // Register JWT plugin for access tokens
  await fastify.register(jwt, {
    secret: config.auth.jwtSecret,
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
      } catch (err) {
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
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

/**
 * Generate a refresh token for a user
 * Uses a separate secret and longer expiration
 */
export function generateRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = {
    userId,
    type: 'refresh',
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

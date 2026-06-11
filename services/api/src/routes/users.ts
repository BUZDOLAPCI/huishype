/**
 * User profile routes
 * Handles public profiles, authenticated profile management, and guess history
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { and, eq, sql, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, priceGuesses, comments, savedProperties, reactions } from '../db/schema.js';
import { config } from '../config.js';
import { getKarmaRank } from '../services/karma.js';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode, updateUserProfileSchema, usernameSchema } from '@huishype/shared';
import {
  ensureUserExists,
  followUser,
  listFollowers,
  listFollowing,
  normalizeUserSearchQuery,
  searchUsers,
  unfollowUser,
  getFollowRelationshipPayload,
} from '../services/user-follows.js';
import {
  deleteProfilePhotoByUrl,
  ProfilePhotoUploadError,
  uploadUserProfilePhoto,
} from '../services/profile-photo-storage.js';

// --- Constants ---
const DISPLAY_NAME_COOLDOWN_DAYS = 7;
const HANDLE_COOLDOWN_DAYS = 30;
const followRelationshipValues = ['self', 'none', 'following', 'followed_by', 'mutual'] as const;
const profilePhotoSourceBytes =
  Number.isFinite(config.r2.maxProfilePhotoSourceBytes) && config.r2.maxProfilePhotoSourceBytes > 0
    ? config.r2.maxProfilePhotoSourceBytes
    : 5 * 1024 * 1024;
const profilePhotoBodyLimitBytes = Math.ceil(profilePhotoSourceBytes * 1.4) + 1024;
const profilePhotoUploadRateLimitMax = 5;

type UserIdentityUpdateError = {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  detail?: string;
  cause?: unknown;
};

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function changeAvailableAt(lastChangedAt: Date | null, cooldownDays: number): Date | null {
  return lastChangedAt ? addDays(lastChangedAt, cooldownDays) : null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function isInCooldown(lastChangedAt: Date | null, cooldownDays: number, now: Date): Date | null {
  const availableAt = changeAvailableAt(lastChangedAt, cooldownDays);
  return availableAt && now < availableAt ? availableAt : null;
}

function profileIdentityPayload(user: {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  homeCountry: string | null;
  lastDisplayNameChangeAt: Date | null;
  lastUsernameChangeAt: Date | null;
}) {
  const lastDisplayNameChangeAt = isoOrNull(user.lastDisplayNameChangeAt);
  const displayNameChangeAvailableAt = isoOrNull(
    changeAvailableAt(user.lastDisplayNameChangeAt, DISPLAY_NAME_COOLDOWN_DAYS)
  );

  return {
    id: user.id,
    displayName: user.displayName || user.username,
    handle: user.username,
    profilePhotoUrl: user.profilePhotoUrl,
    homeCountry: user.homeCountry ?? null,
    lastDisplayNameChangeAt,
    lastHandleChangeAt: isoOrNull(user.lastUsernameChangeAt),
    displayNameChangeAvailableAt,
    handleChangeAvailableAt: isoOrNull(
      changeAvailableAt(user.lastUsernameChangeAt, HANDLE_COOLDOWN_DAYS)
    ),
    lastNameChangeAt: lastDisplayNameChangeAt,
  };
}

function isUsernameUniqueViolation(error: unknown): boolean {
  const pending: unknown[] = [error];

  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const dbError = candidate as UserIdentityUpdateError;
    if (dbError.code === '23505') {
      const constraintName = dbError.constraint_name ?? dbError.constraint ?? '';
      if (
        constraintName === 'users_username_idx' ||
        constraintName === 'users_username_key' ||
        constraintName === 'users_username_unique' ||
        (dbError.detail ?? '').includes('(username)')
      ) {
        return true;
      }
    }

    if ('cause' in dbError) {
      pending.push(dbError.cause);
    }
  }

  return false;
}

function profilePhotoErrorStatus(error: ProfilePhotoUploadError): 400 | 413 | 503 {
  switch (error.code) {
    case 'PROFILE_PHOTO_TOO_LARGE':
      return 413;
    case 'PROFILE_PHOTO_STORAGE_NOT_CONFIGURED':
    case 'PROFILE_PHOTO_STORAGE_FAILED':
      return 503;
    case 'PROFILE_PHOTO_INVALID_BASE64':
    case 'PROFILE_PHOTO_UNSUPPORTED_TYPE':
    case 'PROFILE_PHOTO_PROCESSING_FAILED':
      return 400;
  }
}

async function getPublicProfilePayload(userId: string, viewerId: string | null) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return null;
  }

  const [guessCountResult, commentCountResult, averageAccuracyResult, relationshipPayload] = await Promise.all([
    db.select({ value: count() }).from(priceGuesses).where(eq(priceGuesses.userId, userId)),
    db
      .select({ value: count() })
      .from(comments)
      .where(sql`${comments.userId} = ${userId} AND ${comments.hiddenAt} IS NULL`),
    db.execute<{ average_accuracy: number | null }>(sql`
      SELECT AVG(
        GREATEST(
          0,
          100 - (
            ABS(pg.guessed_price - ph.price)::numeric
            / NULLIF(ph.price, 0)
          ) * 100
        )
      )::float8 AS average_accuracy
      FROM price_guesses pg
      INNER JOIN LATERAL (
        SELECT sold.price
        FROM price_history sold
        WHERE sold.property_id = pg.property_id
          AND sold.event_type = 'sold'
        ORDER BY sold.price_date DESC, sold.created_at DESC
        LIMIT 1
      ) ph ON true
      WHERE pg.user_id = ${userId}
        AND pg.is_meme_guess = false
    `),
    getFollowRelationshipPayload(userId, viewerId),
  ]);

  const rank = getKarmaRank(user.karma);
  const averageAccuracy = Array.from(averageAccuracyResult)[0]?.average_accuracy ?? null;

  return {
    id: user.id,
    displayName: user.displayName || user.username,
    handle: user.username,
    profilePhotoUrl: user.profilePhotoUrl,
    homeCountry: user.homeCountry ?? null,
    karma: Math.max(0, user.karma),
    karmaRank: rank,
    guessCount: Number(guessCountResult[0].value),
    commentCount: Number(commentCountResult[0].value),
    averageAccuracy:
      averageAccuracy != null ? Math.max(0, Math.min(100, Number(averageAccuracy))) : null,
    joinedAt: user.createdAt.toISOString(),
    followerCount: relationshipPayload.followerCount,
    followingCount: relationshipPayload.followingCount,
    relationship: relationshipPayload.relationship,
  };
}

async function getPublicProfilePayloadByHandle(handle: string, viewerId: string | null) {
  const parsedHandle = usernameSchema.safeParse(handle);

  if (!parsedHandle.success) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, parsedHandle.data),
    columns: { id: true },
  });

  return user ? getPublicProfilePayload(user.id, viewerId) : null;
}

// --- Schema Definitions ---

const karmaRankSchema = z.object({
  title: z.string(),
  level: z.number(),
});

const publicProfileSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
  homeCountry: z.string().nullable(),
  karma: z.number(),
  karmaRank: karmaRankSchema,
  guessCount: z.number(),
  commentCount: z.number(),
  averageAccuracy: z.number().nullable(),
  joinedAt: z.string().datetime(),
  followerCount: z.number(),
  followingCount: z.number(),
  relationship: z.enum(followRelationshipValues),
});

const myProfileSchema = publicProfileSchema.extend({
  email: z.string(),
  hasDisplayName: z.boolean(),
  averageAccuracy: z.number().nullable(),
  savedCount: z.number(),
  likedCount: z.number(),
  lastDisplayNameChangeAt: z.string().datetime().nullable(),
  lastHandleChangeAt: z.string().datetime().nullable(),
  displayNameChangeAvailableAt: z.string().datetime().nullable(),
  handleChangeAvailableAt: z.string().datetime().nullable(),
  lastNameChangeAt: z.string().datetime().nullable().optional(),
});

const followActionResponseSchema = z.object({
  relationship: z.enum(followRelationshipValues),
  followerCount: z.number(),
  followingCount: z.number(),
});

const followListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const followListItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
  followedAt: z.string().datetime(),
  relationship: z.enum(followRelationshipValues),
});

const followListResponseSchema = z.object({
  items: z.array(followListItemSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

const userSearchQuerySchema = z.object({
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const userSearchItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
  relationship: z.enum(followRelationshipValues),
  followerCount: z.number(),
});

const userSearchResponseSchema = z.object({
  items: z.array(userSearchItemSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

const updateProfileResponseSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
  homeCountry: z.string().nullable(),
  lastDisplayNameChangeAt: z.string().datetime().nullable(),
  lastHandleChangeAt: z.string().datetime().nullable(),
  displayNameChangeAvailableAt: z.string().datetime().nullable(),
  handleChangeAvailableAt: z.string().datetime().nullable(),
  lastNameChangeAt: z.string().datetime().nullable().optional(),
});

const profilePhotoUploadBodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1).optional(),
});

const guessHistoryItemSchema = z.object({
  propertyId: z.string().uuid(),
  propertyAddress: z.string(),
  guessAmount: z.number(),
  guessedAt: z.string().datetime(),
  outcome: z.enum(['pending', 'accurate', 'close', 'inaccurate']).nullable(),
  actualPrice: z.number().nullable(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  nextAvailableAt: z.string().datetime().optional(),
});

export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  await fastify.register(rateLimit, {
    global: false,
    max: profilePhotoUploadRateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.userId ?? request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      name: 'RATE_LIMITED',
      error: 'RATE_LIMITED',
      message: 'Too many profile photo uploads. Please try again later.',
    }),
  });

  /**
   * GET /users/search - Search public user profiles
   */
  app.get(
    '/users/search',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['Users'],
        summary: 'Search users',
        querystring: userSearchQuerySchema,
        response: {
          200: userSearchResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { q, limit, offset } = request.query;
      const query = normalizeUserSearchQuery(q);

      if (query.length < 2) {
        return reply.status(400).send({
          error: 'QUERY_TOO_SHORT',
          message: 'Search query must be at least 2 characters.',
        });
      }

      return searchUsers({
        query,
        viewerId: request.userId ?? null,
        limit,
        offset,
      });
    }
  );

  /**
   * GET /users/by-handle/:handle/profile - Public user profile by handle
   */
  app.get(
    '/users/by-handle/:handle/profile',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['Users'],
        summary: 'Get public user profile by handle',
        params: z.object({
          handle: z.string(),
        }),
        response: {
          200: publicProfileSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { handle } = request.params;
      const profile = await getPublicProfilePayloadByHandle(handle, request.userId ?? null);

      if (!profile) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return profile;
    }
  );

  /**
   * GET /users/:id/profile - Public user profile
   */
  app.get(
    '/users/:id/profile',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['Users'],
        summary: 'Get public user profile',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: publicProfileSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const profile = await getPublicProfilePayload(id, request.userId ?? null);

      if (!profile) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return profile;
    }
  );

  /**
   * GET /users/me - Authenticated user's full profile
   */
  app.get(
    '/users/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Get current user profile',
        response: {
          200: myProfileSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      // Count guesses, comments, saved, liked in parallel
      const [
        guessCountResult,
        commentCountResult,
        savedCountResult,
        likedCountResult,
        averageAccuracyResult,
      ] = await Promise.all([
        db.select({ value: count() }).from(priceGuesses).where(eq(priceGuesses.userId, userId)),
        db.select({ value: count() }).from(comments).where(
          sql`${comments.userId} = ${userId} AND ${comments.hiddenAt} IS NULL`
        ),
        db
          .select({ value: count() })
          .from(savedProperties)
          .where(eq(savedProperties.userId, userId)),
        db
          .select({ value: count() })
          .from(reactions)
          .where(
            and(
              eq(reactions.userId, userId),
              eq(reactions.targetType, 'property'),
              eq(reactions.reactionType, 'like')
            )
          ),
        db.execute<{ average_accuracy: number | null }>(sql`
            SELECT AVG(
              GREATEST(
                0,
                100 - (
                  ABS(pg.guessed_price - ph.price)::numeric
                  / NULLIF(ph.price, 0)
                ) * 100
              )
            )::float8 AS average_accuracy
            FROM price_guesses pg
            INNER JOIN LATERAL (
              SELECT sold.price
              FROM price_history sold
              WHERE sold.property_id = pg.property_id
                AND sold.event_type = 'sold'
              ORDER BY sold.price_date DESC, sold.created_at DESC
              LIMIT 1
            ) ph ON true
            WHERE pg.user_id = ${userId}
              AND pg.is_meme_guess = false
          `),
      ]);

      const rank = getKarmaRank(user.karma);
      const averageAccuracy = Array.from(averageAccuracyResult)[0]?.average_accuracy ?? null;
      const followCounts = await getFollowRelationshipPayload(userId, userId);
      const profileIdentity = profileIdentityPayload(user);

      return {
        ...profileIdentity,
        email: user.email,
        hasDisplayName: user.displayName != null && user.displayName.trim().length > 0,
        karma: Math.max(0, user.karma),
        karmaRank: rank,
        guessCount: Number(guessCountResult[0].value),
        commentCount: Number(commentCountResult[0].value),
        averageAccuracy:
          averageAccuracy != null ? Math.max(0, Math.min(100, Number(averageAccuracy))) : null,
        savedCount: Number(savedCountResult[0].value),
        likedCount: Number(likedCountResult[0].value),
        joinedAt: user.createdAt.toISOString(),
        followerCount: followCounts.followerCount,
        followingCount: followCounts.followingCount,
        relationship: 'self' as const,
      };
    }
  );

  app.get(
    '/users/me/followers',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'List followers for the current user',
        querystring: followListQuerySchema,
        response: {
          200: followListResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      return listFollowers(request.userId!, limit, offset);
    }
  );

  app.get(
    '/users/me/following',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'List followed users for the current user',
        querystring: followListQuerySchema,
        response: {
          200: followListResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      return listFollowing(request.userId!, limit, offset);
    }
  );

  app.put(
    '/users/:id/follow',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Follow a user',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: followActionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const followerUserId = request.userId!;
      const { id: followedUserId } = request.params;

      if (followerUserId === followedUserId) {
        return reply.status(400).send({
          error: 'SELF_FOLLOW',
          message: 'You cannot follow yourself.',
        });
      }

      if (!(await ensureUserExists(followedUserId))) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return followUser(followerUserId, followedUserId);
    }
  );

  app.delete(
    '/users/:id/follow',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Unfollow a user',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: followActionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const followerUserId = request.userId!;
      const { id: followedUserId } = request.params;

      if (followerUserId === followedUserId) {
        return reply.status(400).send({
          error: 'SELF_FOLLOW',
          message: 'You cannot unfollow yourself.',
        });
      }

      if (!(await ensureUserExists(followedUserId))) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return unfollowUser(followerUserId, followedUserId);
    }
  );

  /**
   * POST /users/me/profile-photo - Upload profile photo
   */
  app.post(
    '/users/me/profile-photo',
    {
      onRequest: [fastify.authenticate],
      bodyLimit: profilePhotoBodyLimitBytes,
      schema: {
        tags: ['Users'],
        summary: 'Upload profile photo',
        body: profilePhotoUploadBodySchema,
        response: {
          200: updateProfileResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
          413: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: profilePhotoUploadRateLimitMax,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.userId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      let profilePhotoUrl: string;
      try {
        profilePhotoUrl = await uploadUserProfilePhoto({
          userId,
          imageBase64: request.body.imageBase64,
          mimeType: request.body.mimeType,
        });
      } catch (error) {
        if (error instanceof ProfilePhotoUploadError) {
          return reply.status(profilePhotoErrorStatus(error)).send({
            error: error.code,
            message: error.message,
          });
        }

        throw error;
      }

      let updated: Parameters<typeof profileIdentityPayload>[0];
      try {
        [updated] = await db
          .update(users)
          .set({
            profilePhotoUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId))
          .returning({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            profilePhotoUrl: users.profilePhotoUrl,
            homeCountry: users.homeCountry,
            lastDisplayNameChangeAt: users.lastDisplayNameChangeAt,
            lastUsernameChangeAt: users.lastUsernameChangeAt,
          });
      } catch (error) {
        await deleteProfilePhotoByUrl(profilePhotoUrl, userId);
        throw error;
      }

      void deleteProfilePhotoByUrl(user.profilePhotoUrl, userId);

      return profileIdentityPayload(updated);
    }
  );

  /**
   * DELETE /users/me/profile-photo - Remove profile photo
   */
  app.delete(
    '/users/me/profile-photo',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Remove profile photo',
        response: {
          200: updateProfileResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      if (!user.profilePhotoUrl) {
        return profileIdentityPayload(user);
      }

      const [updated] = await db
        .update(users)
        .set({
          profilePhotoUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          profilePhotoUrl: users.profilePhotoUrl,
          homeCountry: users.homeCountry,
          lastDisplayNameChangeAt: users.lastDisplayNameChangeAt,
          lastUsernameChangeAt: users.lastUsernameChangeAt,
        });

      void deleteProfilePhotoByUrl(user.profilePhotoUrl, userId);

      return profileIdentityPayload(updated);
    }
  );

  /**
   * PUT /users/me/profile - Update profile
   */
  app.put(
    '/users/me/profile',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Update user profile',
        body: updateUserProfileSchema,
        response: {
          200: updateProfileResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { displayName, handle, homeCountry } = request.body;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const now = new Date();
      const updates: Record<string, unknown> = {};

      if (displayName !== undefined && displayName !== (user.displayName || user.username)) {
        const cooldownEnd = isInCooldown(
          user.lastDisplayNameChangeAt,
          DISPLAY_NAME_COOLDOWN_DAYS,
          now
        );

        if (cooldownEnd) {
          const nextAvailableAt = cooldownEnd.toISOString();
          return reply.status(429).send({
            error: 'DISPLAY_NAME_COOLDOWN',
            message: `Display name can only be changed once every ${DISPLAY_NAME_COOLDOWN_DAYS} days.`,
            nextAvailableAt,
          });
        }

        updates.displayName = displayName;
        updates.lastDisplayNameChangeAt = now;
      }

      if (handle !== undefined && handle !== user.username) {
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(sql`${users.username} = ${handle} AND ${users.id} <> ${userId}`)
          .limit(1);

        if (existing.length > 0) {
          return reply.status(409).send({
            error: 'HANDLE_TAKEN',
            message: 'That handle is already taken.',
          });
        }

        const cooldownEnd = isInCooldown(user.lastUsernameChangeAt, HANDLE_COOLDOWN_DAYS, now);

        if (cooldownEnd) {
          const nextAvailableAt = cooldownEnd.toISOString();
          return reply.status(429).send({
            error: 'HANDLE_COOLDOWN',
            message: `Handle can only be changed once every ${HANDLE_COOLDOWN_DAYS} days.`,
            nextAvailableAt,
          });
        }

        updates.username = handle;
        updates.lastUsernameChangeAt = now;
      }

      if (homeCountry !== undefined && homeCountry !== (user.homeCountry ?? null)) {
        updates.homeCountry = homeCountry;
      }

      if (Object.keys(updates).length === 0) {
        return profileIdentityPayload(user);
      }

      updates.updatedAt = now;

      try {
        const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          profilePhotoUrl: users.profilePhotoUrl,
          homeCountry: users.homeCountry,
          lastDisplayNameChangeAt: users.lastDisplayNameChangeAt,
          lastUsernameChangeAt: users.lastUsernameChangeAt,
        });

        return profileIdentityPayload(updated);
      } catch (error) {
        if (isUsernameUniqueViolation(error)) {
          return reply.status(409).send({
            error: 'HANDLE_TAKEN',
            message: 'That handle is already taken.',
          });
        }

        throw error;
      }
    }
  );

  /**
   * GET /users/me/guesses - Guess history for authenticated user
   */
  app.get(
    '/users/me/guesses',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Get guess history',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(guessHistoryItemSchema),
            total: z.number(),
            hasMore: z.boolean(),
          }),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const { limit, offset } = request.query;

      // Count total guesses
      const [totalResult] = await db
        .select({ value: count() })
        .from(priceGuesses)
        .where(eq(priceGuesses.userId, userId));
      const total = Number(totalResult.value);

      // Fetch guesses with property address and outcome
      const rows = await db.execute<{
        property_id: string;
        country_code: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        postal_code: string;
        city: string;
        guessed_price: number;
        guessed_at: string;
        sold_price: number | null;
      }>(sql`
        SELECT
          pg.property_id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.postal_code,
          p.city,
          pg.guessed_price,
          pg.created_at AS guessed_at,
          (
            SELECT ph.price
            FROM price_history ph
            WHERE ph.property_id = pg.property_id
              AND ph.event_type = 'sold'
            ORDER BY ph.price_date DESC
            LIMIT 1
          ) AS sold_price
        FROM price_guesses pg
        JOIN properties p ON p.id = pg.property_id
        WHERE pg.user_id = ${userId}
        ORDER BY pg.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const items = Array.from(rows).map((r) => {
        const guessedPrice = Number(r.guessed_price);
        const soldPrice = r.sold_price != null ? Number(r.sold_price) : null;

        let outcome: 'pending' | 'accurate' | 'close' | 'inaccurate' | null = null;
        if (soldPrice !== null) {
          const deviation = Math.abs(guessedPrice - soldPrice) / soldPrice;
          if (deviation <= 0.05) outcome = 'accurate';
          else if (deviation <= 0.2) outcome = 'close';
          else outcome = 'inaccurate';
        } else {
          outcome = 'pending';
        }

        return {
          propertyId: r.property_id,
          propertyAddress: formatDisplayAddress(
            {
              street: r.street,
              houseNumber: r.house_number,
              houseNumberAddition: r.house_number_addition,
              postalCode: r.postal_code,
              city: r.city,
            },
            isValidCountryCode(r.country_code) ? r.country_code : undefined
          ),
          guessAmount: guessedPrice,
          guessedAt: new Date(r.guessed_at).toISOString(),
          outcome,
          actualPrice: soldPrice,
        };
      });

      return {
        items,
        total,
        hasMore: offset + limit < total,
      };
    }
  );
}

/**
 * User profile routes
 * Handles public profiles, authenticated profile management, and guess history
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, sql, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, priceGuesses, comments, savedProperties, reactions } from '../db/schema.js';
import { getKarmaRank } from '../services/karma.js';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode } from '@huishype/shared';
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

// --- Constants ---
const DISPLAY_NAME_COOLDOWN_DAYS = 30;
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 50;
const followRelationshipValues = ['self', 'none', 'following', 'followed_by', 'mutual'] as const;

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
  joinedAt: z.string().datetime(),
  followerCount: z.number(),
  followingCount: z.number(),
  relationship: z.enum(followRelationshipValues),
});

const myProfileSchema = publicProfileSchema.extend({
  email: z.string(),
  averageAccuracy: z.number().nullable(),
  savedCount: z.number(),
  likedCount: z.number(),
  lastNameChangeAt: z.string().datetime().nullable(),
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

const updateProfileSchema = z.object({
  displayName: z.string().min(DISPLAY_NAME_MIN_LENGTH).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  profilePhotoUrl: z.string().url().optional(),
  homeCountry: z
    .string()
    .length(2)
    .toUpperCase()
    .refine((val) => isValidCountryCode(val), {
      message: 'Invalid country code. Must be a supported 2-letter ISO country code.',
    })
    .nullable()
    .optional(),
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
});

export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

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
      const viewerId = request.userId ?? null;

      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!user) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      // Count guesses and comments
      const [guessCountResult] = await db
        .select({ value: count() })
        .from(priceGuesses)
        .where(eq(priceGuesses.userId, id));

      const [commentCountResult] = await db
        .select({ value: count() })
        .from(comments)
        .where(sql`${comments.userId} = ${id} AND ${comments.hiddenAt} IS NULL`);
      const relationshipPayload = await getFollowRelationshipPayload(id, viewerId);

      const rank = getKarmaRank(user.karma);

      return {
        id: user.id,
        displayName: user.displayName || user.username,
        handle: user.username,
        profilePhotoUrl: user.profilePhotoUrl,
        homeCountry: user.homeCountry ?? null,
        karma: Math.max(0, user.karma),
        karmaRank: rank,
        guessCount: Number(guessCountResult.value),
        commentCount: Number(commentCountResult.value),
        joinedAt: user.createdAt.toISOString(),
        followerCount: relationshipPayload.followerCount,
        followingCount: relationshipPayload.followingCount,
        relationship: relationshipPayload.relationship,
      };
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
        db.select({ value: count() }).from(reactions).where(eq(reactions.userId, userId)),
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

      return {
        id: user.id,
        displayName: user.displayName || user.username,
        handle: user.username,
        profilePhotoUrl: user.profilePhotoUrl,
        homeCountry: user.homeCountry ?? null,
        email: user.email,
        karma: Math.max(0, user.karma),
        karmaRank: rank,
        guessCount: Number(guessCountResult[0].value),
        commentCount: Number(commentCountResult[0].value),
        averageAccuracy:
          averageAccuracy != null ? Math.max(0, Math.min(100, Number(averageAccuracy))) : null,
        savedCount: Number(savedCountResult[0].value),
        likedCount: Number(likedCountResult[0].value),
        lastNameChangeAt: user.lastDisplayNameChangeAt?.toISOString() ?? null,
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
   * PUT /users/me/profile - Update profile
   */
  app.put(
    '/users/me/profile',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Update user profile',
        body: updateProfileSchema,
        response: {
          200: z.object({
            id: z.string().uuid(),
            displayName: z.string(),
            profilePhotoUrl: z.string().nullable(),
            homeCountry: z.string().nullable(),
            lastNameChangeAt: z.string().datetime().nullable(),
          }),
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { displayName, profilePhotoUrl, homeCountry } = request.body;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(401).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      // Handle display name change with 30-day cooldown
      if (displayName !== undefined) {
        if (user.lastDisplayNameChangeAt) {
          const cooldownEnd = new Date(user.lastDisplayNameChangeAt);
          cooldownEnd.setDate(cooldownEnd.getDate() + DISPLAY_NAME_COOLDOWN_DAYS);

          if (new Date() < cooldownEnd) {
            return reply.status(429).send({
              error: 'DISPLAY_NAME_COOLDOWN',
              message: `Display name can only be changed once every ${DISPLAY_NAME_COOLDOWN_DAYS} days. Next change available at ${cooldownEnd.toISOString()}`,
            });
          }
        }

        updates.displayName = displayName;
        updates.lastDisplayNameChangeAt = new Date();
      }

      if (profilePhotoUrl !== undefined) {
        updates.profilePhotoUrl = profilePhotoUrl;
      }

      if (homeCountry !== undefined) {
        updates.homeCountry = homeCountry;
      }

      const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning({
        id: users.id,
        displayName: users.displayName,
        profilePhotoUrl: users.profilePhotoUrl,
        homeCountry: users.homeCountry,
        lastDisplayNameChangeAt: users.lastDisplayNameChangeAt,
      });

      return {
        id: updated.id,
        displayName: updated.displayName || user.username,
        profilePhotoUrl: updated.profilePhotoUrl,
        homeCountry: updated.homeCountry ?? null,
        lastNameChangeAt: updated.lastDisplayNameChangeAt?.toISOString() ?? null,
      };
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

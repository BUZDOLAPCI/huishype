/**
 * Activity routes
 *
 * GET /activity — public social events (likes, comments, guesses)
 * GET /users/me/activity — personal activity history (includes saves)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode } from '@huishype/shared';

// --- Schemas ---

const actorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
});

const propertyPayloadSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  thumbnailUrl: z.string().nullable(),
});

const activityItemSchema = z.object({
  id: z.string(),
  eventType: z.enum(['property_like', 'comment', 'price_guess', 'save']),
  actor: actorSchema,
  property: propertyPayloadSchema,
  createdAt: z.string().datetime(),
  /** Optional extra data per event type */
  meta: z.record(z.string(), z.any()).nullable(),
});

const activityResponseSchema = z.object({
  items: z.array(activityItemSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// --- Raw row type ---

interface ActivityRow extends Record<string, unknown> {
  event_id: string;
  event_type: string;
  actor_id: string;
  actor_display_name: string;
  actor_handle: string;
  actor_photo_url: string | null;
  property_id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  postal_code: string;
  city: string;
  thumbnail_url: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

function mapRow(r: ActivityRow) {
  return {
    id: r.event_id,
    eventType: r.event_type as 'property_like' | 'comment' | 'price_guess' | 'save',
    actor: {
      id: r.actor_id,
      displayName: r.actor_display_name,
      handle: r.actor_handle,
      profilePhotoUrl: r.actor_photo_url,
    },
    property: {
      id: r.property_id,
      address: formatDisplayAddress(
        {
          street: r.street,
          houseNumber: r.house_number,
          houseNumberAddition: r.house_number_addition,
          postalCode: r.postal_code,
          city: r.city,
        },
        isValidCountryCode(r.country_code) ? r.country_code : undefined,
      ),
      city: r.city,
      thumbnailUrl: r.thumbnail_url,
    },
    createdAt: new Date(r.created_at).toISOString(),
    meta: r.meta,
  };
}

// --- Routes ---

export async function activityRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /activity — public social activity feed
   * Excludes saves (private).
   */
  app.get(
    '/activity',
    {
      schema: {
        tags: ['activity'],
        summary: 'Get public activity feed',
        description:
          'Recent social events: property likes, comments, and price guesses. ' +
          'Excludes saved/bookmark events (private account state).',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: activityResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;

      const rows = await db.execute<ActivityRow>(sql`
        (
          SELECT
            r.id::text AS event_id,
            'property_like' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            r.created_at,
            NULL::jsonb AS meta
          FROM reactions r
          JOIN users u ON u.id = r.user_id
          JOIN properties p ON p.id = r.target_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
          WHERE r.target_type = 'property' AND r.reaction_type = 'like'
        )
        UNION ALL
        (
          SELECT
            c.id::text AS event_id,
            'comment' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            c.created_at,
            jsonb_build_object('contentPreview', LEFT(c.content, 100)) AS meta
          FROM comments c
          JOIN users u ON u.id = c.user_id
          JOIN properties p ON p.id = c.property_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
        )
        UNION ALL
        (
          SELECT
            pg.id::text AS event_id,
            'price_guess' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            pg.created_at,
            jsonb_build_object('isMemeGuess', pg.is_meme_guess) AS meta
          FROM price_guesses pg
          JOIN users u ON u.id = pg.user_id
          JOIN properties p ON p.id = pg.property_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
        )
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const items = Array.from(rows).map(mapRow);

      return {
        items,
        pagination: {
          limit,
          offset,
          hasMore: items.length === limit,
        },
      };
    }
  );

  /**
   * GET /users/me/activity — personal activity (includes saves)
   */
  app.get(
    '/users/me/activity',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['activity'],
        summary: 'Get personal activity history',
        description: 'All activity by the current user including private save events.',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: activityResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const { limit, offset } = request.query;

      const rows = await db.execute<ActivityRow>(sql`
        (
          SELECT
            r.id::text AS event_id,
            'property_like' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            r.created_at,
            NULL::jsonb AS meta
          FROM reactions r
          JOIN users u ON u.id = r.user_id
          JOIN properties p ON p.id = r.target_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
          WHERE r.target_type = 'property' AND r.reaction_type = 'like' AND r.user_id = ${userId}
        )
        UNION ALL
        (
          SELECT
            c.id::text AS event_id,
            'comment' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            c.created_at,
            jsonb_build_object('contentPreview', LEFT(c.content, 100)) AS meta
          FROM comments c
          JOIN users u ON u.id = c.user_id
          JOIN properties p ON p.id = c.property_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
          WHERE c.user_id = ${userId}
        )
        UNION ALL
        (
          SELECT
            pg.id::text AS event_id,
            'price_guess' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            pg.created_at,
            jsonb_build_object('isMemeGuess', pg.is_meme_guess) AS meta
          FROM price_guesses pg
          JOIN users u ON u.id = pg.user_id
          JOIN properties p ON p.id = pg.property_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
          WHERE pg.user_id = ${userId}
        )
        UNION ALL
        (
          SELECT
            sp.id::text AS event_id,
            'save' AS event_type,
            u.id AS actor_id,
            COALESCE(u.display_name, u.username) AS actor_display_name,
            u.username AS actor_handle,
            u.profile_photo_url AS actor_photo_url,
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.postal_code,
            p.city,
            l.thumbnail_url,
            sp.created_at,
            NULL::jsonb AS meta
          FROM saved_properties sp
          JOIN users u ON u.id = sp.user_id
          JOIN properties p ON p.id = sp.property_id
          LEFT JOIN LATERAL (
            SELECT thumbnail_url FROM listings
            WHERE property_id = p.id
              AND status = 'active'
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
          ) l ON true
          WHERE sp.user_id = ${userId}
        )
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const items = Array.from(rows).map(mapRow);

      return {
        items,
        pagination: {
          limit,
          offset,
          hasMore: items.length === limit,
        },
      };
    }
  );
}

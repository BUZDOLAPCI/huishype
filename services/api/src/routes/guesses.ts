import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, priceGuesses, properties, users } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';

// Schema definitions
const priceGuessSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  userId: z.string().uuid(),
  guessedPrice: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const priceGuessWithUserSchema = priceGuessSchema.extend({
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string().nullable(),
    karma: z.number(),
  }),
});

const createGuessSchema = z.object({
  guessedPrice: z.number().positive().describe('The guessed price in euros'),
});

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
});

const guessListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const guessListResponseSchema = z.object({
  data: z.array(priceGuessWithUserSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
  stats: z.object({
    averageGuess: z.number().nullable(),
    medianGuess: z.number().nullable(),
    totalGuesses: z.number(),
    // Weighted FMV will be more sophisticated in production
    estimatedFMV: z.number().nullable(),
  }),
});

// Cooldown period in milliseconds (5 days)
const GUESS_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;

export async function guessRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /properties/:id/guesses - Get all guesses for a property
  typedApp.get(
    '/properties/:id/guesses',
    {
      schema: {
        tags: ['guesses'],
        summary: 'Get price guesses for a property',
        description: 'Get all price guesses submitted for a specific property, with statistics',
        params: propertyParamsSchema,
        querystring: guessListQuerySchema,
        response: {
          200: guessListResponseSchema,
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const { page, limit } = request.query;
      const offset = (page - 1) * limit;

      // Check if property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(priceGuesses)
        .where(eq(priceGuesses.propertyId, propertyId));
      const total = countResult[0]?.count ?? 0;

      // Get guesses with user info
      const results = await db
        .select({
          guess: priceGuesses,
          user: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            karma: users.karma,
          },
        })
        .from(priceGuesses)
        .innerJoin(users, eq(priceGuesses.userId, users.id))
        .where(eq(priceGuesses.propertyId, propertyId))
        .limit(limit)
        .offset(offset)
        .orderBy(priceGuesses.createdAt);

      // Calculate statistics
      const statsResult = await db
        .select({
          average: sql<number>`AVG(guessed_price)::numeric`,
          median: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY guessed_price)::numeric`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(priceGuesses)
        .where(eq(priceGuesses.propertyId, propertyId));

      const stats = statsResult[0];

      return reply.send({
        data: results.map(({ guess, user }) => ({
          id: guess.id,
          propertyId: guess.propertyId,
          userId: guess.userId,
          guessedPrice: Number(guess.guessedPrice),
          createdAt: guess.createdAt.toISOString(),
          updatedAt: guess.updatedAt.toISOString(),
          user,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats: {
          averageGuess: stats?.average ? Number(stats.average) : null,
          medianGuess: stats?.median ? Number(stats.median) : null,
          totalGuesses: stats?.count ?? 0,
          // Simple FMV estimation - in production this would be karma-weighted
          estimatedFMV: stats?.median ? Number(stats.median) : null,
        },
      });
    }
  );

  // POST /properties/:id/guesses - Submit a price guess
  typedApp.post(
    '/properties/:id/guesses',
    {
      schema: {
        tags: ['guesses'],
        summary: 'Submit a price guess',
        description: 'Submit or update a price guess for a property. Updates are subject to a 5-day cooldown period.',
        params: propertyParamsSchema,
        body: createGuessSchema,
        response: {
          200: priceGuessSchema.extend({
            message: z.string(),
          }),
          201: priceGuessSchema.extend({
            message: z.string(),
          }),
          400: z.object({
            error: z.string(),
            message: z.string(),
            cooldownEndsAt: z.string().datetime().optional(),
          }),
          401: z.object({
            error: z.string(),
            message: z.string(),
          }),
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const { guessedPrice } = request.body;

      // TODO: Get userId from authenticated session
      // For now, require userId in headers (placeholder for auth)
      const userId = request.headers['x-user-id'] as string;

      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required. Please log in to submit a guess.',
        });
      }

      // Check if property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      // Check for existing guess
      const existingGuess = await db
        .select()
        .from(priceGuesses)
        .where(
          and(eq(priceGuesses.propertyId, propertyId), eq(priceGuesses.userId, userId))
        )
        .limit(1);

      if (existingGuess.length > 0) {
        const guess = existingGuess[0];
        const cooldownEnd = new Date(guess.updatedAt.getTime() + GUESS_COOLDOWN_MS);

        if (new Date() < cooldownEnd) {
          return reply.status(400).send({
            error: 'COOLDOWN_ACTIVE',
            message: 'You must wait before updating your guess.',
            cooldownEndsAt: cooldownEnd.toISOString(),
          });
        }

        // Update existing guess
        const updated = await db
          .update(priceGuesses)
          .set({
            guessedPrice,
            updatedAt: new Date(),
          })
          .where(eq(priceGuesses.id, guess.id))
          .returning();

        const updatedGuess = updated[0];
        return reply.status(200).send({
          id: updatedGuess.id,
          propertyId: updatedGuess.propertyId,
          userId: updatedGuess.userId,
          guessedPrice: Number(updatedGuess.guessedPrice),
          createdAt: updatedGuess.createdAt.toISOString(),
          updatedAt: updatedGuess.updatedAt.toISOString(),
          message: 'Price guess updated successfully',
        });
      }

      // Create new guess
      const newGuess = await db
        .insert(priceGuesses)
        .values({
          propertyId,
          userId,
          guessedPrice,
        })
        .returning();

      const created = newGuess[0];
      return reply.status(201).send({
        id: created.id,
        propertyId: created.propertyId,
        userId: created.userId,
        guessedPrice: Number(created.guessedPrice),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        message: 'Price guess submitted successfully',
      });
    }
  );
}

// Export types for client usage
export type PriceGuessResponse = z.infer<typeof priceGuessSchema>;
export type PriceGuessListResponse = z.infer<typeof guessListResponseSchema>;
export type CreateGuessRequest = z.infer<typeof createGuessSchema>;

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { getRedisConnection } from '../lib/redis.js';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  version: z.string(),
  uptime: z.number().describe('Server uptime in seconds'),
});

const readinessCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  latencyMs: z.number().nullable(),
  message: z.string().optional(),
});

const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  checks: z.object({
    martin: readinessCheckSchema,
    postgres: readinessCheckSchema,
    redis: readinessCheckSchema,
    projections: readinessCheckSchema,
    resources: readinessCheckSchema,
  }),
});

type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

function readinessStatus(checks: Record<string, ReadinessCheck>): 'ok' | 'degraded' | 'error' {
  if (Object.values(checks).some((check) => check.status === 'error')) {
    return 'error';
  }
  if (Object.values(checks).some((check) => check.status === 'degraded')) {
    return 'degraded';
  }
  return 'ok';
}

async function timeCheck(operation: () => Promise<ReadinessCheck>): Promise<ReadinessCheck> {
  const startedAt = Date.now();
  try {
    const check = await operation();
    return {
      ...check,
      latencyMs: check.latencyMs ?? Date.now() - startedAt,
    };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : 'Unknown readiness failure',
    };
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.martin.readinessTimeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMartin(path: string): Promise<ReadinessCheck> {
  const response = await fetchWithTimeout(new URL(path, config.martin.url).toString());
  return response.ok
    ? { status: 'ok', latencyMs: null }
    : { status: 'error', latencyMs: null, message: `HTTP ${response.status}` };
}

async function checkMapProjections(): Promise<ReadinessCheck> {
  const requiredTableRows = await db.execute<{ name: string; regclass: string | null }>(sql`
    SELECT name, to_regclass(name)::text AS regclass
    FROM (
      VALUES
        ('public.map_public_property_facts'),
        ('public.map_quiet_property_points'),
        ('public.map_public_property_bucket_members'),
        ('public.map_property_actor_activity')
    ) AS required(name)
  `);
  const requiredFunctionRows = await db.execute<{ name: string; regprocedure: string | null }>(sql`
    SELECT name, to_regprocedure(name)::text AS regprocedure
    FROM (
      VALUES
        ('martin_tiles.property_nodes(integer, integer, integer, json)'),
        ('martin_tiles.read_property_nodes(integer, integer, integer, json)'),
        ('martin_tiles.following_property_nodes(integer, integer, integer, json)'),
        ('martin_tiles.validate_map_projections()')
    ) AS required(name)
  `);
  const missing = [
    ...Array.from(requiredTableRows)
      .filter((row) => !row.regclass)
      .map((row) => row.name),
    ...Array.from(requiredFunctionRows)
      .filter((row) => !row.regprocedure)
      .map((row) => row.name),
  ];
  if (missing.length > 0) {
    return {
      status: 'error',
      latencyMs: null,
      message: `Missing projection resources: ${missing.join(', ')}`,
    };
  }

  const validationRows = await db.execute<{ check_name: string; ok: boolean; detail: string }>(sql`
    SELECT check_name, ok, detail
    FROM martin_tiles.validate_map_projections()
  `);
  const failed = Array.from(validationRows).filter((row) => !row.ok);
  if (failed.length > 0) {
    return {
      status: 'error',
      latencyMs: null,
      message: failed.map((row) => `${row.check_name}=${row.detail}`).join('; '),
    };
  }

  const freshnessRows = await db.execute<{
    listing_source_count: number;
    listing_projected_count: number;
    actor_source_count: number;
    actor_projected_count: number;
    source_updated_at: Date | string | null;
    projected_updated_at: Date | string | null;
  }>(sql`
    WITH listing_source AS (
      SELECT
        COUNT(DISTINCT p.id)::int AS source_count,
        MAX(GREATEST(p.updated_at, cl.updated_at, cl.last_reconciled_at, cl.last_seen_at)) AS source_updated_at
      FROM canonical_listings cl
      INNER JOIN properties p ON p.id = cl.property_id
      WHERE p.status = 'active'
        AND p.geometry IS NOT NULL
        AND cl.status IN ('active', 'sold', 'rented')
    ),
    actor_source_rows AS (
      SELECT c.property_id, c.user_id AS actor_user_id, 'comment'::text AS activity_kind, c.created_at AS activity_at
      FROM comments c
      INNER JOIN properties p ON p.id = c.property_id
      WHERE p.status = 'active'
        AND p.geometry IS NOT NULL
      UNION ALL
      SELECT r.target_id, r.user_id, 'property_like'::text, r.created_at
      FROM reactions r
      INNER JOIN properties p ON p.id = r.target_id
      WHERE r.target_type = 'property'
        AND r.reaction_type = 'like'
        AND p.status = 'active'
        AND p.geometry IS NOT NULL
      UNION ALL
      SELECT pg.property_id, pg.user_id, 'price_guess'::text, GREATEST(pg.created_at, pg.updated_at)
      FROM price_guesses pg
      INNER JOIN properties p ON p.id = pg.property_id
      WHERE pg.is_meme_guess = FALSE
        AND p.status = 'active'
        AND p.geometry IS NOT NULL
    ),
    actor_source AS (
      SELECT COUNT(*)::int AS source_count, MAX(activity_at) AS source_updated_at
      FROM actor_source_rows
    ),
    source AS (
      SELECT
        listing_source.source_count AS listing_source_count,
        actor_source.source_count AS actor_source_count,
        GREATEST(listing_source.source_updated_at, actor_source.source_updated_at) AS source_updated_at
      FROM listing_source, actor_source
    ),
    projected_public AS (
      SELECT
        COUNT(*) FILTER (
          WHERE active_listing_count > 0 OR completed_listing_count > 0
        )::int AS projected_count,
        MAX(updated_at) AS projected_updated_at
      FROM map_public_property_facts
    ),
    projected_actor AS (
      SELECT COUNT(*)::int AS projected_count, MAX(activity_at) AS projected_updated_at
      FROM map_property_actor_activity
    ),
    projected AS (
      SELECT
        projected_public.projected_count AS listing_projected_count,
        projected_actor.projected_count AS actor_projected_count,
        GREATEST(projected_public.projected_updated_at, projected_actor.projected_updated_at) AS projected_updated_at
      FROM projected_public, projected_actor
    )
    SELECT
      source.listing_source_count,
      projected.listing_projected_count,
      source.actor_source_count,
      projected.actor_projected_count,
      source.source_updated_at,
      projected.projected_updated_at
    FROM source, projected
  `);
  const freshness = Array.from(freshnessRows)[0];
  if (!freshness) {
    return { status: 'error', latencyMs: null, message: 'Projection freshness check returned no rows' };
  }

  const listingSourceCount = Number(freshness.listing_source_count);
  const listingProjectedCount = Number(freshness.listing_projected_count);
  const actorSourceCount = Number(freshness.actor_source_count);
  const actorProjectedCount = Number(freshness.actor_projected_count);
  if (listingProjectedCount !== listingSourceCount) {
    return {
      status: 'error',
      latencyMs: null,
      message: `Listing projection coverage is stale: ${listingProjectedCount}/${listingSourceCount} listing-backed properties projected`,
    };
  }
  if (actorProjectedCount !== actorSourceCount) {
    return {
      status: 'error',
      latencyMs: null,
      message: `Actor projection coverage is stale: ${actorProjectedCount}/${actorSourceCount} activity rows projected`,
    };
  }

  if (freshness.source_updated_at && freshness.projected_updated_at) {
    const sourceUpdatedAt = new Date(freshness.source_updated_at).getTime();
    const projectedUpdatedAt = new Date(freshness.projected_updated_at).getTime();
    if (Number.isFinite(sourceUpdatedAt) && Number.isFinite(projectedUpdatedAt) && projectedUpdatedAt < sourceUpdatedAt) {
      return {
        status: 'error',
        latencyMs: null,
        message: 'Map projections are older than active property data',
      };
    }
  }

  return {
    status: 'ok',
    latencyMs: null,
    message: `Projected ${listingProjectedCount}/${listingSourceCount} listing-backed properties and ${actorProjectedCount}/${actorSourceCount} actor activity rows`,
  };
}

export async function healthRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        description: 'Returns the health status of the API server',
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        version: '0.1.0',
        uptime: process.uptime(),
      });
    }
  );

  typedApp.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Aggregate readiness check',
        description:
          'Checks Martin reachability, core dependencies, projection presence, and Martin resource availability.',
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const [martin, postgres, redis, projections, resources] = await Promise.all([
        timeCheck(() => checkMartin('/tiles/health')),
        timeCheck(async () => {
          await db.execute(sql`SELECT 1`);
          return { status: 'ok', latencyMs: null };
        }),
        timeCheck(async () => {
          const connection = await getRedisConnection();
          await (connection as unknown as { ping: () => Promise<unknown> }).ping();
          return { status: 'ok', latencyMs: null };
        }),
        timeCheck(async () => {
          return checkMapProjections();
        }),
        timeCheck(() => checkMartin('/tiles/catalog')),
      ]);

      const checks = { martin, postgres, redis, projections, resources };
      const status = readinessStatus(checks);
      return reply.status(status === 'ok' ? 200 : 503).send({
        status,
        timestamp: new Date().toISOString(),
        checks,
      });
    }
  );
}

// Export response type for client usage
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

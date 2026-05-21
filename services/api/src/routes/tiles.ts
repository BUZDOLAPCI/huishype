import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  buildFollowingPropertyTileTemplateUrl,
  buildPropertyTileTemplateUrl,
  createDefaultMapFilters,
  getMapFilterSignature,
  mapFiltersQuerySchema,
} from '@huishype/shared';
import {
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_MAP_LAYERS,
  MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS,
  MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS,
  MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS,
  MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
  MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
  MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY,
  MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
  MAP_NODE_COMPLETED_LISTING_RING_WIDTH,
  MAP_NODE_COMPLETED_LISTING_RING_COLOR,
  MAP_NODE_COMPLETED_LISTING_RING_OPACITY,
  MAP_NODE_COMPLETED_LISTING_CORE_COLOR,
  MAP_NODE_COMPLETED_LISTING_CORE_OPACITY,
  MAP_NODE_NON_LISTING_OUTLINE_WIDTH,
  MAP_NODE_NON_LISTING_OUTLINE_COLOR,
  MAP_NODE_NON_LISTING_OUTLINE_OPACITY,
  MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD,
  MAP_NODE_RECENT_PULSE_SINGLE_COLOR_STOPS,
  MAP_NODE_RECENT_PULSE_CLUSTER_COLOR_STOPS,
  MAP_NODE_RECENT_PULSE_OPACITY_STOPS,
  MAP_NODE_RECENT_PULSE_SINGLE_RADIUS_DELTA_STOPS,
  MAP_NODE_RECENT_PULSE_CLUSTER_RADIUS_DELTA_STOPS,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_FONT_STACK,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_WIDTH,
  MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE,
  type NumericStop,
} from '@huishype/shared/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUCK_VARIANTS, generateDuckCandidates } from '../services/duck-scatter.js';
import { generateTreeCandidates } from '../services/tree-scatter.js';
import huishypeBaseStyle from '../styles/huishype-base-style.json' with { type: 'json' };
import {
  buildFollowingMvtForTile,
  buildMvtForTile,
  buildReadMvtForTile,
  tileToBBox,
} from '../services/property-grouping.js';
import {
  followingMapFiltersQuerySchema,
  parseFollowingMapFiltersQuery,
  parseMapFiltersQuery,
  serializeMapFilterQuery,
} from '../services/map-filters.js';
import {
  getPropertyReadViewerScope,
  resolvePropertyReadViewer,
  type PropertyReadViewer,
} from '../services/property-read-state.js';
import {
  buildPropertyTileEtag,
  PROPERTY_TILE_CACHE_CONTROL,
  PROPERTY_TILE_STALE_CACHE_CONTROL,
  PROPERTY_TILE_TIMEOUT_CACHE_CONTROL,
  publicPropertyTileCache,
  type PublicPropertyTileCacheEntry,
} from '../services/property-tile-cache.js';
import {
  getPropertyTileRuntimeConfig,
  isPropertyTileRecoverableError,
  PropertyTileBudgetExceededError,
  PropertyTileBuildAbortedError,
  propertyTileRuntime,
  type PropertyTileBuildOptions,
  type PropertyTilePayloadBuildResult,
  type PropertyTileRuntimeResult,
  type PropertyTileStageTiming,
} from '../services/property-tile-runtime.js';
import {
  buildPropertyTilePyramidCacheKey,
  getDefaultPropertyTilePyramidSlot,
  getPropertyTilePyramidMaxZoom,
  isDefaultPropertyTilePyramidTileCovered,
  isPropertyTilePyramidTileCoveredByCoverage,
  lookupCurrentPropertyTilePyramidVersion,
  lookupPromotedPropertyTilePyramidTile,
  markPropertyTilePyramidVersionDegraded,
  requestPropertyTilePyramidBuild,
  type CurrentPropertyTilePyramidVersion,
  type PropertyTilePyramidBuildRequest,
  type PropertyTilePyramidCurrentLookup,
  type PropertyTilePyramidTileLookup,
  type PropertyTilePyramidUnavailableStatus,
} from '../services/property-tile-pyramid.js';

/**
 * Vector Tile Route for Density-Aware Property Grouping
 *
 * Implements high-performance Dynamic Vector Tile (MVT) service that efficiently
 * renders properties based on final on-screen density rather than a hard zoom split.
 *
 * Business Logic:
 * - Active nodes may group at any zoom when density requires it
 * - Sparse active areas naturally resolve to singles
 * - Ghost node classes are retained only for legacy transport compatibility
 * - Public tiles emit active/listing-backed/social nodes only
 *
 * Performance:
 * - Uses one canonical tile-local grouping engine shared with nearby fallback
 * - Returns ST_AsMVT (binary PBF format, not GeoJSON)
 * - Tiles are cacheable with short TTL for social activity propagation
 */

// Tile coordinate schema
const tileParamsSchema = z
  .object({
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .superRefine(({ z: tileZ, x, y }, ctx) => {
    const maxTileCoord = Math.pow(2, tileZ);
    if (x >= maxTileCoord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x'],
        message: `x must be less than ${maxTileCoord} for zoom ${tileZ}`,
      });
    }
    if (y >= maxTileCoord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['y'],
        message: `y must be less than ${maxTileCoord} for zoom ${tileZ}`,
      });
    }
  });

// Font file path schema
const fontParamsSchema = z.object({
  fontstack: z.string(),
  range: z.string().regex(/^\d+-\d+\.pbf$/),
});

const ACTIVE_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.active;

// 3D Buildings configuration
const BUILDINGS_3D_CONFIG = {
  minZoom: 15,
  colors: {
    // Neutral base — shader overrides with per-building hash-based beige palette
    base: '#F0E8DC',
  },
  opacity: 1.0,
  heightMultiplier: 1.0,
};

// OSM building tile serving configuration
const BUILDINGS_TILE_CONFIG = {
  minZoom: 15, // match BUILDINGS_3D_CONFIG.minZoom — no need to serve below 3D threshold
  maxZoom: 17, // beyond z17, tiles are detailed enough (MapLibre overzooms)
};

// Resolve the fonts directory relative to this file.
// In dev (tsx) __dirname isn't available with ESM, so derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// fonts/ lives at services/api/fonts/ — two levels up from src/routes/
const FONTS_DIR = join(__dirname, '..', '..', 'fonts');
// sprites/ lives at services/api/sprites/ — two levels up from src/routes/
const SPRITES_DIR = join(__dirname, '..', '..', 'sprites');

// Sprite file params schema
const spriteParamsSchema = z.object({
  filename: z.string().regex(/^ofm(@2x)?\.(json|png)$/),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const tileJsonResponseSchema = z.object({
  tilejson: z.string(),
  name: z.string(),
  description: z.string(),
  tiles: z.array(z.string()),
  minzoom: z.number(),
  maxzoom: z.number(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const TREE_TILE_CACHE_CONTROL = 'public, max-age=3600';
const DUCK_TILE_CACHE_CONTROL = 'public, max-age=3600';
const BUILDING_TILE_CACHE_CONTROL = 'public, max-age=86400';
let loggedMissingWatercoverForDuckTiles = false;
let treeLandcoverSourceCache:
  | {
      tableName: 'tree_landcover' | 'landcover';
      excludeWatercover: boolean;
    }
  | null = null;
const OPENFREEMAP_VECTOR_SOURCE = {
  type: 'vector',
  tiles: ['https://tiles.openfreemap.org/planet/20260506_001001_pt/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.05113, 180, 85.05113],
  attribution:
    '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a> | <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a>',
} satisfies Record<string, unknown>;
const pendingDefaultPropertyTileSnapshotRefreshes = new Set<Promise<unknown>>();

type PropertyTilePyramidRouteService = {
  getMaxZoom: typeof getPropertyTilePyramidMaxZoom;
  lookupCurrentVersion: typeof lookupCurrentPropertyTilePyramidVersion;
  lookupTile: typeof lookupPromotedPropertyTilePyramidTile;
  isTileCovered: typeof isDefaultPropertyTilePyramidTileCovered;
  markVersionDegraded: typeof markPropertyTilePyramidVersionDegraded;
  requestBuild: typeof requestPropertyTilePyramidBuild;
};

const defaultPropertyTilePyramidRouteService: PropertyTilePyramidRouteService = {
  getMaxZoom: getPropertyTilePyramidMaxZoom,
  lookupCurrentVersion: lookupCurrentPropertyTilePyramidVersion,
  lookupTile: lookupPromotedPropertyTilePyramidTile,
  isTileCovered: isDefaultPropertyTilePyramidTileCovered,
  markVersionDegraded: markPropertyTilePyramidVersionDegraded,
  requestBuild: requestPropertyTilePyramidBuild,
};

let propertyTilePyramidRouteService: PropertyTilePyramidRouteService =
  defaultPropertyTilePyramidRouteService;

export async function waitForPendingDefaultPropertyTileSnapshotRefreshesForTests(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    return;
  }

  await new Promise<void>((resolve) => setImmediate(resolve));
  while (pendingDefaultPropertyTileSnapshotRefreshes.size > 0) {
    await Promise.allSettled(Array.from(pendingDefaultPropertyTileSnapshotRefreshes));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function resetPropertyTileCacheForTests(): void {
  publicPropertyTileCache.clear();
  propertyTileRuntime.resetForTests();
  propertyTilePyramidRouteService = defaultPropertyTilePyramidRouteService;
  treeLandcoverSourceCache = null;
}

export function setPropertyTilePyramidServiceForTests(
  service: Partial<PropertyTilePyramidRouteService>
): void {
  if (process.env.NODE_ENV !== 'test') {
    return;
  }

  propertyTilePyramidRouteService = {
    ...defaultPropertyTilePyramidRouteService,
    ...service,
  };
}

function buildReadPropertyTileTemplateUrl(
  baseUrl: string,
  filters: ReturnType<typeof parseMapFiltersQuery>
): string {
  const query = serializeMapFilterQuery(filters);
  return `${baseUrl}/tiles/properties/read/{z}/{x}/{y}.pbf${query ? `?${query}` : ''}`;
}

function createRequestAbortSignal(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!reply.raw.writableEnded) {
      controller.abort();
    }
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', abort);
  controller.signal.addEventListener(
    'abort',
    () => {
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    },
    { once: true }
  );
  return controller.signal;
}

function tileHeaderValue(ms: number): string {
  return `${Math.max(0, Math.round(ms))}ms`;
}

function isConditionalMatch(request: FastifyRequest, etag: string): boolean {
  const header = request.headers['if-none-match'];
  const rawValidators = Array.isArray(header) ? header : header == null ? [] : [header];
  const current = normalizeEntityTag(etag);

  for (const rawHeader of rawValidators) {
    for (const validator of splitEntityTagHeader(rawHeader)) {
      if (validator === '*') {
        return true;
      }
      if (normalizeEntityTag(validator) === current) {
        return true;
      }
    }
  }

  return false;
}

function splitEntityTagHeader(header: string): string[] {
  return header
    .split(',')
    .map((validator) => validator.trim())
    .filter(Boolean);
}

function normalizeEntityTag(etag: string): string {
  const trimmed = etag.trim();
  return trimmed.replace(/^W\//i, '');
}

function buildPayloadResult(payloadBuffer: Buffer): PropertyTilePayloadBuildResult {
  const payload = payloadBuffer.length > 0 ? payloadBuffer : null;
  return {
    payload,
    statusCode: payload ? 200 : 204,
  };
}

function sendTimeoutEmptyTile(
  reply: FastifyReply,
  runtimeResult: Pick<
    PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
    'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
  >,
  vary?: string
) {
  if (vary) {
    reply.header('Vary', vary);
  }
  return reply
    .header('Cache-Control', PROPERTY_TILE_TIMEOUT_CACHE_CONTROL)
    .header('X-Tile-Generation-Time', tileHeaderValue(runtimeResult.generationTimeMs))
    .header('X-Tile-Cache', 'timeout-empty')
    .header('X-Tile-Coalesced', String(runtimeResult.coalesced))
    .header('X-Tile-Queue-Time', tileHeaderValue(runtimeResult.queueTimeMs))
    .header('X-Tile-Budget-Ms', String(runtimeResult.budgetMs))
    .status(204)
    .send();
}

function sendPublicTileEntry(
  request: FastifyRequest,
  reply: FastifyReply,
  entry: PublicPropertyTileCacheEntry,
  source: 'hit' | 'miss' | 'stale' | 'precomputed',
  runtime: Pick<
    PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
    'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
  >,
  options: { honorConditional?: boolean } = {}
) {
  const cacheControl =
    source === 'stale' ? PROPERTY_TILE_STALE_CACHE_CONTROL : PROPERTY_TILE_CACHE_CONTROL;
  const honorConditional = options.honorConditional ?? true;
  const baseReply = reply
    .header('Cache-Control', cacheControl)
    .header('ETag', entry.etag)
    .header('X-Tile-Generation-Time', tileHeaderValue(runtime.generationTimeMs))
    .header('X-Tile-Cache', source)
    .header('X-Tile-Coalesced', String(runtime.coalesced))
    .header('X-Tile-Queue-Time', tileHeaderValue(runtime.queueTimeMs))
    .header('X-Tile-Budget-Ms', String(runtime.budgetMs));

  if (honorConditional && isConditionalMatch(request, entry.etag)) {
    return baseReply.status(304).send();
  }

  if (entry.statusCode === 204) {
    return baseReply.status(204).send();
  }

  return baseReply.header('Content-Type', 'application/x-protobuf').send(entry.payload);
}

async function shouldHonorCurrentPyramidConditionalRequest(input: {
  request: FastifyRequest;
  entry: PublicPropertyTileCacheEntry;
  slot: ReturnType<typeof getDefaultPropertyTilePyramidSlot>;
  versionId: string;
}): Promise<boolean> {
  if (!isConditionalMatch(input.request, input.entry.etag)) {
    return true;
  }

  try {
    const current = await propertyTilePyramidRouteService.lookupCurrentVersion(input.slot);
    return current.state === 'current' && current.version.versionId === input.versionId;
  } catch (error) {
    if (isPropertyTileRecoverableError(error)) {
      return false;
    }
    throw error;
  }
}

function sendPyramidUnavailableTile(
  reply: FastifyReply,
  input: {
    tileStatus: PropertyTilePyramidUnavailableStatus;
    runtime: Pick<
      PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
      'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
    >;
    buildRequest?: PropertyTilePyramidBuildRequest;
  }
) {
  if (input.buildRequest?.status === 'enqueued') {
    reply.header('X-HuisHype-Tile-Status', 'pyramid-build-enqueued');
  } else if (
    input.buildRequest?.status === 'coalesced' ||
    input.buildRequest?.status === 'backoff'
  ) {
    reply.header('X-HuisHype-Tile-Status', 'pyramid-build-active');
  } else if (input.buildRequest?.status === 'terminal') {
    reply.header('X-HuisHype-Tile-Status', 'pyramid-terminal');
  } else {
    reply.header('X-HuisHype-Tile-Status', input.tileStatus);
  }

  if (input.buildRequest?.versionId) {
    reply.header('X-HuisHype-Pyramid-Candidate-Version', input.buildRequest.versionId);
  }
  if (input.buildRequest?.queueJobId) {
    reply.header('X-HuisHype-Pyramid-Job', input.buildRequest.queueJobId);
  }

  return reply
    .header('Cache-Control', 'no-store')
    .header('X-Tile-Generation-Time', tileHeaderValue(input.runtime.generationTimeMs))
    .header('X-Tile-Cache', 'pyramid-unavailable')
    .header('X-Tile-Coalesced', String(input.runtime.coalesced))
    .header('X-Tile-Queue-Time', tileHeaderValue(input.runtime.queueTimeMs))
    .header('X-Tile-Budget-Ms', String(input.runtime.budgetMs))
    .status(204)
    .send();
}

function sendPyramidUncoveredTile(
  reply: FastifyReply,
  runtime: Pick<
    PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
    'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
  >
) {
  return reply
    .header('Cache-Control', PROPERTY_TILE_CACHE_CONTROL)
    .header('X-HuisHype-Tile-Status', 'pyramid-uncovered')
    .header('X-Tile-Generation-Time', tileHeaderValue(runtime.generationTimeMs))
    .header('X-Tile-Cache', 'pyramid-uncovered')
    .header('X-Tile-Coalesced', String(runtime.coalesced))
    .header('X-Tile-Queue-Time', tileHeaderValue(runtime.queueTimeMs))
    .header('X-Tile-Budget-Ms', String(runtime.budgetMs))
    .status(204)
    .send();
}

async function requestPyramidBuildForTileRoute(
  request: FastifyRequest,
  input: {
    reason: string;
    slot: ReturnType<typeof getDefaultPropertyTilePyramidSlot>;
    z: number;
    x: number;
    y: number;
  }
): Promise<PropertyTilePyramidBuildRequest | undefined> {
  try {
    return await propertyTilePyramidRouteService.requestBuild({
      reason: input.reason,
      slot: input.slot,
    });
  } catch (error) {
    request.log.warn(
      {
        err: error,
        reason: input.reason,
        z: input.z,
        x: input.x,
        y: input.y,
      },
      'Failed to request replacement property tile pyramid build'
    );
    return undefined;
  }
}

async function markPyramidVersionDegradedForTileRoute(
  request: FastifyRequest,
  input: {
    version: CurrentPropertyTilePyramidVersion;
    reason: string;
    details: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await propertyTilePyramidRouteService.markVersionDegraded({
      version: input.version,
      reason: input.reason,
      details: input.details,
      actor: 'tiles-route',
    });
  } catch (error) {
    request.log.warn(
      {
        err: error,
        versionId: input.version.versionId,
        reason: input.reason,
        details: input.details,
      },
      'Failed to mark property tile pyramid version degraded'
    );
  }
}

function isControlledPyramidTileLookupError(error: unknown): boolean {
  if (isPropertyTileRecoverableError(error)) {
    return true;
  }

  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === '22001' ||
    code === '22003' ||
    code === '22P02' ||
    code === '23502' ||
    code === '23503' ||
    code === '23514'
  ) {
    return true;
  }

  const cause = (error as { cause?: unknown } | null)?.cause;
  return Boolean(cause && cause !== error && isControlledPyramidTileLookupError(cause));
}

function sendPrivateTilePayload(
  reply: FastifyReply,
  payloadResult: PropertyTilePayloadBuildResult,
  runtime: Pick<
    PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
    'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
  >,
  vary: string
) {
  const baseReply = reply
    .header('Cache-Control', 'private, no-store')
    .header('Vary', vary)
    .header('X-Tile-Generation-Time', tileHeaderValue(runtime.generationTimeMs))
    .header('X-Tile-Cache', 'miss')
    .header('X-Tile-Coalesced', String(runtime.coalesced))
    .header('X-Tile-Queue-Time', tileHeaderValue(runtime.queueTimeMs))
    .header('X-Tile-Budget-Ms', String(runtime.budgetMs));

  if (payloadResult.statusCode === 204) {
    return baseReply.status(204).send();
  }

  return baseReply.header('Content-Type', 'application/x-protobuf').send(payloadResult.payload);
}

type TileRouteKind = 'public' | 'read' | 'following';
type TileCacheState =
  | 'hit'
  | 'miss'
  | 'stale'
  | 'precomputed'
  | 'timeout-empty'
  | 'pyramid-unavailable'
  | 'pyramid-missing'
  | 'pyramid-uncovered';
type TileOutcomeResult =
  | 'fresh'
  | 'stale'
  | 'precomputed'
  | 'timeout-empty'
  | 'aborted'
  | 'dropped'
  | 'detached-draining'
  | 'reattached'
  | 'error'
  | 'pyramid-unavailable'
  | 'pyramid-missing'
  | 'pyramid-uncovered';
type TileErrorClassification =
  | 'budget_timeout'
  | 'queue_timeout'
  | 'client_aborted'
  | 'transient_db'
  | 'serialization_failure'
  | 'validation'
  | 'auth'
  | 'programmer';

function classifyTileError(
  runtimeResult: PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>
): TileErrorClassification | undefined {
  if (runtimeResult.state === 'timeout') {
    return runtimeResult.generationTimeMs > 0 ? 'budget_timeout' : 'queue_timeout';
  }
  if (runtimeResult.state === 'dropped') {
    return 'queue_timeout';
  }
  if (runtimeResult.state === 'aborted') {
    return 'client_aborted';
  }
  if (runtimeResult.state !== 'error') {
    return undefined;
  }

  if (runtimeResult.error instanceof PropertyTileBudgetExceededError) {
    return 'budget_timeout';
  }
  if (runtimeResult.error instanceof PropertyTileBuildAbortedError) {
    return 'client_aborted';
  }
  if (isPropertyTileRecoverableError(runtimeResult.error)) {
    return 'transient_db';
  }
  if (runtimeResult.error instanceof SyntaxError) {
    return 'serialization_failure';
  }
  return 'programmer';
}

function logTileOutcome(input: {
  request: FastifyRequest;
  routeKind: TileRouteKind;
  z: number;
  x: number;
  y: number;
  filterSignature: string;
  cacheState: TileCacheState;
  result: TileOutcomeResult;
  runtime: Pick<
    PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>,
    'coalesced' | 'queueTimeMs' | 'generationTimeMs' | 'budgetMs'
  > & { runtimeEvent?: string };
  errorClassification?: TileErrorClassification;
  viewerId?: string;
  stageTimings?: PropertyTileStageTiming[];
}): void {
  input.request.log.info(
    {
      routeKind: input.routeKind,
      z: input.z,
      x: input.x,
      y: input.y,
      filterSignature: input.filterSignature,
      cacheState: input.cacheState,
      queueTimeMs: input.runtime.queueTimeMs,
      generationTimeMs: input.runtime.generationTimeMs,
      budgetMs: input.runtime.budgetMs,
      coalesced: input.runtime.coalesced,
      runtimeEvent: input.runtime.runtimeEvent,
      result: input.result,
      errorClassification: input.errorClassification,
      viewerId: input.viewerId,
      stageTimings: input.stageTimings,
    },
    'Property tile outcome'
  );
}

function dynamicTileOutcomeResult(
  runtimeResult: PropertyTileRuntimeResult<PropertyTilePayloadBuildResult>
): TileOutcomeResult {
  if (runtimeResult.runtimeEvent === 'reattached') {
    return 'reattached';
  }
  if (runtimeResult.runtimeEvent === 'detached-draining') {
    return 'detached-draining';
  }
  if (runtimeResult.state === 'completed') {
    return 'fresh';
  }
  if (runtimeResult.state === 'timeout') {
    return 'timeout-empty';
  }
  if (runtimeResult.state === 'dropped') {
    return 'dropped';
  }
  if (runtimeResult.state === 'aborted') {
    return 'aborted';
  }
  return 'error';
}

function readStateIdentityPredicate(viewer: PropertyReadViewer) {
  if ('userId' in viewer) {
    return sql`prs.user_id = ${viewer.userId} AND prs.session_id IS NULL`;
  }

  return sql`prs.session_id = ${viewer.sessionId} AND prs.user_id IS NULL`;
}

function validateStatementTimeoutMs(timeoutMs: number | undefined): number | null {
  if (timeoutMs == null) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return Math.floor(timeoutMs);
}

function assertTileRouteBuildCanContinue(
  options: PropertyTileBuildOptions | undefined,
  stage: string
): void {
  if (options?.signal?.aborted) {
    throw new PropertyTileBuildAbortedError(`Property tile build aborted during ${stage}`);
  }

  const now = Date.now();
  if (options?.runtimeDeadlineMs != null && now > options.runtimeDeadlineMs) {
    throw new PropertyTileBudgetExceededError(
      `Property tile runtime budget exceeded during ${stage}`
    );
  }

  if (options?.runtimeBudgetMs != null && options.runtimeStartedAtMs != null) {
    if (now - options.runtimeStartedAtMs > options.runtimeBudgetMs) {
      throw new PropertyTileBudgetExceededError(
        `Property tile runtime budget exceeded during ${stage}`
      );
    }
  }
}

async function getReadStateScopeForViewer(
  viewer: PropertyReadViewer,
  options?: PropertyTileBuildOptions
): Promise<{ hasReadState: boolean; scope: string }> {
  assertTileRouteBuildCanContinue(options, 'read-state scope lookup preparation');
  const timeoutMs = validateStatementTimeoutMs(options?.statementTimeoutMs);
  options?.markUncancellableStage?.(true);
  const result = await db
    .transaction(async (tx) => {
      if (timeoutMs) {
        await tx.execute(sql`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`);
      }
      return tx.execute<{
        has_read_state: boolean;
        read_version: number | null;
        read_version_updated_at: string | null;
        read_state_count: string | number | null;
        current_read_state_count: string | number | null;
        read_change_version_sum: string | number | null;
        read_last_changed_at: string | null;
      }>(sql`
      WITH read_rows AS (
        SELECT
          prs.property_id,
          prs.seen_change_version,
          COALESCE(pcs.change_version, 0) AS change_version,
          pcs.last_changed_at
        FROM property_read_state prs
        LEFT JOIN property_change_state pcs ON pcs.property_id = prs.property_id
        WHERE ${readStateIdentityPredicate(viewer)}
      )
      SELECT
        EXISTS (
          SELECT 1
          FROM read_rows
          WHERE seen_change_version >= change_version
          LIMIT 1
        ) AS has_read_state,
        (
          SELECT COALESCE(MAX(prsv.version), 0)::bigint
          FROM property_read_state_versions prsv
          WHERE ${
            'userId' in viewer
              ? sql`prsv.user_id = ${viewer.userId} AND prsv.session_id IS NULL`
              : sql`prsv.session_id = ${viewer.sessionId} AND prsv.user_id IS NULL`
          }
        ) AS read_version,
        (
          SELECT MAX(prsv.updated_at)::text
          FROM property_read_state_versions prsv
          WHERE ${
            'userId' in viewer
              ? sql`prsv.user_id = ${viewer.userId} AND prsv.session_id IS NULL`
              : sql`prsv.session_id = ${viewer.sessionId} AND prsv.user_id IS NULL`
          }
        ) AS read_version_updated_at,
        (SELECT COUNT(*)::bigint FROM read_rows) AS read_state_count,
        (
          SELECT COUNT(*)::bigint
          FROM read_rows
          WHERE seen_change_version >= change_version
        ) AS current_read_state_count,
        (SELECT COALESCE(SUM(change_version), 0)::bigint FROM read_rows) AS read_change_version_sum,
        (SELECT MAX(last_changed_at)::text FROM read_rows) AS read_last_changed_at
    `);
    })
    .finally(() => {
      options?.markUncancellableStage?.(false);
    });

  assertTileRouteBuildCanContinue(options, 'read-state scope lookup');
  const row = Array.from(result)[0];
  if (!row?.has_read_state) {
    return { hasReadState: false, scope: 'empty' };
  }

  return {
    hasReadState: true,
    scope: [
      row.read_version ?? 0,
      row.read_version_updated_at ?? 'none',
      row.read_state_count ?? 0,
      row.current_read_state_count ?? 0,
      row.read_change_version_sum ?? 0,
      row.read_last_changed_at ?? 'none',
    ].join(':'),
  };
}

type ReadStateScopeLookupResult = Awaited<ReturnType<typeof getReadStateScopeForViewer>>;

function readStateScopeRuntimeKey(viewerScope: string): string {
  return `read-scope:${viewerScope}`;
}

function isRecoverableRuntimeResult<TResult>(
  runtimeResult: PropertyTileRuntimeResult<TResult>
): boolean {
  return runtimeResult.state !== 'error' || isPropertyTileRecoverableError(runtimeResult.error);
}

async function runReadStateScopeLookup(input: {
  viewer: PropertyReadViewer;
  viewerScope: string;
  zoom: number;
  signal?: AbortSignal;
}): Promise<PropertyTileRuntimeResult<ReadStateScopeLookupResult>> {
  const runtimeConfig = getPropertyTileRuntimeConfig();
  return propertyTileRuntime.run<ReadStateScopeLookupResult>({
    key: readStateScopeRuntimeKey(input.viewerScope),
    zoom: input.zoom,
    budgetMs: runtimeConfig.privateBudgetMs,
    statementTimeoutMs: runtimeConfig.privateBudgetMs,
    signal: input.signal,
    builder: (options) => getReadStateScopeForViewer(input.viewer, options),
  });
}

// --- Sprite manifest + layer filtering ---

// Cached sprite manifest (loaded once from local file)
let cachedSpriteManifest: Set<string> | null = null;

/**
 * Load the @2x sprite manifest from disk and cache the set of available sprite names.
 */
async function getSpriteManifest(): Promise<Set<string>> {
  if (cachedSpriteManifest) return cachedSpriteManifest;
  const manifestPath = join(SPRITES_DIR, 'ofm@2x.json');
  const data = await readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(data) as Record<string, unknown>;
  cachedSpriteManifest = new Set(Object.keys(manifest));
  return cachedSpriteManifest;
}

// MapLibre expression keywords — not sprite names
const EXPRESSION_KEYWORDS = new Set([
  'match',
  'case',
  'coalesce',
  'concat',
  'get',
  'has',
  'in',
  'literal',
  'step',
  'interpolate',
  'linear',
  'exponential',
  'zoom',
  'let',
  'var',
  'all',
  'any',
  'none',
  '!',
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'to-string',
  'to-number',
  'to-boolean',
  'typeof',
  'string',
  'number',
  'boolean',
  'image',
  'format',
  'number-format',
  'at',
  'length',
  'slice',
  'index-of',
]);

/**
 * Detect if an icon-image expression is data-driven (resolves to
 * feature property values at runtime, e.g. ["get", "class"]).
 */
function isDataDriven(expr: unknown): boolean {
  if (!Array.isArray(expr)) return false;
  const op = expr[0];
  if (op === 'get' || op === 'to-string') return true;
  return expr.some((child: unknown) => Array.isArray(child) && isDataDriven(child));
}

/**
 * Filter/patch layers that reference missing sprites.
 * - Plain string icon-image: drop layer if sprite missing
 * - Data-driven expression: wrap with ['coalesce', ['image', expr], '']
 * - Static expression: drop layer if ALL referenced sprites are missing
 */
function filterLayersForMissingSprites(
  layers: Array<Record<string, unknown>>,
  availableSprites: Set<string>
): Array<Record<string, unknown>> {
  return layers
    .map((layer) => {
      if (layer.type !== 'symbol') return layer;
      const layout = layer.layout as Record<string, unknown> | undefined;
      if (!layout) return layer;
      const iconImage = layout['icon-image'];
      if (!iconImage) return layer;

      // Case 1: Plain string icon-image — drop layer if sprite missing
      if (typeof iconImage === 'string') {
        return availableSprites.has(iconImage) ? layer : null;
      }

      // Case 2: Expression-based icon-image
      if (Array.isArray(iconImage)) {
        if (isDataDriven(iconImage)) {
          layout['icon-image'] = ['coalesce', ['image', iconImage], ''];
          return layer;
        }

        // Static expression — extract literal sprite references
        const spriteRefs: string[] = [];
        const walk = (node: unknown) => {
          if (typeof node === 'string' && !EXPRESSION_KEYWORDS.has(node)) {
            spriteRefs.push(node);
          } else if (Array.isArray(node)) {
            node.forEach(walk);
          }
        };
        walk(iconImage);

        // If ALL referenced sprites are missing, drop the layer
        if (spriteRefs.length > 0 && spriteRefs.every((ref) => !availableSprites.has(ref))) {
          return null;
        }
      }

      return layer;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

const SHIELD_REF_LENGTH_LAYER_IDS = new Set([
  'highway-shield',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
]);

function patchShieldRefLengthExpression(expression: unknown): unknown {
  if (!Array.isArray(expression)) return expression;

  if (
    expression.length === 3 &&
    expression[0] === '<=' &&
    Array.isArray(expression[1]) &&
    expression[1][0] === 'get' &&
    expression[1][1] === 'ref_length' &&
    expression[2] === 6
  ) {
    return [
      'all',
      ['has', 'ref_length'],
      ['<=', ['to-number', ['get', 'ref_length'], Number.MAX_SAFE_INTEGER], 6],
    ];
  }

  return expression.map((child) => patchShieldRefLengthExpression(child));
}

function patchShieldRefLengthFilters(layers: Array<Record<string, unknown>>): void {
  layers.forEach((layer, index) => {
    if (!SHIELD_REF_LENGTH_LAYER_IDS.has(String(layer.id))) return;
    if (!Array.isArray(layer.filter)) return;

    layers[index] = {
      ...layer,
      filter: patchShieldRefLengthExpression(layer.filter),
    };
  });
}

function isMissingWatercoverTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { cause?: unknown; code?: unknown; message?: unknown };
  if (maybeError.code === '42P01') {
    return true;
  }

  if (maybeError.cause && isMissingWatercoverTableError(maybeError.cause)) {
    return true;
  }

  return (
    typeof maybeError.message === 'string' &&
    maybeError.message.includes('relation "watercover" does not exist')
  );
}

async function getTreeLandcoverSource(): Promise<{
  tableName: 'tree_landcover' | 'landcover';
  excludeWatercover: boolean;
}> {
  if (treeLandcoverSourceCache) {
    return treeLandcoverSourceCache;
  }

  const result = await db.execute<{
    hasTreeLandcover: boolean;
    hasWatercover: boolean;
  }>(sql`
    SELECT
      to_regclass('public.tree_landcover') IS NOT NULL AS "hasTreeLandcover",
      to_regclass('public.watercover') IS NOT NULL AS "hasWatercover"
  `);
  const state = Array.from(result)[0];

  treeLandcoverSourceCache = state?.hasTreeLandcover
    ? { tableName: 'tree_landcover', excludeWatercover: false }
    : { tableName: 'landcover', excludeWatercover: Boolean(state?.hasWatercover) };

  return treeLandcoverSourceCache;
}

/**
 * Convert a CSS color string (rgb, rgba, hsl, hsla) to hex (#RRGGBB).
 * Only converts FULLY OPAQUE colors. Colors with alpha < 1 are left as-is
 * because MapLibre Native doesn't support 8-digit hex (#RRGGBBAA) — it
 * silently ignores them, breaking symbol layers (e.g. cluster count labels).
 * MapLibre Native DOES parse rgba()/hsla() natively, so leaving them untouched
 * is safe.
 */
function cssColorToHex(color: string): string {
  const rgbMatch = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/
  );
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if (a < 1) return color; // Keep rgba() as-is for native compatibility
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  const hslMatch = color.match(
    /^hsla?\(\s*(\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/
  );
  if (hslMatch) {
    const h = parseInt(hslMatch[1], 10) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1;
    if (a < 1) return color; // Keep hsla() as-is for native compatibility

    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return `#${Math.round(r * 255)
      .toString(16)
      .padStart(2, '0')}${Math.round(g * 255)
      .toString(16)
      .padStart(2, '0')}${Math.round(b * 255)
      .toString(16)
      .padStart(2, '0')}`;
  }

  return color;
}

/**
 * Recursively walk a style object and normalize all CSS color function strings
 * (rgb, rgba, hsl, hsla) to hex. Mutates the object in place.
 */
function normalizeCssColors(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string' && /^(rgb|hsl)a?\(/.test(obj[i])) {
        obj[i] = cssColorToHex(obj[i]);
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        normalizeCssColors(obj[i]);
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      if (typeof val === 'string' && /^(rgb|hsl)a?\(/.test(val)) {
        (obj as Record<string, unknown>)[key] = cssColorToHex(val);
      } else if (typeof val === 'object' && val !== null) {
        normalizeCssColors(val);
      }
    }
  }
}

function normalizeTextFontStacks(layers: Array<Record<string, unknown>>): void {
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    const layout = layer.layout as Record<string, unknown> | undefined;
    if (!layout || !Array.isArray(layout['text-font'])) continue;

    const fontStack = layout['text-font'] as unknown[];
    const normalized = fontStack
      .map((font) => {
        if (typeof font !== 'string') return font;
        if (font.includes('Italic')) return 'Noto Sans Italic';
        if (font.includes('Bold') || font.includes('Medium')) return 'Noto Sans Bold';
        return 'Noto Sans Regular';
      })
      .filter((font, index, fonts) => fonts.indexOf(font) === index);

    layout['text-font'] = normalized;
  }
}

/**
 * Positron fill color replacements.
 *
 * Positron uses extremely muted fill colors (2-5 units channel deviation from pure gray).
 * These are perceptible on WebGL with proper gamma correction but indistinguishable from
 * gray on MapLibre Native's OpenGL ES renderer (especially on OLED phone screens).
 *
 * We replace them with clearly visible alternatives from OpenFreeMap Bright style,
 * keeping the overall clean/minimal Positron aesthetic for lines and labels.
 */
const FILL_COLOR_OVERRIDES: Record<string, string> = {
  park: '#d8e8c8', // Bright green (was #e6e9e5 — barely perceptible)
  water: '#aad0e6', // Soft blue (was #c2c8ca — barely perceptible)
  landcover_wood: '#c5d8b5', // Forest green (was #dce0dc — barely perceptible)
};

/**
 * Layers that should use a fill-pattern sprite instead of (or in addition to) fill-color.
 * fill-pattern takes precedence when the sprite is available; fill-color remains as fallback.
 */
const FILL_PATTERN_OVERRIDES: Record<string, string> = {
  water: 'water-pattern',
};

/**
 * Replace near-gray Positron fill colors with visible alternatives.
 * Only modifies layers with known near-gray fills — leaves other layers untouched.
 * Also applies fill-pattern overrides (e.g. water wave texture).
 */
function enhanceFillColors(layers: Array<Record<string, unknown>>): void {
  for (const layer of layers) {
    if (layer.type !== 'fill') continue;
    const colorOverride = FILL_COLOR_OVERRIDES[layer.id as string];
    if (colorOverride) {
      const paint = layer.paint as Record<string, unknown> | undefined;
      if (paint) {
        paint['fill-color'] = colorOverride;
      }
    }
    const patternOverride = FILL_PATTERN_OVERRIDES[layer.id as string];
    if (patternOverride) {
      const paint = layer.paint as Record<string, unknown> | undefined;
      if (paint) {
        paint['fill-pattern'] = patternOverride;
      }
    }
  }
}

/**
 * Flatten zoom-interpolated fill-opacity expressions to simple numeric values.
 *
 * MapLibre Native (v11 beta) has a rendering bug where zoom-interpolated
 * `fill-opacity` expressions (e.g. `['interpolate', ['linear'], ['zoom'], ...]`)
 * cause ALL fill layers in the style to render as flat gray. This happens regardless
 * of color values — even vivid #00FF00 green renders gray when any fill layer
 * has an interpolated opacity expression.
 *
 * The fix: evaluate expressions at a representative zoom level and replace them
 * with the resulting numeric value. This preserves the intended opacity at the
 * typical viewing zoom while avoiding the native rendering bug.
 *
 * Mutates layers in place.
 */
function flattenFillOpacityExpressions(layers: Array<Record<string, unknown>>): void {
  const REPRESENTATIVE_ZOOM = 13; // Default viewing zoom

  for (const layer of layers) {
    if (layer.type !== 'fill') continue;
    const paint = layer.paint as Record<string, unknown> | undefined;
    if (!paint) continue;

    const opacity = paint['fill-opacity'];
    if (!Array.isArray(opacity)) continue;

    // Evaluate the interpolation expression at the representative zoom
    paint['fill-opacity'] = evaluateZoomExpression(opacity, REPRESENTATIVE_ZOOM);
  }
}

/**
 * Evaluate a MapLibre zoom interpolation expression at a given zoom level.
 * Handles both ['interpolate', ['linear'], ['zoom'], ...stops] and
 * ['interpolate', ['exponential', base], ['zoom'], ...stops] expressions.
 * Returns the evaluated numeric value, or 1 as fallback.
 */
function evaluateZoomExpression(expr: unknown[], zoom: number): number {
  if (expr[0] !== 'interpolate' || !Array.isArray(expr[1])) return 1;

  const interpType = expr[1][0] as string;
  const base = interpType === 'exponential' ? (expr[1][1] as number) : 1;

  // Extract zoom stops: pairs of [zoom, value] starting at index 3
  const stops: [number, number][] = [];
  for (let i = 3; i < expr.length; i += 2) {
    if (typeof expr[i] === 'number' && typeof expr[i + 1] === 'number') {
      stops.push([expr[i] as number, expr[i + 1] as number]);
    }
  }

  if (stops.length === 0) return 1;

  // Clamp to stop range
  if (zoom <= stops[0][0]) return stops[0][1];
  if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  // Find surrounding stops
  for (let i = 0; i < stops.length - 1; i++) {
    const [z0, v0] = stops[i];
    const [z1, v1] = stops[i + 1];
    if (zoom >= z0 && zoom <= z1) {
      // Interpolate
      let t = (zoom - z0) / (z1 - z0);
      if (base !== 1) {
        t = (Math.pow(base, t * (z1 - z0)) - 1) / (Math.pow(base, z1 - z0) - 1);
      }
      return v0 + t * (v1 - v0);
    }
  }

  return 1;
}

/**
 * MapLibre Native (v11 beta) rendering bug workaround for fill-extrusion layers:
 * Zoom-interpolated expressions on ANY fill-extrusion paint property
 * (height, base, opacity) cause the entire fill-extrusion layer to not render.
 *
 * The fix: strip the zoom interpolation wrapper and use the value at the
 * highest zoom stop directly. When that value is itself an expression
 * (e.g. ['coalesce', ['get', 'render_height'], 10]), we keep it as-is.
 * When it's a number, we use it as a constant.
 *
 * This sacrifices the "grow from ground" zoom animation on native but
 * preserves correct final building heights and per-building variation.
 *
 * Mutates layers in place.
 */
function flattenFillExtrusionZoomExpressions(layers: Array<Record<string, unknown>>): void {
  const EXTRUSION_PROPS = [
    'fill-extrusion-height',
    'fill-extrusion-base',
    'fill-extrusion-opacity',
  ];

  for (const layer of layers) {
    if (layer.type !== 'fill-extrusion') continue;
    const paint = layer.paint as Record<string, unknown> | undefined;
    if (!paint) continue;

    for (const prop of EXTRUSION_PROPS) {
      const expr = paint[prop];
      if (!Array.isArray(expr)) continue;
      if (expr[0] !== 'interpolate') continue;

      // Extract the value at the highest zoom stop (last pair)
      // Expression format: ['interpolate', [type], ['zoom'], z0, v0, z1, v1, ...]
      const lastValue = expr[expr.length - 1];
      paint[prop] = lastValue;
    }
  }
}

function buildInterpolateExpression<TValue extends number | string>(
  input: unknown,
  stops: ReadonlyArray<readonly [threshold: number, value: TValue]>
): [string, string[], unknown, ...(number | string)[]] {
  const expressionTail = stops.flatMap(([threshold, value]) => [threshold, value]);
  return ['interpolate', ['linear'], input, ...expressionTail];
}

const ACTIVE_CLUSTER_FILL_LAYER_ID = 'property-cluster-fill';
const ACTIVE_CLUSTER_PULSE_LAYER_ID = 'property-cluster-pulse';
const ACTIVE_NODE_FILL_LAYER_ID = 'active-node-fill';
const ACTIVE_NODE_PULSE_LAYER_ID = 'active-node-pulse';

function buildPropertyFieldExpression(field: string, fallback = 0): unknown[] {
  return ['coalesce', ['get', field], fallback];
}

function buildListingShareExpression(): unknown[] {
  const pointCount = buildPropertyFieldExpression('point_count', 1);
  return [
    'case',
    ['>', pointCount, 0],
    ['/', buildPropertyFieldExpression('activeListingCount'), pointCount],
    0,
  ];
}

function buildCompletedListingShareExpression(): unknown[] {
  const pointCount = buildPropertyFieldExpression('point_count', 1);
  return [
    'case',
    ['>', pointCount, 0],
    ['/', buildPropertyFieldExpression('completedListingCount'), pointCount],
    0,
  ];
}

function buildRecentPulseOpacityExpression(): unknown[] {
  return [
    'case',
    [
      'all',
      ['>', buildPropertyFieldExpression('recentSocialCount'), 0],
      [
        '>',
        buildPropertyFieldExpression('recentSocialScoreTotal'),
        MAP_NODE_RECENT_PULSE_SCORE_THRESHOLD,
      ],
    ],
    [
      ...buildInterpolateExpression(
        buildPropertyFieldExpression('recentSocialScoreTotal'),
        MAP_NODE_RECENT_PULSE_OPACITY_STOPS
      ),
    ],
    0,
  ];
}

function buildRecentPulseRadiusExpression(
  baseRadius: unknown,
  deltaStops: readonly NumericStop[]
): unknown[] {
  return [
    '+',
    baseRadius,
    buildInterpolateExpression(buildPropertyFieldExpression('recentSocialScoreTotal'), deltaStops),
  ];
}

/**
 * Build the property layers array for the merged style.
 * These are the canonical layer definitions — both web and native clients
 * consume them from /tiles/style.json.
 *
 * Final layer IDs:
 *   property-clusters, property-cluster-fill, property-cluster-pulse, cluster-count,
 *   active-nodes, active-node-fill, active-node-pulse,
 *   active-nodes
 */
function buildPropertyLayers(): Array<Record<string, unknown>> {
  const activeClusterRadius = ACTIVE_FOOTPRINT.clusterRadiusPx;
  const activeNodeRadius = ACTIVE_FOOTPRINT.singleRadiusPx;
  const activeListingCount = buildPropertyFieldExpression('activeListingCount');
  const completedListingCount = buildPropertyFieldExpression('completedListingCount');
  const hasActiveListings = ['>', activeListingCount, 0];
  const hasCompletedListings = ['>', completedListingCount, 0];
  const hasListingRing = ['any', hasActiveListings, hasCompletedListings];
  const listingShare = buildListingShareExpression();
  const completedListingShare = buildCompletedListingShareExpression();
  const hasActiveListingShare = ['>', listingShare, 0];
  const hasCompletedListingShare = ['>', completedListingShare, 0];
  const activeClusterRingWidth = buildInterpolateExpression(
    listingShare,
    MAP_NODE_LISTING_RING_CLUSTER_WIDTH_STOPS
  );
  const activeClusterRingColor = buildInterpolateExpression(
    listingShare,
    MAP_NODE_LISTING_RING_CLUSTER_COLOR_STOPS
  );
  const activeClusterRingOpacity = buildInterpolateExpression(
    listingShare,
    MAP_NODE_LISTING_RING_CLUSTER_OPACITY_STOPS
  );
  const activeNodeRingWidth = buildInterpolateExpression(
    buildPropertyFieldExpression('activeListingCount'),
    MAP_NODE_LISTING_RING_SINGLE_WIDTH_STOPS
  );
  const completedAwareClusterRingWidth = [
    'case',
    hasActiveListingShare,
    activeClusterRingWidth,
    hasCompletedListingShare,
    MAP_NODE_COMPLETED_LISTING_RING_WIDTH,
    0,
  ];
  const completedAwareClusterRingColor = [
    'case',
    hasActiveListingShare,
    activeClusterRingColor,
    hasCompletedListingShare,
    MAP_NODE_COMPLETED_LISTING_RING_COLOR,
    MAP_NODE_COMPLETED_LISTING_RING_COLOR,
  ];
  const completedAwareClusterRingOpacity = [
    'case',
    hasActiveListingShare,
    activeClusterRingOpacity,
    hasCompletedListingShare,
    MAP_NODE_COMPLETED_LISTING_RING_OPACITY,
    0,
  ];
  const completedAwareNodeRingWidth = [
    'case',
    hasActiveListings,
    activeNodeRingWidth,
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_RING_WIDTH,
    0,
  ];
  const completedAwareNodeRingColor = [
    'case',
    hasActiveListings,
    buildInterpolateExpression(activeListingCount, MAP_NODE_LISTING_RING_SINGLE_COLOR_STOPS),
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_RING_COLOR,
    MAP_NODE_COMPLETED_LISTING_RING_COLOR,
  ];
  const completedAwareNodeRingOpacity = [
    'case',
    hasActiveListings,
    buildInterpolateExpression(activeListingCount, MAP_NODE_LISTING_RING_SINGLE_OPACITY_STOPS),
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_RING_OPACITY,
    0,
  ];
  const activeCoreColor = [
    'case',
    ['>', buildPropertyFieldExpression('socialCount'), 0],
    MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
    hasActiveListings,
    MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_CORE_COLOR,
    MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
  ];
  const activeClusterCoreColor = [
    'case',
    ['>', buildPropertyFieldExpression('socialCount'), 0],
    MAP_NODE_SOCIAL_ACTIVE_CORE_COLOR,
    hasActiveListings,
    MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_CORE_COLOR,
    MAP_NODE_SOCIAL_IDLE_CORE_COLOR,
  ];
  const activeCoreOpacity = [
    'case',
    ['>', buildPropertyFieldExpression('socialCount'), 0],
    MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY,
    hasActiveListings,
    MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_CORE_OPACITY,
    MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
  ];
  const activeClusterCoreOpacity = [
    'case',
    ['>', buildPropertyFieldExpression('socialCount'), 0],
    MAP_NODE_SOCIAL_ACTIVE_CORE_OPACITY,
    hasActiveListings,
    MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
    hasCompletedListings,
    MAP_NODE_COMPLETED_LISTING_CORE_OPACITY,
    MAP_NODE_SOCIAL_IDLE_CORE_OPACITY,
  ];
  const recentPulseOpacity = buildRecentPulseOpacityExpression();

  return [
    // Recent-social halo for clusters. This stays non-queryable; cluster count and taps
    // still resolve against the canonical queryable ring layer.
    {
      id: ACTIVE_CLUSTER_PULSE_LAYER_ID,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': buildRecentPulseRadiusExpression(
          activeClusterRadius,
          MAP_NODE_RECENT_PULSE_CLUSTER_RADIUS_DELTA_STOPS
        ),
        'circle-color': buildInterpolateExpression(
          buildPropertyFieldExpression('recentSocialCount'),
          MAP_NODE_RECENT_PULSE_CLUSTER_COLOR_STOPS
        ),
        'circle-opacity': recentPulseOpacity,
        'circle-stroke-width': 0,
      },
    },
    // Active cluster listing ring. The outer treatment only communicates listing composition.
    {
      id: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': ['+', activeClusterRadius, completedAwareClusterRingWidth],
        'circle-color': completedAwareClusterRingColor,
        'circle-opacity': completedAwareClusterRingOpacity,
        'circle-stroke-width': 0,
        'circle-stroke-color': completedAwareClusterRingColor,
        'circle-stroke-opacity': completedAwareClusterRingOpacity,
      },
    },
    // Active cluster social core. The fill communicates social composition and intensity.
    {
      id: ACTIVE_CLUSTER_FILL_LAYER_ID,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      paint: {
        'circle-radius': activeClusterRadius,
        'circle-color': activeClusterCoreColor,
        'circle-opacity': activeClusterCoreOpacity,
        'circle-stroke-width': ['case', hasListingRing, 0, MAP_NODE_NON_LISTING_OUTLINE_WIDTH],
        'circle-stroke-color': MAP_NODE_NON_LISTING_OUTLINE_COLOR,
        'circle-stroke-opacity': ['case', hasListingRing, 0, MAP_NODE_NON_LISTING_OUTLINE_OPACITY],
      },
    },
    // Active cluster count labels.
    {
      id: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTER_COUNT,
      type: 'symbol',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'cluster'],
      ],
      layout: {
        'text-field': ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
        'text-font': [...MAP_NODE_ACTIVE_CLUSTER_LABEL_FONT_STACK],
        'text-size': MAP_NODE_ACTIVE_CLUSTER_LABEL_SIZE,
      },
      paint: {
        'text-color': MAP_NODE_ACTIVE_CLUSTER_LABEL_COLOR,
        'text-halo-color': MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_COLOR,
        'text-halo-width': MAP_NODE_ACTIVE_CLUSTER_LABEL_HALO_WIDTH,
      },
    },
    // Recent-social halo for singles. Low passive-view scores stay quiet.
    {
      id: ACTIVE_NODE_PULSE_LAYER_ID,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': buildRecentPulseRadiusExpression(
          activeNodeRadius,
          MAP_NODE_RECENT_PULSE_SINGLE_RADIUS_DELTA_STOPS
        ),
        'circle-color': buildInterpolateExpression(
          buildPropertyFieldExpression('recentSocialCount'),
          MAP_NODE_RECENT_PULSE_SINGLE_COLOR_STOPS
        ),
        'circle-opacity': recentPulseOpacity,
        'circle-stroke-width': 0,
      },
    },
    // Active single listing ring.
    {
      id: PROPERTY_MAP_LAYERS.ACTIVE_NODES,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': ['+', activeNodeRadius, completedAwareNodeRingWidth],
        'circle-color': completedAwareNodeRingColor,
        'circle-opacity': completedAwareNodeRingOpacity,
        'circle-stroke-width': 0,
        'circle-stroke-color': completedAwareNodeRingColor,
        'circle-stroke-opacity': completedAwareNodeRingOpacity,
      },
    },
    // Active single social core.
    {
      id: ACTIVE_NODE_FILL_LAYER_ID,
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      filter: [
        'all',
        ['==', ['get', 'node_class'], 'active'],
        ['==', ['get', 'group_kind'], 'single'],
      ],
      paint: {
        'circle-radius': activeNodeRadius,
        'circle-color': activeCoreColor,
        'circle-opacity': activeCoreOpacity,
        'circle-stroke-width': ['case', hasListingRing, 0, MAP_NODE_NON_LISTING_OUTLINE_WIDTH],
        'circle-stroke-color': MAP_NODE_NON_LISTING_OUTLINE_COLOR,
        'circle-stroke-opacity': ['case', hasListingRing, 0, MAP_NODE_NON_LISTING_OUTLINE_OPACITY],
      },
    },
  ];
}

/**
 * Build 3D buildings fill-extrusion layer definition.
 */
function build3DBuildingsLayer(): Record<string, unknown> {
  return {
    id: '3d-buildings',
    source: 'buildings-source',
    'source-layer': 'buildings',
    type: 'fill-extrusion',
    minzoom: BUILDINGS_3D_CONFIG.minZoom,
    paint: {
      // Per-building color variation is handled in the fragment shader
      // (hash-based warm beige palette) on both web and native. The style
      // only provides a neutral base color that the shader overrides.
      'fill-extrusion-color': BUILDINGS_3D_CONFIG.colors.base,
      // NOTE: MapLibre Native bugs prevent zoom-interpolated expressions and
      // ['id']-based arithmetic on fill-extrusion-height/base. Keep simple.
      // The per-building height variation and grow animation are web-only.
      // NOTE: MapLibre Native needs correct attribute enum order (Color before Height)
      // in shader_defines.hpp to match readDataDrivenPaintProperties template order.
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': BUILDINGS_3D_CONFIG.opacity,
      'fill-extrusion-vertical-gradient': false,
    },
  };
}

/**
 * Build the paper-trees symbol layer shared by web and native rendering.
 * Uses tree-0 through tree-15 sprites from the sprite sheet.
 * Positioned after 3D buildings for visual layering.
 */
function buildPaperTreesLayer(): Record<string, unknown> {
  return {
    id: 'paper-trees',
    type: 'symbol',
    source: 'tree-source',
    'source-layer': 'scattered-trees',
    minzoom: TREE_MIN_ZOOM,
    layout: {
      'icon-image': ['concat', 'tree-', ['to-string', ['get', 'tree_variant']]],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.4, 17, 0.8, 19, 1.2],
      'icon-anchor': 'bottom',
      'icon-offset': [0, 3], // sink trunk into ground for "planted" look
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['*', -1, ['get', 'tree_variant']],
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: {
      'icon-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 0.85, 18, 1],
    },
  };
}

/**
 * Build the paper-ducks symbol layer shared by web and native rendering.
 * Uses duck-0 through duck-15 sprites from the sprite sheet.
 */
function buildPaperDucksLayer(): Record<string, unknown> {
  return {
    id: 'paper-ducks',
    type: 'symbol',
    source: 'duck-source',
    'source-layer': 'scattered-ducks',
    minzoom: DUCK_MIN_ZOOM,
    layout: {
      'icon-image': ['concat', 'duck-', ['to-string', ['get', 'duck_variant']]],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.33, 17, 0.57, 19, 0.825],
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'duck_variant'],
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: {
      'icon-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 0.9, 18, 1],
    },
  };
}

// Tree scatter tile configuration
const TREE_MIN_ZOOM = 15;
const TREE_MAX_ZOOM = 20;
const TREE_VARIANTS = 16;

// Duck scatter tile configuration
const DUCK_MIN_ZOOM = 15;
const DUCK_MAX_ZOOM = 20;
const DUCK_MIN_WATER_AREA_M2 = 600;

export async function tileRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /fonts/:fontstack/:range.pbf
   *
   * Serves self-hosted glyph PBF files for MapLibre text rendering.
   * Replaces the external dependency on demotiles.maplibre.org.
   */
  typedApp.get(
    '/fonts/:fontstack/:range',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get glyph PBF range for a font',
        description:
          'Returns a PBF file containing glyphs for the requested font and Unicode range.',
        params: fontParamsSchema,
      },
    },
    async (request, reply) => {
      const { fontstack, range } = request.params;

      // Sanitise path components to prevent directory traversal
      const requestedFontstacks = fontstack
        .split(',')
        .map((font) => font.replace(/[^a-zA-Z0-9 _-]/g, '').trim())
        .filter(Boolean);
      const safeFontstack = requestedFontstacks.join(',');
      const safeRange = range.replace(/[^0-9-.pbf]/g, '');

      const filePath = join(FONTS_DIR, safeFontstack, safeRange);

      try {
        const data = await readFile(filePath);
        return reply
          .header('Content-Type', 'application/x-protobuf')
          .header('Cache-Control', 'public, max-age=604800, immutable')
          .send(data);
      } catch {
        // Try each member of a composite fontstack in order.
        for (const fallbackFont of requestedFontstacks) {
          if (fallbackFont === safeFontstack) continue;
          const fallbackPath = join(FONTS_DIR, fallbackFont, safeRange);
          try {
            const data = await readFile(fallbackPath);
            return reply
              .header('Content-Type', 'application/x-protobuf')
              .header('Cache-Control', 'public, max-age=604800, immutable')
              .send(data);
          } catch {
            // Try the next font in the stack.
          }
        }
        return reply.status(404).send({ error: 'Font range not found' });
      }
    }
  );

  /**
   * GET /sprites/:filename
   *
   * Serves self-hosted sprite files for MapLibre icon rendering.
   * Only serves files matching ofm*.json and ofm*.png patterns.
   */
  typedApp.get(
    '/sprites/:filename',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get sprite file',
        description: 'Returns a sprite JSON manifest or PNG atlas.',
        params: spriteParamsSchema,
      },
    },
    async (request, reply) => {
      const { filename } = request.params;

      const filePath = join(SPRITES_DIR, filename);
      const contentType = filename.endsWith('.json') ? 'application/json' : 'image/png';

      try {
        const data = await readFile(filePath);
        return reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=3600')
          .send(data);
      } catch {
        return reply.status(404).send({ error: 'Sprite file not found' });
      }
    }
  );

  /**
   * GET /tiles/style.json
   *
   * Returns a MapLibre style JSON that merges the vendored HuisHype base style
   * with our property vector tile source, property layers, and 3D buildings.
   * This is the SINGLE SOURCE OF TRUTH for map styling — both web and native
   * clients consume this endpoint.
   *
   * Cached for 60s to avoid repeated upstream fetches.
   * The cache is cloned before mutation to avoid corrupting the cached object.
   */
  const STYLE_CACHE_TTL = 60_000; // 60 seconds
  let cachedStyle: { data: Record<string, unknown>; fetchedAt: number } | null = null;
  typedApp.get(
    '/tiles/style.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get merged map style with property layers',
        description: 'Returns MapLibre style JSON with base map + property vector tiles.',
      },
    },
    async (request, reply) => {
      const protocol = request.protocol;
      const host = request.host;
      const baseUrl = `${protocol}://${host}`;
      const tileUrl = buildPropertyTileTemplateUrl(baseUrl, createDefaultMapFilters());
      const treeTileUrl = `${baseUrl}/tiles/trees/{z}/{x}/{y}.pbf`;
      const duckTileUrl = `${baseUrl}/tiles/ducks/{z}/{x}/{y}.pbf`;
      const glyphsUrl = `${baseUrl}/fonts/{fontstack}/{range}.pbf`;
      const spriteUrl = `${baseUrl}/sprites/ofm`;
      // Check cache (60s TTL)
      const now = Date.now();
      if (cachedStyle && now - cachedStyle.fetchedAt < STYLE_CACHE_TTL) {
        // Deep-clone the cached style to avoid mutating the shared cache object
        const style = JSON.parse(JSON.stringify(cachedStyle.data)) as Record<string, unknown>;
        // Patch dynamic URLs that depend on the request host
        const sources = style.sources as Record<string, unknown>;
        const propSource = sources['properties-source'] as Record<string, unknown>;
        propSource.tiles = [tileUrl];
        const treeSource = sources['tree-source'] as Record<string, unknown>;
        if (treeSource) treeSource.tiles = [treeTileUrl];
        const duckSource = sources['duck-source'] as Record<string, unknown>;
        if (duckSource) duckSource.tiles = [duckTileUrl];
        const buildingSource = sources['buildings-source'] as Record<string, unknown>;
        if (buildingSource) buildingSource.tiles = [`${baseUrl}/tiles/buildings/{z}/{x}/{y}.pbf`];
        style.glyphs = glyphsUrl;
        style.sprite = spriteUrl;
        return reply.header('Cache-Control', 'public, max-age=60').send(style);
      }

      try {
        const baseStyle = JSON.parse(JSON.stringify(huishypeBaseStyle)) as Record<string, unknown>;

        const sources = { ...(baseStyle.sources as Record<string, unknown>) };
        const layers = [...(baseStyle.layers as Array<Record<string, unknown>>)];

        // OpenFreeMap's shield filters compare `ref_length` numerically even when the
        // attribute is missing, which triggers runtime MapLibre warnings on some roads.
        patchShieldRefLengthFilters(layers);

        // Remove unused raster sources (e.g. ne2_shaded natural earth) that have no
        // corresponding layer. MapLibre Native may still attempt to load/process these,
        // potentially interfering with the vector fill rendering pipeline.
        const layerSources = new Set(layers.map((l) => l.source as string).filter(Boolean));
        for (const srcName of Object.keys(sources)) {
          if (!layerSources.has(srcName)) {
            delete sources[srcName];
          }
        }

        // Resolve bundled TileJSON URL references into inline tile arrays. MapLibre
        // React Native does not resolve style-defined `"url"` sources reliably, and
        // the benchmark path must not fetch external style metadata on request.
        for (const [name, src] of Object.entries(sources)) {
          const source = src as Record<string, unknown>;
          if (source.type === 'vector' && typeof source.url === 'string' && !source.tiles) {
            sources[name] = { ...OPENFREEMAP_VECTOR_SOURCE };
          }
        }

        // Override glyphs URL to use self-hosted fonts
        baseStyle.glyphs = glyphsUrl;

        // Override sprite URL to use self-hosted sprites
        baseStyle.sprite = spriteUrl;

        // Add property vector tile source
        sources['properties-source'] = {
          type: 'vector',
          tiles: [tileUrl],
          minzoom: 0,
          maxzoom: 22,
        };

        // Add tree scatter tile source
        sources['tree-source'] = {
          type: 'vector',
          tiles: [treeTileUrl],
          minzoom: TREE_MIN_ZOOM,
          maxzoom: TREE_MAX_ZOOM,
        };

        // Add duck scatter tile source
        sources['duck-source'] = {
          type: 'vector',
          tiles: [duckTileUrl],
          minzoom: DUCK_MIN_ZOOM,
          maxzoom: DUCK_MAX_ZOOM,
        };

        // Add OSM building tile source
        const buildingTileUrl = `${baseUrl}/tiles/buildings/{z}/{x}/{y}.pbf`;
        sources['buildings-source'] = {
          type: 'vector',
          tiles: [buildingTileUrl],
          minzoom: BUILDINGS_TILE_CONFIG.minZoom,
          maxzoom: BUILDINGS_TILE_CONFIG.maxZoom,
        };

        // Hide 2D building fill at zoom levels where 3D buildings appear.
        // Previously used a fill-opacity interpolation expression, but MapLibre Native
        // (v11 beta) has a rendering bug where ANY zoom-interpolated fill-opacity expression
        // causes ALL fill layers to render as gray. Using maxzoom instead — the transition
        // from 2D to 3D is abrupt but avoids the bug entirely.
        layers.forEach((layer, index) => {
          const isBuilding =
            layer.id?.toString().includes('building') && layer['source-layer'] === 'building';

          if (isBuilding && layer.type === 'fill') {
            layers[index] = {
              ...layer,
              maxzoom: BUILDINGS_3D_CONFIG.minZoom,
            };
          }
        });

        // Find label layer to insert 3D buildings below
        const labelLayerIndex = layers.findIndex(
          (layer) =>
            layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']
        );

        // Insert 3D buildings layer below labels (or at end if no label layer found)
        const buildings3DLayer = build3DBuildingsLayer();
        if (labelLayerIndex !== -1) {
          layers.splice(labelLayerIndex, 0, buildings3DLayer);
        } else {
          layers.push(buildings3DLayer);
        }

        // Add property layers on top
        layers.push(...buildPropertyLayers());

        // Filter/patch layers that reference missing sprites.
        // This runs once per cache miss — the sprite manifest is cached in memory.
        let filteredLayers = layers;
        try {
          const availableSprites = await getSpriteManifest();
          filteredLayers = filterLayersForMissingSprites(layers, availableSprites);
        } catch (spriteErr) {
          app.log.warn(
            spriteErr,
            'Failed to load sprite manifest for layer filtering — keeping all layers'
          );
        }

        // MapLibre Native (v11 beta) rendering bug workaround:
        // Zoom-interpolated fill-opacity expressions (e.g. ['interpolate', ['linear'], ['zoom'], ...])
        // cause ALL fill layers to render as gray. Flattening these to simple numeric values
        // fixes the rendering. We evaluate each expression at a representative zoom (z13) or
        // use the expression's max value.
        flattenFillOpacityExpressions(filteredLayers);

        // Same bug class for fill-extrusion layers: zoom-interpolated expressions
        // on height/base/opacity cause the layer to not render at all.
        flattenFillExtrusionZoomExpressions(filteredLayers);

        normalizeTextFontStacks(filteredLayers);

        // Replace Positron's near-gray fill colors with visible alternatives.
        // Positron uses fills that deviate only 2-5 units from pure gray, which
        // are perceptible on WebGL but invisible on mobile GPU renderers.
        enhanceFillColors(filteredLayers);

        // Add paper symbol layers AFTER sprite filtering to preserve
        // the raw concat expression (coalesce+image wrapper breaks on native).
        // Both web and native render the server-provided symbol layers directly.
        const buildings3DIndex = filteredLayers.findIndex((l) => l.id === '3d-buildings');
        const paperTreesLayer = buildPaperTreesLayer();
        const paperDucksLayer = buildPaperDucksLayer();
        if (buildings3DIndex !== -1) {
          filteredLayers.splice(buildings3DIndex + 1, 0, paperTreesLayer);
          filteredLayers.splice(buildings3DIndex + 2, 0, paperDucksLayer);
        } else {
          filteredLayers.push(paperTreesLayer);
          filteredLayers.push(paperDucksLayer);
        }

        const merged = {
          ...baseStyle,
          sources,
          layers: filteredLayers,
          // Explicit light configuration for 3D buildings.
          // MapLibre GL JS defaults match these, but MapLibre Native may use
          // different defaults, causing buildings to render too dark.
          light: {
            anchor: 'map',
            color: '#FFF6EA',
            intensity: 0.2,
            position: [1.15, 240, 45],
          },
        };

        // Normalize CSS color functions (rgb, rgba, hsl, hsla) to hex.
        // MapLibre GL JS handles these fine, but keeping hex for consistency.
        normalizeCssColors(merged);

        cachedStyle = { data: merged, fetchedAt: now };

        return reply.header('Cache-Control', 'public, max-age=60').send(merged);
      } catch (err) {
        app.log.error(err, 'Failed to build base style');
        return reply.status(502).send({ error: 'Failed to build merged style' });
      }
    }
  );

  /**
   * GET /tiles/properties.json
   *
   * Returns TileJSON metadata for the property vector tiles.
   * Used by MapLibre native to discover tile URLs.
   */
  typedApp.get(
    '/tiles/properties.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get property tile metadata (TileJSON)',
        description: 'Returns TileJSON 2.1.0 metadata for property vector tiles.',
        querystring: mapFiltersQuerySchema,
        response: {
          200: tileJsonResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Build the tile URL using the request's host (includes port)
      const protocol = request.protocol;
      const host = request.host; // .host includes port, .hostname does not
      const filters = parseMapFiltersQuery(request.query);
      const tileUrl = buildPropertyTileTemplateUrl(`${protocol}://${host}`, filters);

      return reply.send({
        tilejson: '2.1.0',
        name: 'HuisHype Properties',
        description: 'Property data with clustering',
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: 22,
        bounds: [-180, -85, 180, 85],
      });
    }
  );

  typedApp.get(
    '/tiles/following/properties.json',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['tiles'],
        summary: 'Get Following property tile metadata (TileJSON)',
        description:
          'Returns TileJSON 2.1.0 metadata for authenticated Following property vector tiles.',
        querystring: followingMapFiltersQuerySchema,
        response: {
          200: tileJsonResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const protocol = request.protocol;
      const host = request.host;
      const filters = parseFollowingMapFiltersQuery(request.query);
      const tileUrl = buildFollowingPropertyTileTemplateUrl(`${protocol}://${host}`, filters);

      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Authorization')
        .send({
          tilejson: '2.1.0',
          name: 'HuisHype Following Properties',
          description: 'Personalized grouped property data from followed-user qualifying activity',
          tiles: [tileUrl],
          minzoom: 0,
          maxzoom: 22,
          bounds: [-180, -85, 180, 85],
        });
    }
  );

  typedApp.get(
    '/tiles/properties/read.json',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['tiles'],
        summary: 'Get read property tile metadata (TileJSON)',
        description:
          'Returns private TileJSON metadata for viewer-specific read-state property overlay tiles.',
        querystring: mapFiltersQuerySchema,
        response: {
          200: tileJsonResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );

      if (!viewer) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'Authenticated user or x-session-id header is required.',
        });
      }

      const protocol = request.protocol;
      const host = request.host;
      const filters = parseMapFiltersQuery(request.query);
      const tileUrl = buildReadPropertyTileTemplateUrl(`${protocol}://${host}`, filters);
      const viewerScope = getPropertyReadViewerScope(viewer);
      let readStateScope: { hasReadState: boolean; scope: string };
      const readScopeRuntime = await runReadStateScopeLookup({
        viewer,
        viewerScope,
        zoom: 22,
        signal: createRequestAbortSignal(request, reply),
      });
      if (readScopeRuntime.state === 'completed' && readScopeRuntime.publishable) {
        readStateScope = readScopeRuntime.result;
      } else if (isRecoverableRuntimeResult(readScopeRuntime)) {
        readStateScope = { hasReadState: false, scope: 'timeout' };
      } else {
        throw readScopeRuntime.state === 'error'
          ? readScopeRuntime.error
          : new PropertyTileBudgetExceededError('Read-state scope lookup did not complete');
      }
      const tiles = readStateScope.hasReadState ? [tileUrl] : [];

      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Vary', 'Authorization, x-session-id')
        .send({
          tilejson: '2.1.0',
          name: 'HuisHype Read Properties',
          description: 'Viewer-specific read property overlay data with clustering',
          tiles,
          minzoom: 0,
          maxzoom: 22,
          bounds: [-180, -85, 180, 85],
        });
    }
  );

  /**
   * GET /tiles/properties/:z/:x/:y.pbf
   *
   * Returns a Mapbox Vector Tile (MVT) containing property data
   * - Active nodes may group at any zoom based on density
   * - Ghost nodes are not emitted from public tiles
   */
  typedApp.get(
    '/tiles/properties/:z/:x/:y.pbf',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get property vector tile',
        description:
          'Returns MVT/PBF vector tile with density-aware grouped property data. Active/listing-backed/social nodes may group at any zoom; ghost nodes are not emitted.',
        params: tileParamsSchema,
        querystring: mapFiltersQuerySchema,
        // Response schema is omitted for binary data
        // Content-Type will be application/x-protobuf
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;
      const filters = parseMapFiltersQuery(request.query);
      const filterSignature = getMapFilterSignature(filters);
      const cacheKey = `${z}/${x}/${y}:${filterSignature}`;
      const runtimeConfig = getPropertyTileRuntimeConfig();
      const pyramidRouteMaxZoom = propertyTilePyramidRouteService.getMaxZoom();
      const isPyramidCoveredPublicDefaultTile =
        filterSignature === 'default' && z <= pyramidRouteMaxZoom;

      if (isPyramidCoveredPublicDefaultTile) {
        const startedAt = Date.now();
        const pyramidRuntime = {
          coalesced: false,
          queueTimeMs: 0,
          generationTimeMs: 0,
          budgetMs: runtimeConfig.publicBudgetMs,
        };
        const slot = {
          ...getDefaultPropertyTilePyramidSlot(),
          maxZoom: pyramidRouteMaxZoom,
        };
        let current: PropertyTilePyramidCurrentLookup;

        try {
          current = await propertyTilePyramidRouteService.lookupCurrentVersion(slot);
        } catch (error) {
          if (!isPropertyTileRecoverableError(error)) {
            throw error;
          }
          pyramidRuntime.generationTimeMs = Date.now() - startedAt;
          const buildRequest = await requestPyramidBuildForTileRoute(request, {
            reason: 'tile-miss',
            slot,
            z,
            x,
            y,
          });
          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'pyramid-unavailable',
            result: 'pyramid-unavailable',
            runtime: pyramidRuntime,
            errorClassification: 'transient_db',
          });
          return sendPyramidUnavailableTile(reply, {
            tileStatus: 'pyramid-unavailable',
            runtime: pyramidRuntime,
            buildRequest,
          });
        }

        const isRequestedTileCoveredByConfiguredSlot =
          propertyTilePyramidRouteService.isTileCovered({
            z,
            x,
            y,
            maxZoom: slot.maxZoom,
          });
        pyramidRuntime.generationTimeMs = Date.now() - startedAt;
        if (current.state !== 'current') {
          if (!isRequestedTileCoveredByConfiguredSlot) {
            logTileOutcome({
              request,
              routeKind: 'public',
              z,
              x,
              y,
              filterSignature,
              cacheState: 'pyramid-uncovered',
              result: 'pyramid-uncovered',
              runtime: pyramidRuntime,
            });
            return sendPyramidUncoveredTile(reply, pyramidRuntime);
          }

          const buildRequest = await requestPyramidBuildForTileRoute(request, {
            reason: 'tile-miss',
            slot,
            z,
            x,
            y,
          });
          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'pyramid-unavailable',
            result: 'pyramid-unavailable',
            runtime: pyramidRuntime,
          });
          return sendPyramidUnavailableTile(reply, {
            tileStatus: current.tileStatus,
            runtime: pyramidRuntime,
            buildRequest,
          });
        }

        const pyramidCacheKey = buildPropertyTilePyramidCacheKey({
          versionId: current.version.versionId,
          z,
          x,
          y,
        });
        const cachedPyramidTile = publicPropertyTileCache.get(pyramidCacheKey);
        if (cachedPyramidTile.state === 'fresh') {
          const honorConditional = await shouldHonorCurrentPyramidConditionalRequest({
            request,
            entry: cachedPyramidTile.entry,
            slot,
            versionId: current.version.versionId,
          });
          reply.header('X-HuisHype-Pyramid-Version', current.version.versionId);
          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'hit',
            result: 'fresh',
            runtime: {
              coalesced: false,
              queueTimeMs: 0,
              generationTimeMs: 0,
              budgetMs: runtimeConfig.publicBudgetMs,
            },
          });
          return sendPublicTileEntry(
            request,
            reply,
            cachedPyramidTile.entry,
            'hit',
            {
              coalesced: false,
              queueTimeMs: 0,
              generationTimeMs: 0,
              budgetMs: runtimeConfig.publicBudgetMs,
            },
            {
              honorConditional,
            }
          );
        }

        let tile: PropertyTilePyramidTileLookup;
        try {
          tile = await propertyTilePyramidRouteService.lookupTile({
            version: current.version as CurrentPropertyTilePyramidVersion,
            z,
            x,
            y,
          });
          pyramidRuntime.generationTimeMs = Date.now() - startedAt;
        } catch (error) {
          if (!isControlledPyramidTileLookupError(error)) {
            throw error;
          }
          pyramidRuntime.generationTimeMs = Date.now() - startedAt;
          await markPyramidVersionDegradedForTileRoute(request, {
            version: current.version as CurrentPropertyTilePyramidVersion,
            reason: 'payload-regeneration-error',
            details: {
              z,
              x,
              y,
              message:
                error instanceof Error ? error.message : 'Unknown payload regeneration error',
            },
          });
          const buildRequest = await requestPyramidBuildForTileRoute(request, {
            reason: 'payload-regeneration-error',
            slot,
            z,
            x,
            y,
          });
          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'pyramid-missing',
            result: 'pyramid-missing',
            runtime: pyramidRuntime,
            errorClassification: 'transient_db',
          });
          return sendPyramidUnavailableTile(reply, {
            tileStatus: 'pyramid-missing',
            runtime: pyramidRuntime,
            buildRequest,
          });
        }

        if (tile.state === 'missing') {
          const isCurrentVersionCoverageCovered = current.version.coverage
            ? isPropertyTilePyramidTileCoveredByCoverage({
                coverage: current.version.coverage,
                z,
                x,
                y,
              })
            : propertyTilePyramidRouteService.isTileCovered({
                z,
                x,
                y,
                maxZoom: current.version.maxZoom,
              });
          if (!isCurrentVersionCoverageCovered) {
            logTileOutcome({
              request,
              routeKind: 'public',
              z,
              x,
              y,
              filterSignature,
              cacheState: 'pyramid-uncovered',
              result: 'pyramid-uncovered',
              runtime: pyramidRuntime,
            });
            return sendPyramidUncoveredTile(reply, pyramidRuntime);
          }

          await markPyramidVersionDegradedForTileRoute(request, {
            version: current.version as CurrentPropertyTilePyramidVersion,
            reason: tile.reason,
            details: {
              z,
              x,
              y,
              tileStatus: tile.tileStatus,
            },
          });
          const buildRequest = await requestPyramidBuildForTileRoute(request, {
            reason: 'manifest-missing',
            slot,
            z,
            x,
            y,
          });
          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'pyramid-missing',
            result: 'pyramid-missing',
            runtime: pyramidRuntime,
          });
          return sendPyramidUnavailableTile(reply, {
            tileStatus: tile.tileStatus,
            runtime: pyramidRuntime,
            buildRequest,
          });
        }

        const entry = publicPropertyTileCache.set(pyramidCacheKey, {
          payload: tile.payload,
          statusCode: tile.statusCode,
          etag: tile.etag,
        });
        reply.header('X-HuisHype-Pyramid-Version', current.version.versionId);
        reply.header(
          'X-HuisHype-Tile-Status',
          tile.statusCode === 204 ? 'pyramid-empty' : 'pyramid-promoted'
        );
        logTileOutcome({
          request,
          routeKind: 'public',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'precomputed',
          result: 'precomputed',
          runtime: pyramidRuntime,
        });
        return sendPublicTileEntry(request, reply, entry, 'precomputed', {
          ...pyramidRuntime,
        });
      }

      const cachedTile = publicPropertyTileCache.get(cacheKey);

      if (cachedTile.state === 'fresh') {
        logTileOutcome({
          request,
          routeKind: 'public',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'hit',
          result: 'fresh',
          runtime: {
            coalesced: false,
            queueTimeMs: 0,
            generationTimeMs: 0,
            budgetMs: runtimeConfig.publicBudgetMs,
          },
        });
        return sendPublicTileEntry(request, reply, cachedTile.entry, 'hit', {
          coalesced: false,
          queueTimeMs: 0,
          generationTimeMs: 0,
          budgetMs: runtimeConfig.publicBudgetMs,
        });
      }

      const signal = createRequestAbortSignal(request, reply);

      const stageTimings: PropertyTileStageTiming[] = [];
      const runtimeResult = await propertyTileRuntime.run<PropertyTilePayloadBuildResult>({
        key: `public:${cacheKey}`,
        zoom: z,
        budgetMs: runtimeConfig.publicBudgetMs,
        statementTimeoutMs: runtimeConfig.publicBudgetMs,
        signal,
        builder: async (options) =>
          buildPayloadResult(
            await buildMvtForTile({ z, x, y }, filters, {
              ...options,
              onStageTiming: (timing) => {
                stageTimings.push(timing);
                options.onStageTiming?.(timing);
              },
            })
          ),
      });

      if (runtimeResult.state !== 'completed') {
        if (
          runtimeResult.state !== 'error' ||
          isPropertyTileRecoverableError(runtimeResult.error)
        ) {
          const staleEntry = publicPropertyTileCache.getStale(cacheKey);
          if (staleEntry) {
            logTileOutcome({
              request,
              routeKind: 'public',
              z,
              x,
              y,
              filterSignature,
              cacheState: 'stale',
              result: 'stale',
              runtime: runtimeResult,
              errorClassification: classifyTileError(runtimeResult),
              stageTimings,
            });
            return sendPublicTileEntry(request, reply, staleEntry, 'stale', runtimeResult);
          }

          logTileOutcome({
            request,
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'timeout-empty',
            result: dynamicTileOutcomeResult(runtimeResult),
            runtime: runtimeResult,
            errorClassification: classifyTileError(runtimeResult),
            stageTimings,
          });
          return sendTimeoutEmptyTile(reply, runtimeResult);
        }

        throw runtimeResult.error;
      }

      if (!runtimeResult.publishable) {
        logTileOutcome({
          request,
          routeKind: 'public',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'timeout-empty',
          result: dynamicTileOutcomeResult(runtimeResult),
          runtime: runtimeResult,
          errorClassification: 'client_aborted',
          stageTimings,
        });
        return sendTimeoutEmptyTile(reply, runtimeResult);
      }

      const entry = publicPropertyTileCache.set(cacheKey, {
        ...runtimeResult.result,
        etag: buildPropertyTileEtag(cacheKey, runtimeResult.result.payload),
      });
      const queryTime = runtimeResult.generationTimeMs;

      // Log slow queries for monitoring
      if (queryTime > 100) {
        app.log.warn(
          {
            routeKind: 'public',
            z,
            x,
            y,
            filterSignature,
            queryTime,
            queueTimeMs: runtimeResult.queueTimeMs,
            budgetMs: runtimeResult.budgetMs,
            cacheState: 'miss',
          },
          `Slow tile generation: ${queryTime}ms`
        );
      }

      logTileOutcome({
        request,
        routeKind: 'public',
        z,
        x,
        y,
        filterSignature,
        cacheState: 'miss',
        result: dynamicTileOutcomeResult(runtimeResult),
        runtime: runtimeResult,
        stageTimings,
      });
      return sendPublicTileEntry(request, reply, entry, 'miss', runtimeResult);
    }
  );

  typedApp.get(
    '/tiles/properties/read/:z/:x/:y.pbf',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['tiles'],
        summary: 'Get read property vector tile',
        description:
          'Returns private MVT/PBF overlay tiles containing only grouped property nodes that are read for the current viewer.',
        params: tileParamsSchema,
        querystring: mapFiltersQuerySchema,
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );

      if (!viewer) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'Authenticated user or x-session-id header is required.',
        });
      }

      const filters = parseMapFiltersQuery(request.query);
      const runtimeConfig = getPropertyTileRuntimeConfig();
      const viewerScope = getPropertyReadViewerScope(viewer);
      const filterSignature = getMapFilterSignature(filters);
      const stageTimings: PropertyTileStageTiming[] = [];
      let initialReadScope: { hasReadState: boolean; scope: string };
      const signal = createRequestAbortSignal(request, reply);
      const readScopeRuntime = await runReadStateScopeLookup({
        viewer,
        viewerScope,
        zoom: z,
        signal,
      });
      if (readScopeRuntime.state === 'completed' && readScopeRuntime.publishable) {
        initialReadScope = readScopeRuntime.result;
      } else if (isRecoverableRuntimeResult(readScopeRuntime)) {
        const timeoutRuntime = {
          coalesced: readScopeRuntime.coalesced,
          queueTimeMs: readScopeRuntime.queueTimeMs,
          generationTimeMs: readScopeRuntime.generationTimeMs,
          budgetMs: readScopeRuntime.budgetMs,
        };
        logTileOutcome({
          request,
          routeKind: 'read',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'timeout-empty',
          result: 'timeout-empty',
          runtime: timeoutRuntime,
          errorClassification: 'budget_timeout',
          viewerId: viewerScope,
          stageTimings,
        });
        return sendTimeoutEmptyTile(reply, timeoutRuntime, 'Authorization, x-session-id');
      } else {
        throw readScopeRuntime.state === 'error'
          ? readScopeRuntime.error
          : new PropertyTileBudgetExceededError('Read-state scope lookup did not complete');
      }
      const runtimeResult = await propertyTileRuntime.run<PropertyTilePayloadBuildResult>({
        key: `read:${z}/${x}/${y}:${filterSignature}:${viewerScope}:${initialReadScope.scope}`,
        zoom: z,
        budgetMs: runtimeConfig.privateBudgetMs,
        statementTimeoutMs: runtimeConfig.privateBudgetMs,
        signal,
        builder: async (options) => {
          const payloadResult = initialReadScope.hasReadState
            ? buildPayloadResult(
                await buildReadMvtForTile({ z, x, y }, viewer, filters, {
                  ...options,
                  onStageTiming: (timing) => {
                    stageTimings.push(timing);
                    options.onStageTiming?.(timing);
                  },
                })
              )
            : ({ payload: null, statusCode: 204 } satisfies PropertyTilePayloadBuildResult);
          const latestReadScope = await getReadStateScopeForViewer(viewer, options);
          if (latestReadScope.scope !== initialReadScope.scope) {
            throw new PropertyTileBuildAbortedError('Read-state scope changed during tile build');
          }
          return payloadResult;
        },
      });

      if (runtimeResult.state !== 'completed') {
        if (
          runtimeResult.state !== 'error' ||
          isPropertyTileRecoverableError(runtimeResult.error)
        ) {
          logTileOutcome({
            request,
            routeKind: 'read',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'timeout-empty',
            result: dynamicTileOutcomeResult(runtimeResult),
            runtime: runtimeResult,
            errorClassification: classifyTileError(runtimeResult),
            viewerId: viewerScope,
            stageTimings,
          });
          return sendTimeoutEmptyTile(reply, runtimeResult, 'Authorization, x-session-id');
        }

        logTileOutcome({
          request,
          routeKind: 'read',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'miss',
          result: 'error',
          runtime: runtimeResult,
          errorClassification: classifyTileError(runtimeResult),
          viewerId: viewerScope,
          stageTimings,
        });
        throw runtimeResult.error;
      }

      if (!runtimeResult.publishable) {
        logTileOutcome({
          request,
          routeKind: 'read',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'timeout-empty',
          result: dynamicTileOutcomeResult(runtimeResult),
          runtime: runtimeResult,
          errorClassification: 'client_aborted',
          viewerId: viewerScope,
          stageTimings,
        });
        return sendTimeoutEmptyTile(reply, runtimeResult, 'Authorization, x-session-id');
      }

      if (runtimeResult.generationTimeMs > 100) {
        app.log.warn(
          { z, x, y, queryTime: runtimeResult.generationTimeMs },
          `Slow read tile generation: ${runtimeResult.generationTimeMs}ms`
        );
      }

      logTileOutcome({
        request,
        routeKind: 'read',
        z,
        x,
        y,
        filterSignature,
        cacheState: 'miss',
        result: dynamicTileOutcomeResult(runtimeResult),
        runtime: runtimeResult,
        viewerId: viewerScope,
        stageTimings,
      });
      return sendPrivateTilePayload(
        reply,
        runtimeResult.result,
        runtimeResult,
        'Authorization, x-session-id'
      );
    }
  );

  typedApp.get(
    '/tiles/following/properties/:z/:x/:y.pbf',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['tiles'],
        summary: 'Get Following property vector tile',
        description:
          'Returns personalized MVT/PBF property tiles grouped from followed-user qualifying activity for the signed-in viewer.',
        params: tileParamsSchema,
        querystring: followingMapFiltersQuerySchema,
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;
      const filters = parseFollowingMapFiltersQuery(request.query);
      const runtimeConfig = getPropertyTileRuntimeConfig();
      const filterSignature = getMapFilterSignature(filters);
      const stageTimings: PropertyTileStageTiming[] = [];
      const runtimeResult = await propertyTileRuntime.run<PropertyTilePayloadBuildResult>({
        key: `following:${z}/${x}/${y}:${filterSignature}:user:${request.userId!}`,
        zoom: z,
        budgetMs: runtimeConfig.privateBudgetMs,
        statementTimeoutMs: runtimeConfig.privateBudgetMs,
        signal: createRequestAbortSignal(request, reply),
        builder: async (options) =>
          buildPayloadResult(
            await buildFollowingMvtForTile({ z, x, y }, request.userId!, filters, {
              ...options,
              onStageTiming: (timing) => {
                stageTimings.push(timing);
                options.onStageTiming?.(timing);
              },
            })
          ),
      });

      if (runtimeResult.state !== 'completed') {
        if (
          runtimeResult.state !== 'error' ||
          isPropertyTileRecoverableError(runtimeResult.error)
        ) {
          logTileOutcome({
            request,
            routeKind: 'following',
            z,
            x,
            y,
            filterSignature,
            cacheState: 'timeout-empty',
            result: dynamicTileOutcomeResult(runtimeResult),
            runtime: runtimeResult,
            errorClassification: classifyTileError(runtimeResult),
            viewerId: request.userId,
            stageTimings,
          });
          return sendTimeoutEmptyTile(reply, runtimeResult, 'Authorization');
        }

        logTileOutcome({
          request,
          routeKind: 'following',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'miss',
          result: 'error',
          runtime: runtimeResult,
          errorClassification: classifyTileError(runtimeResult),
          viewerId: request.userId,
          stageTimings,
        });
        throw runtimeResult.error;
      }

      if (!runtimeResult.publishable) {
        logTileOutcome({
          request,
          routeKind: 'following',
          z,
          x,
          y,
          filterSignature,
          cacheState: 'timeout-empty',
          result: dynamicTileOutcomeResult(runtimeResult),
          runtime: runtimeResult,
          errorClassification: 'client_aborted',
          viewerId: request.userId,
          stageTimings,
        });
        return sendTimeoutEmptyTile(reply, runtimeResult, 'Authorization');
      }

      if (runtimeResult.generationTimeMs > 100) {
        app.log.warn(
          { z, x, y, queryTime: runtimeResult.generationTimeMs, viewerId: request.userId },
          `Slow following tile generation: ${runtimeResult.generationTimeMs}ms`
        );
      }

      logTileOutcome({
        request,
        routeKind: 'following',
        z,
        x,
        y,
        filterSignature,
        cacheState: 'miss',
        result: dynamicTileOutcomeResult(runtimeResult),
        runtime: runtimeResult,
        viewerId: request.userId,
        stageTimings,
      });
      return sendPrivateTilePayload(reply, runtimeResult.result, runtimeResult, 'Authorization');
    }
  );

  // --- Tree scatter tiles ---

  /**
   * GET /tiles/trees/:z/:x/:y.pbf
   *
   * Returns MVT tiles with scattered tree points inside tree-eligible landcover polygons.
   * Points are generated deterministically via seeded PRNG, then filtered
   * to only those inside green areas with water and tall-building exclusions.
   */
  typedApp.get(
    '/tiles/trees/:z/:x/:y.pbf',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get tree scatter vector tile',
        description:
          'Returns MVT with deterministically scattered tree points inside tree-eligible landcover polygons.',
        params: tileParamsSchema,
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;

      if (z < TREE_MIN_ZOOM || z > TREE_MAX_ZOOM) {
        return reply.header('Cache-Control', TREE_TILE_CACHE_CONTROL).status(204).send();
      }

      const bbox = tileToBBox({ z, x, y });
      const candidates = generateTreeCandidates(z, x, y, bbox, TREE_VARIANTS);

      if (candidates.length === 0) {
        return reply.header('Cache-Control', TREE_TILE_CACHE_CONTROL).status(204).send();
      }

      // Build VALUES clause for candidate points
      const valuesClause = candidates
        .map((p, i) => `(${i}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326), ${p.variant})`)
        .join(',');
      const treeLandcoverSource = await getTreeLandcoverSource();
      const waterExclusionClause = treeLandcoverSource.excludeWatercover
        ? `AND NOT EXISTS (
            SELECT 1 FROM watercover wc
            WHERE ST_Covers(wc.geometry, c.geom)
          )`
        : '';

      const query = `
        WITH candidates(id, geom, tree_variant) AS (
          VALUES ${valuesClause}
        ),
        green_trees AS (
          SELECT DISTINCT ON (c.id)
            c.id,
            c.tree_variant,
            c.geom
          FROM candidates c
          INNER JOIN ${treeLandcoverSource.tableName} lc ON ST_Within(c.geom, lc.geometry)
          WHERE NOT EXISTS (
            SELECT 1 FROM tall_buildings b
            WHERE ST_Intersects(c.geom, b.exclusion_geom)
          )
          ${waterExclusionClause}
          ORDER BY c.id
        ),
        mvt_data AS (
          SELECT
            id,
            tree_variant,
            ST_AsMVTGeom(
              ST_Transform(geom, 3857),
              ST_TileEnvelope(${z}, ${x}, ${y}),
              4096,
              256,
              true
            ) AS geom
          FROM green_trees
        )
        SELECT ST_AsMVT(mvt_data, 'scattered-trees', 4096, 'geom') AS mvt
        FROM mvt_data
      `;

      const result = await db.execute<{ mvt: Buffer }>(sql.raw(query));
      const rows = Array.from(result) as { mvt: Buffer }[];
      const mvt = rows[0]?.mvt;

      if (!mvt || mvt.length === 0) {
        return reply.header('Cache-Control', TREE_TILE_CACHE_CONTROL).status(204).send();
      }

      const mvtBuffer = Buffer.isBuffer(mvt) ? mvt : Buffer.from(mvt);

      return reply
        .header('Content-Type', 'application/x-protobuf')
        .header('Cache-Control', TREE_TILE_CACHE_CONTROL)
        .send(mvtBuffer);
    }
  );

  // --- Duck scatter tiles ---

  /**
   * GET /tiles/ducks/:z/:x/:y.pbf
   *
   * Returns MVT tiles with sparse decorative duck points inside closed water
   * polygons. Points are generated deterministically via seeded PRNG, then
   * filtered to larger watercover polygons using ST_Within.
   */
  typedApp.get(
    '/tiles/ducks/:z/:x/:y.pbf',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get duck scatter vector tile',
        description:
          'Returns MVT with deterministically scattered duck points inside watercover polygons.',
        params: tileParamsSchema,
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;

      if (z < DUCK_MIN_ZOOM || z > DUCK_MAX_ZOOM) {
        return reply.header('Cache-Control', DUCK_TILE_CACHE_CONTROL).status(204).send();
      }

      const bbox = tileToBBox({ z, x, y });
      const candidates = generateDuckCandidates(z, x, y, bbox, DUCK_VARIANTS);

      if (candidates.length === 0) {
        return reply.header('Cache-Control', DUCK_TILE_CACHE_CONTROL).status(204).send();
      }

      const valuesClause = candidates
        .map((p, i) => `(${i}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326), ${p.variant})`)
        .join(',');

      const query = `
        WITH candidates(id, geom, duck_variant) AS (
          VALUES ${valuesClause}
        ),
        water_ducks AS (
          SELECT DISTINCT ON (c.id)
            c.id,
            c.duck_variant,
            c.geom
          FROM candidates c
          INNER JOIN watercover wc ON ST_Within(c.geom, wc.geometry)
          WHERE wc.area_m2 >= ${DUCK_MIN_WATER_AREA_M2}
          ORDER BY c.id
        ),
        mvt_data AS (
          SELECT
            id,
            duck_variant,
            ST_AsMVTGeom(
              ST_Transform(geom, 3857),
              ST_TileEnvelope(${z}, ${x}, ${y}),
              4096,
              256,
              true
            ) AS geom
          FROM water_ducks
        )
        SELECT ST_AsMVT(mvt_data, 'scattered-ducks', 4096, 'geom') AS mvt
        FROM mvt_data
      `;

      let result: Iterable<{ mvt: Buffer }>;
      try {
        result = await db.execute<{ mvt: Buffer }>(sql.raw(query));
      } catch (err) {
        if (isMissingWatercoverTableError(err)) {
          if (!loggedMissingWatercoverForDuckTiles) {
            loggedMissingWatercoverForDuckTiles = true;
            request.log.warn(
              err,
              'watercover table is missing; returning empty duck scatter tile'
            );
          }
          return reply.header('Cache-Control', DUCK_TILE_CACHE_CONTROL).status(204).send();
        }
        throw err;
      }
      const rows = Array.from(result) as { mvt: Buffer }[];
      const mvt = rows[0]?.mvt;

      if (!mvt || mvt.length === 0) {
        return reply.header('Cache-Control', DUCK_TILE_CACHE_CONTROL).status(204).send();
      }

      const mvtBuffer = Buffer.isBuffer(mvt) ? mvt : Buffer.from(mvt);

      return reply
        .header('Content-Type', 'application/x-protobuf')
        .header('Cache-Control', DUCK_TILE_CACHE_CONTROL)
        .send(mvtBuffer);
    }
  );

  // --- OSM building tiles ---

  /**
   * GET /tiles/buildings/:z/:x/:y.pbf
   *
   * Returns MVT tiles with individual OSM building footprints.
   * Each building is its own feature with render_height and render_min_height
   * from OSM tags, enabling per-building 3D extrusion and color variation.
   */
  typedApp.get(
    '/tiles/buildings/:z/:x/:y.pbf',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get OSM building vector tile',
        description: 'Returns MVT with individual OSM building footprints and heights.',
        params: tileParamsSchema,
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;

      if (z < BUILDINGS_TILE_CONFIG.minZoom || z > BUILDINGS_TILE_CONFIG.maxZoom) {
        return reply.header('Cache-Control', BUILDING_TILE_CACHE_CONTROL).status(204).send();
      }

      const startTime = Date.now();

      const result = await db.execute<{ mvt: Buffer }>(sql`
        WITH mvt_data AS (
          SELECT
            id,
            GREATEST(3.02, render_height - render_min_height) AS render_height,
            ST_AsMVTGeom(
              ST_Transform(geometry, 3857),
              ST_TileEnvelope(${z}, ${x}, ${y}),
              4096,
              256,
              true
            ) AS geom
          FROM osm_buildings
          WHERE geometry && ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 4326)
        )
        SELECT ST_AsMVT(mvt_data, 'buildings', 4096, 'geom', 'id') AS mvt
        FROM mvt_data
        WHERE geom IS NOT NULL
      `);

      const rows = Array.from(result) as { mvt: Buffer }[];
      const mvt = rows[0]?.mvt;
      const elapsed = Date.now() - startTime;

      if (!mvt || mvt.length === 0) {
        return reply.header('Cache-Control', BUILDING_TILE_CACHE_CONTROL).status(204).send();
      }

      const mvtBuffer = Buffer.isBuffer(mvt) ? mvt : Buffer.from(mvt);

      return reply
        .header('Content-Type', 'application/x-protobuf')
        .header('Cache-Control', BUILDING_TILE_CACHE_CONTROL)
        .header('X-Tile-Generation-Time', `${elapsed}ms`)
        .send(mvtBuffer);
    }
  );
}

// Export types
export type TileParams = z.infer<typeof tileParamsSchema>;

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import {
  createDefaultMapFilters,
  parseFollowingMapFiltersQuery,
  parseMapFiltersQuery,
  serializeMapFilterQuery,
  type MapFilters,
} from '../services/map-filters.js';
import {
  getFollowingTileSessionVersion,
  getReadTileSessionVersion,
  resolvePropertyReadViewer,
  type PropertyReadViewer,
} from '../services/property-read-state.js';

const TILE_SESSION_TOKEN_PARAM = 'tile_session';
const TILE_SESSION_TOKEN_TYPE = 'HuisHypeTileSession';
const TILE_SESSION_TTL_SECONDS = 5 * 60;
const PRIVATE_TILE_CACHE_CONTROL = 'private, no-store';
const PUBLIC_PROXY_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=300';
const STYLE_RESOURCE_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=300';
const MARTIN_RESOURCE_ROOT = new URL('../../../../martin/', import.meta.url);
const FONT_RESOURCE_ROOT = new URL('../../fonts/', import.meta.url);
const BASE_TILE_MAX_ZOOM = 14;
const PUBLIC_PROPERTY_TILE_MIN_ZOOM = 7;
const PROPERTY_TILE_MAX_ZOOM = 22;
const BUILDING_TILE_MIN_ZOOM = 15;
const BUILDING_TILE_MAX_ZOOM = 17;
const TREE_TILE_MIN_ZOOM = 15;
const TREE_TILE_MAX_ZOOM = 17;
const TRUSTED_TILE_PARAMS = new Set([
  'userId',
  'user_id',
  'viewer_id',
  'viewerId',
  'anonymousSessionId',
  'anonymous_session_id',
  'sessionId',
  'session_id',
  'readVersion',
  'read_version',
  'followVersion',
  'follow_version',
  'session_jti',
]);

const tileParamsSchema = z
  .object({
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .superRefine(({ z: tileZ, x, y }, ctx) => {
    const maxTileCoord = 2 ** tileZ;
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

const tileSessionAudienceSchema = z.enum(['read-properties', 'following-properties']);
const tileSessionScopeSchema = z.enum(['read', 'following']);

const glyphParamsSchema = z.object({
  fontstack: z
    .string()
    .min(1)
    .regex(/^[\w .,-]+$/),
  range: z.string().regex(/^\d+-\d+(?:\.pbf)?$/),
});

const tileSessionRequestSchema = z.object({
  scope: tileSessionScopeSchema,
  salePriceFrom: z.coerce.number().int().positive().optional(),
  salePriceTo: z.coerce.number().int().positive().optional(),
  rentPriceFrom: z.coerce.number().int().positive().optional(),
  rentPriceTo: z.coerce.number().int().positive().optional(),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
  activity: z.string().optional(),
});

const tileSessionResponseSchema = z.object({
  token: z.string(),
  tokenType: z.literal(TILE_SESSION_TOKEN_TYPE),
  scope: tileSessionScopeSchema,
  audience: tileSessionAudienceSchema,
  expiresAt: z.string().datetime(),
  ttlSeconds: z.number().int().positive(),
  tileTemplate: z.string(),
  cacheBustedTileTemplate: z.string(),
  tiles: z.object({
    template: z.string(),
    replacementTemplate: z.string(),
  }),
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

const styleResourceParamsSchema = z.object({
  styleId: z.enum(['huishype', 'huishype-native']),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

type TileSessionAudience = z.infer<typeof tileSessionAudienceSchema>;
export type TileSessionResponse = z.infer<typeof tileSessionResponseSchema>;

type TileSessionClaims = {
  aud: TileSessionAudience;
  exp: number;
  iat: number;
  jti: string;
  pathPrefix: string;
  viewerId?: string;
  anonymousSessionId?: string;
  readVersion?: string;
  followVersion?: string;
};

type MartinProxyOptions = {
  privateResponse?: boolean;
  injectedParams?: Record<string, string>;
  filters?: MapFilters;
};

type MartinStyleSource = {
  url?: string;
  tiles?: string[];
};

type MartinStyleDocument = {
  sprite?: string;
  glyphs?: string;
  sources?: Record<string, MartinStyleSource>;
  [key: string]: unknown;
};

type TileSessionIssueContext = {
  request: FastifyRequest;
  reply: FastifyReply;
  audience: TileSessionAudience;
  filters: MapFilters;
};

const UUID_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function signTileSessionPayload(encodedPayload: string): string {
  return createHmac('sha256', config.tileSession.secret).update(encodedPayload).digest('base64url');
}

function createTileSessionToken(claims: TileSessionClaims): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  return `${encodedPayload}.${signTileSessionPayload(encodedPayload)}`;
}

function verifyTileSessionToken(token: string): TileSessionClaims | null {
  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra != null) {
    return null;
  }

  const expected = signTileSessionPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as unknown;
    const claims = parsed as Partial<TileSessionClaims>;
    if (
      claims == null ||
      !tileSessionAudienceSchema.safeParse(claims.aud).success ||
      typeof claims.exp !== 'number' ||
      typeof claims.iat !== 'number' ||
      typeof claims.jti !== 'string' ||
      typeof claims.pathPrefix !== 'string'
    ) {
      return null;
    }

    if (claims.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return claims as TileSessionClaims;
  } catch {
    return null;
  }
}

function getRequestBaseUrl(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

function getAudiencePathPrefix(audience: TileSessionAudience): string {
  return audience === 'read-properties'
    ? '/tiles/private_read_property_nodes'
    : '/tiles/private_following_property_nodes';
}

function getAudienceScope(audience: TileSessionAudience): z.infer<typeof tileSessionScopeSchema> {
  return audience === 'read-properties' ? 'read' : 'following';
}

function getScopeAudience(scope: z.infer<typeof tileSessionScopeSchema>): TileSessionAudience {
  return scope === 'read' ? 'read-properties' : 'following-properties';
}

function buildPrivateTileTemplate(
  baseUrl: string,
  audience: TileSessionAudience,
  token: string,
  filters: MapFilters,
  replacement = false
): string {
  const sourcePath = getAudiencePathPrefix(audience);
  const params = new URLSearchParams(serializeMapFilterQuery(filters));
  params.set(TILE_SESSION_TOKEN_PARAM, token);
  if (replacement) {
    params.set('session', randomUUID());
  }
  return `${baseUrl}${sourcePath}/{z}/{x}/{y}?${params.toString()}`;
}

async function issueTileSession({
  request,
  reply,
  audience,
  filters,
}: TileSessionIssueContext): Promise<TileSessionResponse | null> {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + TILE_SESSION_TTL_SECONDS;
  const pathPrefix = getAudiencePathPrefix(audience);
  const claims: TileSessionClaims = {
    aud: audience,
    exp: expiresAtSeconds,
    iat: issuedAtSeconds,
    jti: randomUUID(),
    pathPrefix,
  };

  if (audience === 'following-properties') {
    if (!request.userId) {
      reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return null;
    }
    claims.viewerId = request.userId;
    claims.followVersion = await getFollowingTileSessionVersion(request.userId);
  } else {
    const viewer = resolvePropertyReadViewer(
      request.userId,
      request.headers['x-session-id'] as string | string[] | undefined
    );
    if (!viewer) {
      reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'Authenticated user or x-session-id header is required.',
      });
      return null;
    }
    if ('userId' in viewer) {
      claims.viewerId = viewer.userId;
    } else {
      if (!UUID_SESSION_ID_PATTERN.test(viewer.sessionId)) {
        reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'x-session-id must be a UUID generated by the HuisHype client.',
        });
        return null;
      }
      claims.anonymousSessionId = viewer.sessionId;
    }
    claims.readVersion = await getReadTileSessionVersion(viewer);
  }

  const token = createTileSessionToken(claims);
  const baseUrl = getRequestBaseUrl(request);

  return {
    token,
    tokenType: TILE_SESSION_TOKEN_TYPE,
    scope: getAudienceScope(audience),
    audience,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    ttlSeconds: TILE_SESSION_TTL_SECONDS,
    tileTemplate: buildPrivateTileTemplate(baseUrl, audience, token, filters),
    cacheBustedTileTemplate: buildPrivateTileTemplate(baseUrl, audience, token, filters, true),
    tiles: {
      template: buildPrivateTileTemplate(baseUrl, audience, token, filters),
      replacementTemplate: buildPrivateTileTemplate(baseUrl, audience, token, filters, true),
    },
  };
}

function removeTrustedParams(params: URLSearchParams): void {
  params.delete(TILE_SESSION_TOKEN_PARAM);
  for (const trustedParam of TRUSTED_TILE_PARAMS) {
    params.delete(trustedParam);
  }
}

function appendCanonicalFilterParams(params: URLSearchParams, filters: MapFilters): void {
  params.delete('salePriceFrom');
  params.delete('salePriceTo');
  params.delete('rentPriceFrom');
  params.delete('rentPriceTo');
  params.delete('marketState');
  params.delete('activity');

  const serializedFilters = serializeMapFilterQuery(filters);
  if (serializedFilters.length === 0) {
    return;
  }

  const filterParams = new URLSearchParams(serializedFilters);
  for (const [key, value] of filterParams) {
    params.append(key, value);
  }
}

function buildSanitizedSearchParams(
  request: FastifyRequest,
  options: Pick<MartinProxyOptions, 'filters' | 'injectedParams'>
): URLSearchParams {
  const url = new URL(request.url, 'http://localhost');
  const params = new URLSearchParams(url.searchParams.toString());
  removeTrustedParams(params);

  if (options.filters) {
    appendCanonicalFilterParams(params, options.filters);
  }

  for (const [key, value] of Object.entries(options.injectedParams ?? {})) {
    params.set(key, value);
  }

  return params;
}

function stripPbfSuffix(pathname: string): string {
  return pathname.endsWith('.pbf') ? pathname.slice(0, -4) : pathname;
}

function normalizeMartinPath(pathname: string): string {
  return stripPbfSuffix(pathname);
}

function buildMartinUrl(request: FastifyRequest, options: MartinProxyOptions = {}): URL {
  const requestUrl = new URL(request.url, 'http://localhost');
  const targetPath = normalizeMartinPath(requestUrl.pathname);
  const targetUrl = new URL(targetPath, config.martin.url);
  const params = buildSanitizedSearchParams(request, options);
  targetUrl.search = params.toString();
  return targetUrl;
}

function shouldForwardRequestHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  return ![
    'authorization',
    'connection',
    'content-length',
    'cookie',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'x-session-id',
  ].includes(lower);
}

function buildProxyRequestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!shouldForwardRequestHeader(key) || value == null) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  headers.set('x-huishype-tile-gateway', '1');
  return headers;
}

function shouldForwardResponseHeader(headerName: string, privateResponse: boolean): boolean {
  const lower = headerName.toLowerCase();
  // Undici decompresses fetch bodies before Fastify sends them, so body metadata from Martin
  // must not be forwarded verbatim.
  if (
    [
      'connection',
      'content-encoding',
      'content-length',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ].includes(lower)
  ) {
    return false;
  }

  if (privateResponse && ['cache-control', 'etag', 'expires'].includes(lower)) {
    return false;
  }

  return true;
}

async function fetchMartin(url: URL, request: FastifyRequest): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.martin.proxyTimeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: buildProxyRequestHeaders(request),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyMartinResponse(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  options: MartinProxyOptions = {}
): Promise<FastifyReply> {
  const targetUrl = buildMartinUrl(request, options);
  let martinResponse: Response;

  try {
    martinResponse = await fetchMartin(targetUrl, request);
  } catch (err) {
    app.log.warn({ err, targetUrl: targetUrl.toString() }, 'Martin proxy request failed');
    return reply.status(502).send({
      error: 'MARTIN_UNAVAILABLE',
      message: 'Tile service is unavailable',
    });
  }

  for (const [key, value] of martinResponse.headers) {
    if (shouldForwardResponseHeader(key, options.privateResponse === true)) {
      reply.header(key, value);
    }
  }

  if (options.privateResponse) {
    reply.header('Cache-Control', PRIVATE_TILE_CACHE_CONTROL);
    reply.header('Vary', 'Authorization, x-session-id');
  } else if (!martinResponse.headers.has('cache-control')) {
    reply.header('Cache-Control', PUBLIC_PROXY_CACHE_CONTROL);
  }

  reply.status(martinResponse.status);

  if (martinResponse.status === 204 || martinResponse.body == null) {
    return reply.send();
  }

  return reply.send(Readable.fromWeb(martinResponse.body));
}

function extractTokenFromRequest(request: FastifyRequest): string | null {
  const url = new URL(request.url, 'http://localhost');
  return url.searchParams.get(TILE_SESSION_TOKEN_PARAM);
}

async function validateTileSessionForRequest(
  request: FastifyRequest,
  audience: TileSessionAudience
): Promise<TileSessionClaims | null> {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return null;
  }

  const claims = verifyTileSessionToken(token);
  if (!claims || claims.aud !== audience) {
    return null;
  }

  const requestPath = normalizeMartinPath(new URL(request.url, 'http://localhost').pathname);
  if (!requestPath.startsWith(`${claims.pathPrefix}/`)) {
    return null;
  }

  if (claims.aud === 'read-properties') {
    let viewer: PropertyReadViewer | null = null;
    if (claims.viewerId) {
      viewer = { userId: claims.viewerId };
    } else if (claims.anonymousSessionId) {
      viewer = { sessionId: claims.anonymousSessionId };
    }
    if (!viewer || !claims.readVersion) {
      return null;
    }
    return (await getReadTileSessionVersion(viewer)) === claims.readVersion ? claims : null;
  }

  if (!claims.viewerId || !claims.followVersion) {
    return null;
  }

  return (await getFollowingTileSessionVersion(claims.viewerId)) === claims.followVersion
    ? claims
    : null;
}

function buildTrustedParamsFromClaims(claims: TileSessionClaims): Record<string, string> {
  const params: Record<string, string> = {
    session_jti: claims.jti,
  };

  if (claims.aud === 'read-properties') {
    if (claims.viewerId) {
      params.user_id = claims.viewerId;
    }
    if (claims.anonymousSessionId) {
      params.session_id = claims.anonymousSessionId;
    }
    if (claims.readVersion) {
      params.read_version = claims.readVersion;
    }
    return params;
  }

  if (claims.viewerId) {
    params.viewer_id = claims.viewerId;
  }
  if (claims.followVersion) {
    params.follow_version = claims.followVersion;
  }
  return params;
}

function parseSessionRequestFilters(
  body: z.infer<typeof tileSessionRequestSchema>,
  audience: TileSessionAudience
): MapFilters {
  const filterQuery = {
    salePriceFrom: body.salePriceFrom,
    salePriceTo: body.salePriceTo,
    rentPriceFrom: body.rentPriceFrom,
    rentPriceTo: body.rentPriceTo,
    marketState: body.marketState,
    activity: body.activity,
  };

  return audience === 'following-properties'
    ? parseFollowingMapFiltersQuery(filterQuery)
    : parseMapFiltersQuery(filterQuery);
}

async function handlePrivateTileProxy(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  audience: TileSessionAudience
): Promise<FastifyReply> {
  const claims = await validateTileSessionForRequest(request, audience);
  if (!claims) {
    return reply.status(401).send({
      error: 'INVALID_TILE_SESSION',
      message: 'A valid tile session token is required.',
    });
  }

  const filters =
    audience === 'following-properties'
      ? parseFollowingMapFiltersQuery(
          Object.fromEntries(new URL(request.url, 'http://localhost').searchParams)
        )
      : parseMapFiltersQuery(
          Object.fromEntries(new URL(request.url, 'http://localhost').searchParams)
        );

  return proxyMartinResponse(app, request, reply, {
    privateResponse: true,
    injectedParams: buildTrustedParamsFromClaims(claims),
    filters,
  });
}

function buildPublicPropertyTileTemplate(baseUrl: string, filters: MapFilters): string {
  const query = serializeMapFilterQuery(filters);
  return `${baseUrl}/tiles/public_property_nodes/{z}/{x}/{y}${query ? `?${query}` : ''}`;
}

function buildTileJson(
  name: string,
  description: string,
  tiles: string[],
  minzoom = 0,
  maxzoom = PROPERTY_TILE_MAX_ZOOM
): z.infer<typeof tileJsonResponseSchema> {
  return {
    tilejson: '3.0.0',
    name,
    description,
    tiles,
    minzoom,
    maxzoom,
    bounds: [-180, -85, 180, 85],
  };
}

function buildTileTemplate(baseUrl: string, path: string): string {
  return `${baseUrl}${path}/{z}/{x}/{y}`;
}

function isNonCanonicalPrivatePbfTilePath(pathname: string): boolean {
  return (
    (pathname.startsWith('/tiles/private_read_property_nodes/') && pathname.endsWith('.pbf')) ||
    (pathname.startsWith('/tiles/private_following_property_nodes/') && pathname.endsWith('.pbf'))
  );
}

function isLegacyTilePath(pathname: string): boolean {
  return (
    pathname === '/tiles/style.json' ||
    pathname.startsWith('/tiles/properties') ||
    pathname.startsWith('/tiles/following/properties') ||
    isNonCanonicalPrivatePbfTilePath(pathname)
  );
}

async function sendMartinTextResource(
  reply: FastifyReply,
  resourcePath: string,
  contentType = 'application/json; charset=utf-8'
): Promise<FastifyReply> {
  const body = await readFile(new URL(resourcePath, MARTIN_RESOURCE_ROOT), 'utf8');
  return reply.header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL).type(contentType).send(body);
}

function absolutizeStyleUrl(baseUrl: string, value: string | undefined): string | undefined {
  if (!value || !value.startsWith('/tiles/')) {
    return value;
  }
  return `${baseUrl}${value}`;
}

async function sendMartinStyleResource(
  request: FastifyRequest,
  reply: FastifyReply,
  styleId: 'huishype' | 'huishype-native'
): Promise<FastifyReply> {
  const body = await readFile(new URL(`styles/${styleId}.json`, MARTIN_RESOURCE_ROOT), 'utf8');
  const style = JSON.parse(body) as MartinStyleDocument;
  const baseUrl = getRequestBaseUrl(request);

  style.sprite = absolutizeStyleUrl(baseUrl, style.sprite);
  style.glyphs = absolutizeStyleUrl(baseUrl, style.glyphs);

  for (const source of Object.values(style.sources ?? {})) {
    source.url = absolutizeStyleUrl(baseUrl, source.url);
    if (Array.isArray(source.tiles)) {
      source.tiles = source.tiles.map((tileUrl) => absolutizeStyleUrl(baseUrl, tileUrl) ?? tileUrl);
    }
  }

  return reply
    .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
    .type('application/json; charset=utf-8')
    .send(style);
}

async function sendMartinBinaryResource(
  reply: FastifyReply,
  resourcePath: string,
  contentType: string
): Promise<FastifyReply> {
  const body = await readFile(new URL(resourcePath, MARTIN_RESOURCE_ROOT));
  return reply.header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL).type(contentType).send(body);
}

async function sendFontGlyphResource(
  reply: FastifyReply,
  fontstack: string,
  range: string
): Promise<FastifyReply> {
  const normalizedRange = range.endsWith('.pbf') ? range : `${range}.pbf`;
  const body = await readFile(new URL(`${fontstack}/${normalizedRange}`, FONT_RESOURCE_ROOT));
  return reply
    .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
    .type('application/x-protobuf')
    .send(body);
}

export async function tileRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.addHook('onRequest', (request, reply, done) => {
    const requestPath = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && isNonCanonicalPrivatePbfTilePath(requestPath)) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Route not found',
      });
      return;
    }
    done();
  });

  typedApp.post(
    '/tiles/sessions',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['tiles'],
        summary: 'Create signed tile session',
        description:
          'Issues a short-lived signed session token for private Martin-backed tile templates.',
        body: tileSessionRequestSchema,
        response: {
          200: tileSessionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const audience = getScopeAudience(request.body.scope);
      const session = await issueTileSession({
        request,
        reply,
        audience,
        filters: parseSessionRequestFilters(request.body, audience),
      });
      if (!session) {
        return reply;
      }
      return reply.header('Cache-Control', PRIVATE_TILE_CACHE_CONTROL).send(session);
    }
  );

  typedApp.get(
    '/tiles/style/:styleId',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype Martin style resource',
        params: styleResourceParamsSchema,
      },
    },
    async (request, reply) => sendMartinStyleResource(request, reply, request.params.styleId)
  );

  typedApp.get(
    '/tiles/sprite/huishype.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype sprite metadata',
      },
    },
    async (_request, reply) => sendMartinTextResource(reply, 'sprites/huishype.json')
  );

  typedApp.get(
    '/tiles/sprite/huishype@2x.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype 2x sprite metadata',
      },
    },
    async (_request, reply) => sendMartinTextResource(reply, 'sprites/huishype@2x.json')
  );

  typedApp.get(
    '/tiles/sprite/huishype.png',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype sprite image',
      },
    },
    async (_request, reply) => sendMartinBinaryResource(reply, 'sprites/huishype.png', 'image/png')
  );

  typedApp.get(
    '/tiles/sprite/huishype@2x.png',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype 2x sprite image',
      },
    },
    async (_request, reply) =>
      sendMartinBinaryResource(reply, 'sprites/huishype@2x.png', 'image/png')
  );

  typedApp.get(
    '/tiles/font/:fontstack/:range',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get HuisHype font glyph range',
        params: glyphParamsSchema,
        response: {
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await sendFontGlyphResource(reply, request.params.fontstack, request.params.range);
      } catch {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Font glyph range not found',
        });
      }
    }
  );

  typedApp.get(
    '/tiles/base',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get base tile source metadata',
        response: {
          200: tileJsonResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
        .send(
          buildTileJson(
            'HuisHype Base',
            'Base map tiles',
            [buildTileTemplate(getRequestBaseUrl(request), '/tiles/base')],
            0,
            BASE_TILE_MAX_ZOOM
          )
        )
  );

  typedApp.get(
    '/tiles/public_property_nodes',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get public property node tile source metadata',
        response: {
          200: tileJsonResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const filters = parseMapFiltersQuery(
        Object.fromEntries(new URL(request.url, 'http://localhost').searchParams)
      );
      return reply
        .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
        .send(
          buildTileJson(
            'HuisHype Public Properties',
            'Public property node tiles',
            [buildPublicPropertyTileTemplate(getRequestBaseUrl(request), filters)],
            PUBLIC_PROPERTY_TILE_MIN_ZOOM,
            PROPERTY_TILE_MAX_ZOOM
          )
        );
    }
  );

  typedApp.get(
    '/tiles/trees',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get tree tile source metadata',
        response: {
          200: tileJsonResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
        .send(
          buildTileJson(
            'HuisHype Trees',
            'Procedural tree tiles',
            [buildTileTemplate(getRequestBaseUrl(request), '/tiles/trees')],
            TREE_TILE_MIN_ZOOM,
            TREE_TILE_MAX_ZOOM
          )
        )
  );

  typedApp.get(
    '/tiles/buildings',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get building tile source metadata',
        response: {
          200: tileJsonResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header('Cache-Control', STYLE_RESOURCE_CACHE_CONTROL)
        .send(
          buildTileJson(
            'HuisHype Buildings',
            'Building extrusion tiles',
            [buildTileTemplate(getRequestBaseUrl(request), '/tiles/buildings')],
            BUILDING_TILE_MIN_ZOOM,
            BUILDING_TILE_MAX_ZOOM
          )
        )
  );

  const privateReadHandler = async (request: FastifyRequest, reply: FastifyReply) =>
    handlePrivateTileProxy(app, request, reply, 'read-properties');

  const privateFollowingHandler = async (request: FastifyRequest, reply: FastifyReply) =>
    handlePrivateTileProxy(app, request, reply, 'following-properties');

  typedApp.get(
    '/tiles/private_read_property_nodes/:z/:x/:y',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Proxy private read property tile',
        params: tileParamsSchema,
      },
    },
    privateReadHandler
  );

  typedApp.get(
    '/tiles/private_following_property_nodes/:z/:x/:y',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Proxy private Following property tile',
        params: tileParamsSchema,
      },
    },
    privateFollowingHandler
  );

  typedApp.get(
    '/tiles/*',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Proxy public Martin tile/resource path',
        description:
          'Streams public Martin tile, style, sprite, font, catalog, health, and resource responses.',
      },
    },
    async (request, reply) => {
      const requestPath = new URL(request.url, 'http://localhost').pathname;
      if (isLegacyTilePath(requestPath)) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Route not found',
        });
      }
      const filters = requestPath.includes('/public_property_nodes')
        ? parseMapFiltersQuery(
            Object.fromEntries(new URL(request.url, 'http://localhost').searchParams)
          )
        : createDefaultMapFilters();
      const shouldCanonicalizeFilters = requestPath.includes('/public_property_nodes');

      return proxyMartinResponse(app, request, reply, {
        filters: shouldCanonicalizeFilters ? filters : undefined,
      });
    }
  );
}

export type TileParams = z.infer<typeof tileParamsSchema>;
export type TileSessionRequest = z.infer<typeof tileSessionRequestSchema>;

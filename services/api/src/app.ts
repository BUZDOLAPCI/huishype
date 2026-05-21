import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { registerSwagger } from './plugins/swagger.js';
import authPlugin from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { propertyRoutes } from './routes/properties.js';
import { guessRoutes } from './routes/guesses.js';
import { commentRoutes } from './routes/comments.js';
import { likeRoutes } from './routes/likes.js';
import { tileRoutes } from './routes/tiles.js';
import { listingRoutes } from './routes/listings.js';
import { viewRoutes } from './routes/views.js';
import { userRoutes } from './routes/users.js';
import { feedRoutes } from './routes/feed.js';
import { geocodeRoutes } from './routes/geocode.js';
import { notificationRoutes } from './routes/notifications.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { activityRoutes } from './routes/activity.js';
import { achievementRoutes } from './routes/achievements.js';
import { emailAuthRoutes } from './routes/email-auth.js';
import { contactRoutes } from './routes/contact.js';
import { reportRoutes } from './routes/reports.js';
import { closeConnection } from './db/index.js';
import { closeRedisConnection } from './lib/redis.js';
import { setNotificationLogger } from './services/notifications.js';
import { closeIngestQueues } from './services/ingest/index.js';
import { closeCandidateHandoffQueues } from './services/candidate-handoffs/index.js';
import { closeOfficialValuationQueues } from './services/official-valuations/index.js';
import { refreshLatestListingsView } from './services/listings-view.js';
import { config } from './config.js';

export type AppOptions = {
  logger?: boolean;
};

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  let startupListingsRefresh: Promise<void> | null = null;

  const app = Fastify({
    logger: options.logger ?? config.isDev,
    // Trust the X-Forwarded-* headers from Traefik reverse proxy.
    // Without this, request.protocol always returns 'http' (the internal
    // connection), which causes style.json tile/glyph/sprite URLs to use
    // http:// — blocked by the browser's mixed-content policy when the
    // page is served over HTTPS.
    trustProxy: !config.isDev,
  });

  // Wire Fastify logger into notification service for structured logging
  setNotificationLogger(app.log);

  // Close the database connection pool when the app shuts down.
  // This ensures tests calling app.close() also release the pool,
  // preventing Jest worker leak warnings.
  app.addHook('onClose', async () => {
    if (startupListingsRefresh) {
      await startupListingsRefresh;
    }
    await closeCandidateHandoffQueues();
    await closeOfficialValuationQueues();
    await closeIngestQueues();
    await closeRedisConnection();
    await closeConnection();
  });

  // Ensure the latest-listings materialized view is current at startup.
  // Skip this in tests to keep integration startup deterministic and avoid
  // background DB work during teardown.
  // Failure remains non-fatal (stale feed until next ingest).
  app.addHook('onReady', async () => {
    if (config.isTest) {
      return;
    }
    startupListingsRefresh = refreshLatestListingsView().catch((err) => {
      app.log.warn({ err }, 'Startup mv_latest_active_listings refresh failed');
    });
  });

  // Set up Zod type provider for automatic validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register CORS — only permissive in explicit dev mode
  await app.register(cors, {
    origin: config.isDev === true
      ? true
      : process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
        : ['https://huishype.nl', 'https://huishype.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: [
      'ETag',
      'X-Tile-Budget-Ms',
      'X-Tile-Cache',
      'X-Tile-Coalesced',
      'X-Tile-Generation-Time',
      'X-Tile-Queue-Time',
    ],
  });

  // Register response compression (gzip/deflate).
  // Threshold of 1024 bytes avoids compressing tiny responses.
  // customTypes includes application/x-protobuf (PBF vector tiles) which
  // mime-db does not classify as compressible by default.
  // PBF compression is safe: browsers decompress Content-Encoding before
  // MapLibre GL JS sees the bytes. On native, OkHttp does the same —
  // MapLibre Native's is_compressed() only runs for offline/MBTiles sources,
  // not HTTP responses (see mbgl/util/compression.cpp).
  await app.register(compress, {
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
    customTypes: /x-protobuf$/,
  });

  // Register cookie support
  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || (config.isDev ? 'huishype-dev-secret-change-in-production' : ''),
  });

  // Register Swagger/OpenAPI
  await registerSwagger(app);

  // Register auth plugin (must be before routes that use authentication)
  await app.register(authPlugin);

  // Add global error handler
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    app.log.error(error);

    // Handle Zod validation errors
    if (error.validation || error.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        code: error.code ?? 'FST_ERR_VALIDATION',
        message: error.message || 'Request validation failed',
        details: error.validation ?? error.message,
      });
    }

    // Handle other errors
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: error.name || 'INTERNAL_ERROR',
      message: config.isDev ? error.message : 'An unexpected error occurred',
    });
  });

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(propertyRoutes);
  await app.register(guessRoutes);
  await app.register(commentRoutes);
  await app.register(likeRoutes);
  await app.register(tileRoutes);
  await app.register(listingRoutes);
  await app.register(viewRoutes);
  await app.register(userRoutes);
  await app.register(feedRoutes);
  await app.register(geocodeRoutes);
  await app.register(notificationRoutes);
  await app.register(leaderboardRoutes);
  await app.register(activityRoutes);
  await app.register(achievementRoutes);
  await app.register(emailAuthRoutes);
  await app.register(contactRoutes);
  await app.register(reportRoutes);

  // Not found handler
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return app;
}

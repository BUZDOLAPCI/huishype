import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
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
import { reactionRoutes } from './routes/reactions.js';
import { tileRoutes } from './routes/tiles.js';
import { listingRoutes } from './routes/listings.js';
import { viewRoutes } from './routes/views.js';
import { userRoutes } from './routes/users.js';
import { feedRoutes } from './routes/feed.js';
import { config } from './config.js';

export type AppOptions = {
  logger?: boolean;
};

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? config.isDev,
  });

  // Set up Zod type provider for automatic validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register CORS — only permissive in explicit dev mode
  await app.register(cors, {
    origin: config.isDev === true ? true : ['https://huishype.nl', 'https://huishype.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Register cookie support
  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || (config.isDev ? 'huishype-dev-secret-change-in-production' : ''),
  });

  // Register Swagger/OpenAPI
  await registerSwagger(app);

  // Register auth plugin (must be before routes that use authentication)
  await app.register(authPlugin);

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(propertyRoutes);
  await app.register(guessRoutes);
  await app.register(commentRoutes);
  await app.register(reactionRoutes);
  await app.register(tileRoutes);
  await app.register(listingRoutes);
  await app.register(viewRoutes);
  await app.register(userRoutes);
  await app.register(feedRoutes);

  // Add global error handler
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    app.log.error(error);

    // Handle Zod validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      });
    }

    // Handle other errors
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: error.name || 'INTERNAL_ERROR',
      message: config.isDev ? error.message : 'An unexpected error occurred',
    });
  });

  // Not found handler
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return app;
}

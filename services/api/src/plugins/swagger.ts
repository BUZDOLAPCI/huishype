import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { config } from '../config.js';

export async function registerSwagger(app: FastifyInstance) {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'HuisHype API',
        description: 'Social real estate platform API - Browse properties, submit price guesses, and engage with the community',
        version: '0.1.0',
        contact: {
          name: 'HuisHype',
          url: 'https://huishype.nl',
        },
      },
      servers: [
        {
          url: 'http://localhost:3100',
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'properties', description: 'Property management endpoints' },
        { name: 'guesses', description: 'Price guess endpoints' },
        { name: 'comments', description: 'Comment endpoints' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: config.auth.cookie.accessTokenName,
            description: 'HTTP-only browser session cookie set by the /auth/* browser endpoints.',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Explicit non-browser bearer-token contract under /auth/token/*.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
  });
}

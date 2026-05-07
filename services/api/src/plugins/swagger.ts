import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

type OpenApiResponse = {
  headers?: Record<string, unknown>;
};

type OpenApiDocumentWithPaths = {
  paths?: Record<
    string,
    {
      get?: {
        responses?: Record<string, OpenApiResponse>;
      };
    }
  >;
};

const nearbyStatusHeaderValues = [
  'pyramid-promoted',
  'pyramid-empty',
  'pyramid-missing',
  'pyramid-stale',
  'pyramid-unavailable',
  'pyramid-build-active',
  'pyramid-build-enqueued',
  'pyramid-terminal',
  'pyramid-uncovered',
] as const;

function addNearbyResponseHeaders(openapiObject: OpenApiDocumentWithPaths) {
  const document = openapiObject as OpenApiDocumentWithPaths;
  const response = document.paths?.['/properties/nearby']?.get?.responses?.['200'];
  if (!response) {
    return;
  }

  response.headers = {
    ...response.headers,
    'x-huishype-nearby-status': {
      description:
        'Pyramid nearby lookup status for promoted, stale, missing, or unavailable responses.',
      schema: {
        type: 'string',
        enum: nearbyStatusHeaderValues,
      },
    },
    'x-huishype-pyramid-version': {
      description: 'Current pyramid version used by the nearby lookup when applicable.',
      schema: {
        type: 'string',
        format: 'uuid',
      },
    },
  };
}

const transformNearbyResponseHeaders: fastifySwagger.SwaggerTransformObject = (documentObject) => {
  if ('openapiObject' in documentObject) {
    addNearbyResponseHeaders(documentObject.openapiObject as unknown as OpenApiDocumentWithPaths);
    return documentObject.openapiObject;
  }

  return documentObject.swaggerObject;
};

export async function registerSwagger(app: FastifyInstance) {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'HuisHype API',
        description:
          'Social real estate platform API - Browse properties, submit price guesses, and engage with the community',
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
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: transformNearbyResponseHeaders,
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

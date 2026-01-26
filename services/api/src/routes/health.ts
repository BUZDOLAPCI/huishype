import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  version: z.string(),
  uptime: z.number().describe('Server uptime in seconds'),
});

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
}

// Export response type for client usage
export type HealthResponse = z.infer<typeof healthResponseSchema>;

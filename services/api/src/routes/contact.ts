import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { buildContactEmailPayload } from '../services/contact-email-payload.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const successResponseSchema = z.object({
  success: z.boolean(),
});

const contactRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().max(150).optional(),
  message: z.string().trim().min(10).max(5_000),
  website: z.string().trim().max(250).optional(),
});

type ContactRequestBody = z.infer<typeof contactRequestSchema>;

function countUrlLikeTokens(input: string): number {
  return (input.match(/https?:\/\/|www\.|\.com\b|\.ru\b|\.cn\b|\.xyz\b/gi) ?? []).length;
}

function isObviousSpam(body: ContactRequestBody): boolean {
  const combined = `${body.name} ${body.email} ${body.subject ?? ''} ${body.message}`.toLowerCase();
  const spamPatterns = [
    /\bviagra\b/,
    /\bcasino\b/,
    /\bonline slots?\b/,
    /\bcrypto investment\b/,
    /\bloan offer\b/,
    /\bseo backlinks?\b/,
  ];

  if (spamPatterns.some((pattern) => pattern.test(combined))) {
    return true;
  }

  return countUrlLikeTokens(body.message) >= 3;
}

function getUserAgent(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header.join(' ');
  }
  return header;
}

async function sendContactEmail(body: ContactRequestBody, requestContext: {
  ip: string;
  userAgent?: string;
}): Promise<void> {
  if (!config.email.resendApiKey || !config.email.fromAddress) {
    throw new Error('Email delivery is not configured');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildContactEmailPayload({
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message,
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
      timestamp: new Date(),
    })),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail}`);
  }
}

export async function contactRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  await fastify.register(rateLimit, {
    global: false,
    max: 3,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      name: 'RATE_LIMITED',
      error: 'RATE_LIMITED',
      message: 'Too many contact requests. Please try again later.',
    }),
  });

  app.post(
    '/contact',
    {
      schema: {
        tags: ['Contact'],
        summary: 'Submit contact form',
        description: 'Public endpoint for sending a contact form message to HuisHype support.',
        body: contactRequestSchema,
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          429: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      if (body.website) {
        return reply.send({ success: true });
      }

      if (isObviousSpam(body)) {
        return reply.status(400).send({
          error: 'SPAM_REJECTED',
          message: 'Contact message was rejected.',
        });
      }

      try {
        await sendContactEmail(body, {
          ip: request.ip,
          userAgent: getUserAgent(request.headers['user-agent']),
        });
      } catch (error) {
        app.log.error({ err: error }, 'Failed to deliver contact email');
        return reply.status(503).send({
          error: 'EMAIL_DELIVERY_UNAVAILABLE',
          message: 'Contact email delivery is temporarily unavailable.',
        });
      }

      return reply.send({ success: true });
    }
  );
}

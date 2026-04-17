/**
 * Export OpenAPI spec from the live Fastify instance.
 *
 * Usage:
 *   pnpm --filter @huishype/api openapi:export
 *
 * Builds the Fastify app (with all route schemas registered),
 * calls `app.ready()` so @fastify/swagger generates the document,
 * then writes the result to `services/api/openapi.json`.
 *
 * The output is the canonical contract artifact consumed by:
 *   - packages/api-client (openapi-typescript generation)
 *   - packages/mocks (handler alignment)
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type OpenApiSpec = {
  paths?: Record<string, unknown>;
  [key: string]: unknown;
};

type SwaggerApp = FastifyInstance & {
  swagger(): OpenApiSpec | null;
};

async function exportOpenApi() {
  // Dynamically import buildApp so we get the fully-wired Fastify instance
  // with all Zod route schemas registered via @fastify/swagger.
  const { buildApp } = await import('../src/app.js');

  const app = await buildApp({ logger: false });
  const swaggerApp = app as SwaggerApp;

  // @fastify/swagger generates the OpenAPI document during ready()
  await app.ready();

  // The swagger decorator is registered by @fastify/swagger.
  const spec = swaggerApp.swagger();

  if (!spec) {
    console.error('ERROR: No OpenAPI spec generated. Check @fastify/swagger registration.');
    process.exit(1);
  }

  const outPath = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

  // Count routes for verification
  const pathCount = Object.keys(spec.paths || {}).length;
  console.log(`Exported OpenAPI spec: ${pathCount} paths → ${outPath}`);

  await app.close();
}

exportOpenApi().catch((err) => {
  console.error('Failed to export OpenAPI spec:', err);
  process.exit(1);
});

/**
 * @huishype/api-client
 *
 * Typed API client for HuisHype.
 *
 * Contract pipeline:
 *   1. Backend route schemas (services/api/src/routes/*) are the canonical source
 *   2. services/api/openapi.json is exported from the live Fastify OpenAPI document
 *   3. packages/api-client/generated/api.ts is derived from that spec
 *   4. This package re-exports the generated types and thin request helpers
 *
 * Regenerate after any route schema change:
 *   pnpm --filter @huishype/api openapi:export
 *   pnpm --filter @huishype/api-client generate
 */

// Export the client class and factory
export { HuisHypeApiClient, createApiClient, ApiError } from './client.js';
export type { ApiClientOptions } from './client.js';

// Re-export generated OpenAPI types so consumers can reference them
export type { paths, operations, components } from '../generated/api.js';

// Package metadata
export const PACKAGE_NAME = '@huishype/api-client';
export const PACKAGE_VERSION = '0.0.1';

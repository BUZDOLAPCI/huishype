/**
 * @huishype/shared
 *
 * Shared TypeScript types and utilities for HuisHype
 * Used by both the app (Expo) and backend services (Fastify)
 */

// Re-export all types
export * from './types/index.js';

// Re-export all utilities
export * from './utils/index.js';

// Re-export all config
export * from './config/index.js';

// Package metadata
export const PACKAGE_NAME = '@huishype/shared';
export const PACKAGE_VERSION = '0.0.1';

import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export type RuntimeEnv = 'development' | 'test' | 'production';

const RUNTIME_ENVS: ReadonlySet<string> = new Set(['development', 'test', 'production']);

/**
 * Normalize NODE_ENV to a known runtime mode.
 * Missing or blank NODE_ENV should keep local startup usable; explicit unknown
 * values still fail closed to production mode.
 */
export function resolveRuntimeEnv(nodeEnv: string | undefined): RuntimeEnv {
  if (nodeEnv == null || nodeEnv.trim().length === 0) {
    return 'development';
  }

  if (RUNTIME_ENVS.has(nodeEnv)) {
    return nodeEnv as RuntimeEnv;
  }
  return 'production';
}

const env = resolveRuntimeEnv(process.env.NODE_ENV);
const isDev = env === 'development' || env === 'test';

/**
 * Validate that required secrets are present. Called at import time and
 * exported so unit tests can exercise the logic without subprocess tricks.
 */
export function validateProductionSecrets(env: Record<string, string | undefined>, devMode: boolean): void {
  if (devMode) return;
  const missing: string[] = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.JWT_REFRESH_SECRET) missing.push('JWT_REFRESH_SECRET');
  if (!env.COOKIE_SECRET) missing.push('COOKIE_SECRET');
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.MAGIC_LINK_BASE_URL && !env.APP_URL) missing.push('MAGIC_LINK_BASE_URL');
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!env.EMAIL_FROM) missing.push('EMAIL_FROM');
  if (!env.EMAIL_REPLY_TO) missing.push('EMAIL_REPLY_TO');
  if (!env.INGEST_API_KEY) missing.push('INGEST_API_KEY');
  if (!env.FUNDA_SOURCE_SERVICE_URL) missing.push('FUNDA_SOURCE_SERVICE_URL');
  if (!env.FUNDA_SOURCE_SERVICE_API_KEY) missing.push('FUNDA_SOURCE_SERVICE_API_KEY');
  if (!env.PARARIUS_SOURCE_SERVICE_URL) missing.push('PARARIUS_SOURCE_SERVICE_URL');
  if (!env.PARARIUS_SOURCE_SERVICE_API_KEY) missing.push('PARARIUS_SOURCE_SERVICE_API_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
  }
}

// Fail fast: require secrets in production
validateProductionSecrets(process.env as Record<string, string | undefined>, isDev);

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6390',
  },
  server: {
    port: parseInt(process.env.PORT || '3100', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'huishype-dev-jwt-secret-change-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'huishype-dev-refresh-secret-change-in-production',
    accessTokenExpiresIn: '15m', // 15 minutes
    refreshTokenExpiresIn: '7d', // 7 days
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    appleClientId:
      process.env.APPLE_CLIENT_ID ||
      process.env.EXPO_PUBLIC_APPLE_CLIENT_ID ||
      'nl.huishype.app',
    magicLinkBaseUrl:
      process.env.MAGIC_LINK_BASE_URL ||
      process.env.APP_URL ||
      'huishype://auth/callback',
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    fromAddress: process.env.EMAIL_FROM || '',
    replyTo: process.env.EMAIL_REPLY_TO || '',
  },
  photon: {
    url: process.env.PHOTON_URL || 'http://localhost:2322',
  },
  sourceServices: {
    fundaBaseUrl: process.env.FUNDA_SOURCE_SERVICE_URL || 'http://localhost:8100',
    fundaApiKey: process.env.FUNDA_SOURCE_SERVICE_API_KEY || '',
    parariusBaseUrl: process.env.PARARIUS_SOURCE_SERVICE_URL || 'http://localhost:8101',
    parariusApiKey: process.env.PARARIUS_SOURCE_SERVICE_API_KEY || '',
    requestTimeoutMs: parseInt(process.env.SOURCE_SERVICE_REQUEST_TIMEOUT_MS || '15000', 10),
  },
  ingest: {
    listingBodyLimitBytes: parseInt(process.env.INGEST_LISTINGS_BODY_LIMIT_BYTES || String(10 * 1024 * 1024), 10),
  },
  env,
  isDev,
  isTest: env === 'test',
} as const;

export type Config = typeof config;

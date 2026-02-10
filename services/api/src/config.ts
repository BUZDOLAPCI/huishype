import dotenv from 'dotenv';

dotenv.config();

const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || !process.env.NODE_ENV;

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
    appleClientId: process.env.APPLE_CLIENT_ID || 'nl.huishype.app',
  },
  env: process.env.NODE_ENV || 'development',
  isDev,
} as const;

export type Config = typeof config;

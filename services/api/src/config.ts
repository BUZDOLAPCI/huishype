import dotenv from 'dotenv';

dotenv.config();

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5432/huishype',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
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
  isDev: process.env.NODE_ENV !== 'production',
} as const;

export type Config = typeof config;

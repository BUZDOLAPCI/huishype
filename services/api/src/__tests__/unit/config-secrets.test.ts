import { describe, it, expect } from '@jest/globals';
import { validateProductionSecrets, resolveRuntimeEnv } from '../../config.js';

describe('resolveRuntimeEnv', () => {
  it('defaults missing NODE_ENV to development', () => {
    expect(resolveRuntimeEnv(undefined)).toBe('development');
  });

  it('treats an empty NODE_ENV as development', () => {
    expect(resolveRuntimeEnv('')).toBe('development');
  });

  it('treats unknown NODE_ENV as production', () => {
    expect(resolveRuntimeEnv('staging')).toBe('production');
  });

  it('accepts development, test, and production', () => {
    expect(resolveRuntimeEnv('development')).toBe('development');
    expect(resolveRuntimeEnv('test')).toBe('test');
    expect(resolveRuntimeEnv('production')).toBe('production');
  });
});

describe('validateProductionSecrets', () => {
  const fullSecrets = {
    JWT_SECRET: 'jwt-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    COOKIE_SECRET: 'cookie-secret',
    GOOGLE_CLIENT_ID: 'google-client-id',
    MAGIC_LINK_BASE_URL: 'https://huishype.nl/auth/callback',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'HuisHype <noreply@huishype.nl>',
    EMAIL_REPLY_TO: 'support@huishype.nl',
  };

  it('should not throw in dev mode even if all secrets are missing', () => {
    expect(() => validateProductionSecrets({}, true)).not.toThrow();
  });

  it('should not throw in production when all secrets are provided', () => {
    expect(() => validateProductionSecrets(fullSecrets, false)).not.toThrow();
  });

  it('should throw in production when JWT_SECRET is missing', () => {
    const env = { ...fullSecrets, JWT_SECRET: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: JWT_SECRET',
    );
  });

  it('should throw in production when JWT_REFRESH_SECRET is missing', () => {
    const env = { ...fullSecrets, JWT_REFRESH_SECRET: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: JWT_REFRESH_SECRET',
    );
  });

  it('should throw in production when COOKIE_SECRET is missing', () => {
    const env = { ...fullSecrets, COOKIE_SECRET: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: COOKIE_SECRET',
    );
  });

  it('should throw in production when GOOGLE_CLIENT_ID is missing', () => {
    const env = { ...fullSecrets, GOOGLE_CLIENT_ID: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: GOOGLE_CLIENT_ID',
    );
  });

  it('should throw in production when MAGIC_LINK_BASE_URL is missing (and no APP_URL fallback)', () => {
    const env = { ...fullSecrets, MAGIC_LINK_BASE_URL: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: MAGIC_LINK_BASE_URL',
    );
  });

  it('should not throw when MAGIC_LINK_BASE_URL is missing but APP_URL is set', () => {
    const env = { ...fullSecrets, MAGIC_LINK_BASE_URL: undefined, APP_URL: 'https://huishype.nl' };
    expect(() => validateProductionSecrets(env, false)).not.toThrow();
  });

  it('should list all missing secrets in the error message', () => {
    expect(() => validateProductionSecrets({}, false)).toThrow(
      'Missing required secrets in production: JWT_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, GOOGLE_CLIENT_ID, MAGIC_LINK_BASE_URL, RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO',
    );
  });

  it('should throw in production when RESEND_API_KEY is missing', () => {
    const env = { ...fullSecrets, RESEND_API_KEY: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: RESEND_API_KEY',
    );
  });

  it('should throw in production when EMAIL_FROM is missing', () => {
    const env = { ...fullSecrets, EMAIL_FROM: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: EMAIL_FROM',
    );
  });

  it('should throw in production when EMAIL_REPLY_TO is missing', () => {
    const env = { ...fullSecrets, EMAIL_REPLY_TO: undefined };
    expect(() => validateProductionSecrets(env, false)).toThrow(
      'Missing required secrets in production: EMAIL_REPLY_TO',
    );
  });

  it('should treat empty string as missing', () => {
    const env = { JWT_SECRET: '', JWT_REFRESH_SECRET: 'ok', COOKIE_SECRET: 'ok' };
    expect(() => validateProductionSecrets(env, false)).toThrow('JWT_SECRET');
  });
});

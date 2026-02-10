import { describe, it, expect } from '@jest/globals';
import { validateProductionSecrets } from '../../config.js';

describe('validateProductionSecrets', () => {
  const fullSecrets = {
    JWT_SECRET: 'jwt-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    COOKIE_SECRET: 'cookie-secret',
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

  it('should list all missing secrets in the error message', () => {
    expect(() => validateProductionSecrets({}, false)).toThrow(
      'Missing required secrets in production: JWT_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET',
    );
  });

  it('should treat empty string as missing', () => {
    const env = { JWT_SECRET: '', JWT_REFRESH_SECRET: 'ok', COOKIE_SECRET: 'ok' };
    expect(() => validateProductionSecrets(env, false)).toThrow('JWT_SECRET');
  });
});

import { assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe } from './runtime-config.mjs';

export const CI_DATABASE_FIXTURE_ALLOW_ENV = 'PLAYWRIGHT_ALLOW_CI_DATABASE_FIXTURE';

/** Explicit bootstrap for an ephemeral test database, never normal development data. */
export function assertCiDatabaseFixtureTarget(env, databaseName) {
  if (env[CI_DATABASE_FIXTURE_ALLOW_ENV] !== '1') {
    throw new Error(`CI fixture bootstrap requires ${CI_DATABASE_FIXTURE_ALLOW_ENV}=1.`);
  }
  if (env.NODE_ENV !== 'test') throw new Error('CI fixture bootstrap requires NODE_ENV=test.');
  if (!env.DATABASE_URL) throw new Error('CI fixture bootstrap requires an explicit DATABASE_URL.');
  const target = assertPlaywrightPropertyTilePyramidFixtureTargetIsSafe(env, { requireExplicitAllow: false });
  if (!databaseName || target.databaseName !== databaseName) {
    throw new Error('CI fixture bootstrap requires --database-name to match DATABASE_URL exactly.');
  }
  if (!databaseName.endsWith('_test') || /prod|coolify|(^|_)(dev|development)(_|$)/i.test(databaseName)) {
    throw new Error('CI fixture bootstrap requires a dedicated *_test database, excluding development and production names.');
  }
  return target;
}

export function assertConnectedCiFixtureTarget(target, connected) {
  const address = connected?.server_addr?.replace(/\/\d+$/, '') ?? null;
  if (!connected || connected.database_name !== target.databaseName
    || (target.user && connected.user_name !== target.user)
    || (address !== null && !['127.0.0.1', '::1'].includes(address)
      && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))) {
    throw new Error('Connected PostgreSQL target does not match the dedicated local test database.');
  }
}

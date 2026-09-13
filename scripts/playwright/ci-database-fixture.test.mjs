import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCiDatabaseFixtureTarget, assertConnectedCiFixtureTarget } from './ci-database-fixture.mjs';

const allowed = { NODE_ENV: 'test', PLAYWRIGHT_ALLOW_CI_DATABASE_FIXTURE: '1',
  DATABASE_URL: 'postgresql://test:fixture-only@127.0.0.1:5432/huishype_test' };

test('CI fixture bootstrap permits only an explicitly named local test target', () => {
  const target = assertCiDatabaseFixtureTarget(allowed, 'huishype_test');
  assert.equal(target.databaseName, 'huishype_test');
  assertConnectedCiFixtureTarget(target, { database_name: 'huishype_test', user_name: 'test', server_addr: '172.18.0.2' });
});

test('CI fixture bootstrap rejects implicit, remote, mismatched, development and production targets', () => {
  for (const env of [{ ...allowed, PLAYWRIGHT_ALLOW_CI_DATABASE_FIXTURE: undefined },
    { ...allowed, NODE_ENV: 'development' }, { ...allowed, NODE_ENV: 'production' },
    { ...allowed, DATABASE_URL: undefined }, { ...allowed, DATABASE_URL: allowed.DATABASE_URL.replace('127.0.0.1', 'example.com') }]) {
    assert.throws(() => assertCiDatabaseFixtureTarget(env, 'huishype_test'));
  }
  assert.throws(() => assertCiDatabaseFixtureTarget(allowed, 'another_test'));
  for (const name of ['huishype', 'dev_test', 'production_test', 'coolify_test']) {
    assert.throws(() => assertCiDatabaseFixtureTarget({ ...allowed, DATABASE_URL: allowed.DATABASE_URL.replace('huishype_test', name) }, name));
  }
});

test('CI fixture bootstrap verifies the connected database, user and server address', () => {
  const target = assertCiDatabaseFixtureTarget(allowed, 'huishype_test');
  const connected = { database_name: 'huishype_test', user_name: 'test', server_addr: '127.0.0.1' };
  for (const value of [null, { ...connected, database_name: 'huishype' },
    { ...connected, user_name: 'another' }, { ...connected, server_addr: '203.0.113.1' }]) {
    assert.throws(() => assertConnectedCiFixtureTarget(target, value));
  }
});

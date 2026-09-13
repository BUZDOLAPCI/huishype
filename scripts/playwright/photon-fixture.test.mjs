import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { photonFixtureResponse, startPlaywrightPhotonFixture } from './photon-fixture.mjs';

test('fixture is explicit opt-in and rejects production mode', async () => {
  for (const value of [undefined, '0', 'true']) {
    assert.equal(await startPlaywrightPhotonFixture({ PLAYWRIGHT_PHOTON_FIXTURE: value }), null);
  }
  await assert.rejects(
    startPlaywrightPhotonFixture({ PLAYWRIGHT_PHOTON_FIXTURE: '1', NODE_ENV: 'production' })
  );
});

test('real loopback HTTP returns Photon hierarchy, search and closes idempotently', async () => {
  const fixture = await startPlaywrightPhotonFixture({
    PLAYWRIGHT_PHOTON_FIXTURE: '1',
    NODE_ENV: 'test',
  });
  try {
    assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${fixture.url}/reverse?lon=4.8952&lat=52.3702&lang=nl`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.type, 'FeatureCollection');
    assert.equal(result.features[0].type, 'Feature');
    assert.deepEqual(result.features[0].geometry, {
      type: 'Point',
      coordinates: [4.8952, 52.3702],
    });
    assert.deepEqual(
      Object.fromEntries(
        ['country', 'city', 'district', 'locality'].map((key) => [
          key,
          result.features[0].properties[key],
        ])
      ),
      {
        country: 'Nederland',
        city: 'Amsterdam',
        district: 'Centrum',
        locality: 'Burgwallen-Oude Zijde',
      }
    );
    const search = await fetch(`${fixture.url}/api/?q=Eindhoven&limit=5&countrycode=nl`);
    assert.equal((await search.json()).features[0].properties.city, 'Eindhoven');
    assert.equal((await fetch(`${fixture.url}/reverse?lon=0&lat=0`)).status, 422);
  } finally {
    await Promise.all([fixture.close(), fixture.close()]);
  }
  await assert.rejects(fetch(`${fixture.url}/reverse?lon=4.8952&lat=52.3702`));
});

test('deliberate camera, address, fitBounds and geolocation targets are covered', () => {
  for (const [lon, lat, city] of [
    [5.4697, 51.4416, 'Eindhoven'],
    [5.48, 51.49, 'Eindhoven'],
    [5.4525952, 51.4588672, 'Eindhoven'],
    [5.5186267, 51.4385345, 'Eindhoven'],
    [5.46, 51.435, 'Eindhoven'],
    [5.455, 51.385, 'Waalre'],
    [5.56, 51.49, 'Nuenen'],
    [5.1214, 52.0907, 'Utrecht'],
    [4.4777, 51.9244, 'Rotterdam'],
    [4.3007, 52.0705, 'Den Haag'],
    [5.19, 51.58, 'Oisterwijk'],
  ]) {
    const response = photonFixtureResponse('GET', `/reverse?lon=${lon}&lat=${lat}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.features[0].properties.city, city);
  }
});

test('unexpected routes, coordinates, search strings and parameters fail closed', () => {
  for (const [method, url, status] of [
    ['POST', '/reverse?lon=4.8952&lat=52.3702', 405],
    ['GET', '/unknown', 404],
    ['GET', '/reverse?lon=0&lat=0', 422],
    ['GET', '/reverse?lon=&lat=52.37', 422],
    ['GET', '/reverse?lon=NaN&lat=52.37', 422],
    ['GET', '/reverse?lon=4.8952', 422],
    ['GET', '/reverse?lon=4.8952&lat=52.3702&extra=1', 422],
    ['GET', '/reverse?lon=4.8952&lon=4.9&lat=52.3702', 422],
    ['GET', '/api?q=unknown', 422],
    ['GET', '/api?q=Amsterdam&countrycode=DE', 422],
    ['GET', '/api?q=Amsterdam&limit=0', 422],
    ['GET', '/api?q=Amsterdam&lang=xx', 422],
  ])
    assert.equal(photonFixtureResponse(method, url).status, status, url);
});

// Exercise both actual wrapper entrypoints without a DB or API child. The
// preload substitutes only the synchronous DB preflight, exactly where cleanup
// used to be registered too late. Everything through provider startup and
// process-level failure/signal cleanup remains the real wrapper implementation.
for (const wrapper of ['integration-runtime.mjs', 'run-playwright-project.mjs']) {
  for (const scenario of ['failure', 'signal']) {
    test(`${wrapper} closes provider on preflight ${scenario}`, { timeout: 10_000 }, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'playwright-photon-cleanup-'));
      const preload = path.join(directory, 'preload.mjs');
      await writeFile(
        preload,
        `
        import cp from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        const original = cp.execFileSync;
        cp.execFileSync = (command, args, options) => {
          if (args?.includes('scripts/ensure-playwright-property-tile-pyramid.ts')) {
            process.send({ url: options.env.PHOTON_URL });
            if (process.env.FIXTURE_TEST_SCENARIO === 'failure') throw new Error('synthetic preflight failure');
            process.emit('SIGTERM', 'SIGTERM');
            return '';
          }
          return original(command, args, options);
        };
        syncBuiltinESMExports();
      `
      );
      const child = fork(fileURLToPath(new URL(wrapper, import.meta.url)), [], {
        execArgv: ['--import', preload],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PLAYWRIGHT_PHOTON_FIXTURE: '1',
          FIXTURE_TEST_SCENARIO: scenario,
          DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5440/playwright_fixture_test',
          PLAYWRIGHT_API_PORT: '43101',
          PLAYWRIGHT_WEB_PORT: '43102',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      try {
        const exit = once(child, 'exit');
        const message = await Promise.race([
          once(child, 'message'),
          exit.then(() => {
            throw new Error(output);
          }),
        ]);
        assert.match(message[0].url, /^http:\/\/127\.0\.0\.1:\d+$/);
        const [code] = await exit;
        assert.equal(code, scenario === 'failure' ? 1 : 0, output);
        await assert.rejects(fetch(`${message[0].url}/reverse?lon=4.8952&lat=52.3702`));
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}

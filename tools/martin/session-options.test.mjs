import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expectedOptions = '-c statement_timeout=5000 -c work_mem=32MB';
const expectedEncodedOptions = 'options=-c%20statement_timeout%3D5000%20-c%20work_mem%3D32MB';

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractUrl(text) {
  const match = text.match(/postgresql:\/\/[^\s'"}]+/);
  assert.ok(match, 'Expected to find a PostgreSQL URL');
  return match[0];
}

test('tracked Martin URL defaults use the intended readonly session options', () => {
  for (const relativePath of ['docker-compose.yml', '.env.production.example', 'docs/runbooks/martin-deployment.md']) {
    const text = readRepoFile(relativePath);
    assert.ok(text.includes(expectedEncodedOptions), `${relativePath} should include encoded Martin session options`);

    const url = extractUrl(text);
    assert.equal(new URL(url).searchParams.get('options'), expectedOptions, `${relativePath} should decode options exactly`);
  }
});

test('readonly Martin role settings match the URL session options', () => {
  for (const relativePath of [
    'services/api/drizzle/0015_martin_map_projection.sql',
    'services/api/drizzle/0018_martin_tile_session_settings.sql',
    'tools/martin/readonly-role.sql',
  ]) {
    const text = readRepoFile(relativePath);
    assert.match(text, /ALTER ROLE martin_tile SET statement_timeout = '5000ms';/, `${relativePath} should set 5000ms statement_timeout`);
    assert.match(text, /ALTER ROLE martin_tile SET work_mem = '32MB';/, `${relativePath} should set 32MB work_mem`);
  }
});

test('Martin public property minzoom starts at z8 to match the legacy lowZoom795 contract', () => {
  const text = readRepoFile('services/api/drizzle/0022_martin_property_owner_tile_parity.sql');
  assert.match(text, /WHERE z >= 8/);
  assert.doesNotMatch(text, /IF z < 9 THEN/);

  const config = readRepoFile('martin/config.yaml');
  assert.match(
    config,
    /public_property_nodes:\n\s+schema: martin_tiles\n\s+function: property_nodes\n\s+minzoom: 8\n\s+maxzoom: 22/,
    'Martin config should not publish z7 public property tiles',
  );

  for (const relativePath of ['martin/styles/huishype.json', 'martin/styles/huishype-native.json']) {
    const style = JSON.parse(readRepoFile(relativePath));
    assert.equal(style.sources['properties-source'].minzoom, 8, `${relativePath} property source minzoom`);
  }
});

test('Martin styles keep the visual parity light and tree source contract', () => {
  for (const relativePath of ['martin/styles/huishype.json', 'martin/styles/huishype-native.json']) {
    const style = JSON.parse(readRepoFile(relativePath));
    assert.deepEqual(
      style.light,
      {
        anchor: 'map',
        color: '#FFF6EA',
        intensity: 0.2,
        position: [1.15, 240, 45],
      },
      `${relativePath} should match the shared MapLibre light contract`,
    );
    assert.equal(style.sources['tree-source'].minzoom, 15, `${relativePath} tree source minzoom`);
    assert.equal(style.sources['tree-source'].maxzoom, 20, `${relativePath} tree source maxzoom`);
  }

  const config = readRepoFile('martin/config.yaml');
  assert.match(
    config,
    /trees:\n\s+schema: martin_tiles\n\s+function: trees\n\s+minzoom: 15\n\s+maxzoom: 20/,
    'Martin config should publish tree function tiles through z20',
  );
});

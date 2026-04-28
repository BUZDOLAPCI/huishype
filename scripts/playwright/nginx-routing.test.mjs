import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nginxConfigPath = path.join(repoRoot, 'apps/app/nginx.conf');
const nginxConfig = fs.readFileSync(nginxConfigPath, 'utf8');

function assertOrderedContains(source, expectedParts) {
  let previousIndex = -1;

  for (const part of expectedParts) {
    const index = source.indexOf(part, previousIndex + 1);
    assert.notEqual(index, -1, `Expected to find "${part}" after index ${previousIndex}`);
    previousIndex = index;
  }
}

test('production nginx routes direct loads to exported Expo dynamic HTML templates', () => {
  assertOrderedContains(nginxConfig, [
    'location ~ ^/map/.+/?$',
    'try_files $uri $uri.html $uri/ /map/[...address].html /index.html;',
  ]);

  assertOrderedContains(nginxConfig, [
    'location ~ ^/user/[^/]+/?$',
    'try_files $uri $uri.html $uri/ /user/[id].html /index.html;',
  ]);

  assertOrderedContains(nginxConfig, [
    'location ~ ^/@[^/]+/?$',
    'try_files $uri $uri.html $uri/ /@[camera].html /index.html;',
  ]);

  assertOrderedContains(nginxConfig, [
    'location / {',
    'try_files $uri $uri.html $uri/ /[...address].html /index.html;',
  ]);
});

test('production nginx preserves concrete files and missing assets before route fallbacks', () => {
  assertOrderedContains(nginxConfig, [
    'location ^~ /_expo/ {',
    'try_files $uri =404;',
  ]);

  assertOrderedContains(nginxConfig, [
    'location ^~ /assets/ {',
    'try_files $uri =404;',
  ]);

  assertOrderedContains(nginxConfig, [
    'location ~* \\.(css|gif|html|ico|jpe?g|js|json|map|mjs|png|svg|txt|webp|woff2?)$',
    'try_files $uri =404;',
  ]);

  const assetLocationIndex = nginxConfig.indexOf(
    'location ~* \\.(css|gif|html|ico|jpe?g|js|json|map|mjs|png|svg|txt|webp|woff2?)$',
  );
  const firstDynamicLocationIndex = nginxConfig.indexOf('location ~ ^/map/.+/?$');

  assert.ok(
    assetLocationIndex !== -1 && firstDynamicLocationIndex !== -1,
    'Expected both asset and dynamic route locations to exist',
  );
  assert.ok(
    assetLocationIndex < firstDynamicLocationIndex,
    'Asset-like paths must be handled before dynamic route templates',
  );
});

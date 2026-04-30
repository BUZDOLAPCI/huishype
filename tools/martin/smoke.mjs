#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = (process.env.MARTIN_BASE_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
const requestTimeoutMs = Number(process.env.MARTIN_SMOKE_TIMEOUT_MS || 8000);

const sourceIds = (process.env.MARTIN_SMOKE_SOURCES ||
  'public_property_nodes,private_read_property_nodes,private_following_property_nodes,buildings,trees,base')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const sampleTiles = [
  ['public property nodes', process.env.MARTIN_PUBLIC_TILE || '/tiles/public_property_nodes/13/4207/2692', 'binary-optional'],
  ['buildings', process.env.MARTIN_BUILDING_TILE || '/tiles/buildings/15/16892/10898', 'binary-optional'],
  ['trees', process.env.MARTIN_TREE_TILE || '/tiles/trees/15/16892/10898', 'binary-optional'],
  [
    'private read overlay',
    `${process.env.MARTIN_READ_TILE || '/tiles/private_read_property_nodes/13/4207/2692'}${
      process.env.MARTIN_READ_QUERY || ''
    }`,
    'binary-optional',
  ],
  [
    'private following overlay',
    `${process.env.MARTIN_FOLLOWING_TILE || '/tiles/private_following_property_nodes/13/4207/2692'}${
      process.env.MARTIN_FOLLOWING_QUERY || ''
    }`,
    'binary-optional',
  ],
];

const checks = [
  ['catalog', '/tiles/catalog', 'json'],
  ['health', '/tiles/health', 'text'],
  ...sourceIds.map((sourceId) => [`TileJSON ${sourceId}`, `/tiles/${sourceId}`, 'json']),
  ['style huishype', '/tiles/style/huishype', 'json'],
  ['sprite JSON', '/tiles/sprite/huishype.json', 'json'],
  ['sprite PNG', '/tiles/sprite/huishype.png', 'binary'],
  ['sprite JSON @2x', '/tiles/sprite/huishype@2x.json', 'json'],
  ['sprite PNG @2x', '/tiles/sprite/huishype@2x.png', 'binary'],
  [
    'font range',
    process.env.MARTIN_FONT_RANGE || '/tiles/font/Space%20Mono%20Regular/0-255',
    'binary',
  ],
  ...sampleTiles.map(([label, path, type]) => [label, path, type]),
  ['metrics', '/tiles/_/metrics', 'text'],
];

const fail = (message) => {
  throw new Error(message);
};

const fetchWithTimeout = async (path) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: '*/*',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};

const readBody = async (response, type) => {
  if (type === 'json') {
    return response.json();
  }
  if (type === 'text') {
    return response.text();
  }
  return response.arrayBuffer();
};

for (const [label, path, type] of checks) {
  if (path.includes('.pbf')) {
    fail(`${label} uses a .pbf tile URL: ${path}`);
  }

  const response = await fetchWithTimeout(path);
  if (response.status >= 300 && response.status < 400) {
    fail(`${label} redirected with ${response.status}; expected direct extensionless route: ${path}`);
  }
  if (!response.ok && !(type === 'binary-optional' && response.status === 204)) {
    const body = await response.text().catch(() => '');
    fail(`${label} failed ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  const body = response.status === 204 ? new ArrayBuffer(0) : await readBody(response, type);
  if (type === 'json') {
    const serialized = JSON.stringify(body);
    if (serialized.includes('.pbf')) {
      fail(`${label} response contains a .pbf URL template.`);
    }
    if (label.startsWith('TileJSON')) {
      const tiles = Array.isArray(body.tiles) ? body.tiles : [];
      if (tiles.length === 0) {
        fail(`${label} did not include tile templates.`);
      }
      for (const tileUrl of tiles) {
        if (!tileUrl.includes('/tiles/')) {
          fail(`${label} tile template does not preserve /tiles prefix: ${tileUrl}`);
        }
      }
    }
  } else if (type === 'binary' && body.byteLength === 0) {
    fail(`${label} returned an empty body.`);
  }

  console.log(`ok ${label} ${response.status}`);
  await delay(Number(process.env.MARTIN_SMOKE_DELAY_MS || 0));
}

const metricsResponse = await fetchWithTimeout('/tiles/_/metrics');
const metrics = await metricsResponse.text();
for (const label of ['app="huishype"', 'service="martin"']) {
  if (!metrics.includes(label)) {
    fail(`metrics output is missing label ${label}`);
  }
}

console.log(`Martin smoke checks passed for ${baseUrl}`);

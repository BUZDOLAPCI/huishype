import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../services/api/package.json', import.meta.url));
const postgres = require('postgres');

function encodeVarint(value) {
  const bytes = [];
  let next = value >>> 0;
  while (next > 0x7f) {
    bytes.push((next & 0x7f) | 0x80);
    next >>>= 7;
  }
  bytes.push(next);
  return Buffer.from(bytes);
}

function encodeString(fieldNumber, value) {
  const body = Buffer.from(value);
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(body.length), body]);
}

function encodeVarintField(fieldNumber, value) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 0), encodeVarint(value)]);
}

function encodeBytesField(fieldNumber, body) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(body.length), body]);
}

function encodeDoubleField(fieldNumber, value) {
  const body = Buffer.allocUnsafe(8);
  body.writeDoubleLE(value, 0);
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 1), body]);
}

function encodePackedVarintField(fieldNumber, values) {
  const body = Buffer.concat(values.map((value) => encodeVarint(value)));
  return encodeBytesField(fieldNumber, body);
}

function encodeBooleanValue(value) {
  return Buffer.concat([encodeVarint((7 << 3) | 0), encodeVarint(value ? 1 : 0)]);
}

function encodeDoubleValue(value) {
  return encodeDoubleField(3, value);
}

function encodeStringValue(value) {
  return encodeString(1, value);
}

function encodeIntValue(value) {
  return encodeVarintField(4, value);
}

function zigZag(value) {
  return (value << 1) ^ (value >> 31);
}

function encodePointGeometry(x, y) {
  return [9, zigZag(x), zigZag(y)];
}

function encodePolygonGeometry(points) {
  if (points.length < 4) {
    return [];
  }

  const [first, ...rest] = points;
  const geometry = [9, zigZag(first.x), zigZag(first.y), (2 | (rest.length << 3))];
  let previous = first;
  for (const point of rest) {
    geometry.push(zigZag(point.x - previous.x), zigZag(point.y - previous.y));
    previous = point;
  }
  geometry.push(15);
  return geometry;
}

function lonLatToGlobalTileCoordinate(lon, lat, z) {
  const scale = 2 ** z;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function lonLatToTilePoint(lon, lat, z, x, y, extent) {
  const global = lonLatToGlobalTileCoordinate(lon, lat, z);
  return {
    x: Math.round((global.x - x) * extent),
    y: Math.round((global.y - y) * extent),
  };
}

function isPointInTile(point, extent) {
  return point.x >= 0 && point.x <= extent && point.y >= 0 && point.y <= extent;
}

function encodeFeature({ id, properties, point, geometry, type = 1 }) {
  const tags = [];
  for (const [keyIndex, valueIndex] of Object.entries(properties)) {
    tags.push(Number(keyIndex), valueIndex);
  }

  const fields = [
    encodeVarintField(1, id),
    encodePackedVarintField(2, tags),
    encodeVarintField(3, type),
    encodePackedVarintField(4, geometry ?? encodePointGeometry(point.x, point.y)),
  ];
  const body = Buffer.concat(fields);
  return encodeBytesField(2, body);
}

function buildLayerDictionaries(features) {
  const keys = [];
  const keyIndexes = new Map();
  const values = [];
  const valueIndexes = new Map();

  function getKeyIndex(key) {
    if (!keyIndexes.has(key)) {
      keyIndexes.set(key, keys.length);
      keys.push(key);
    }
    return keyIndexes.get(key);
  }

  function getValueIndex(value) {
    const signature = `${typeof value}:${String(value)}`;
    if (!valueIndexes.has(signature)) {
      valueIndexes.set(signature, values.length);
      values.push(value);
    }
    return valueIndexes.get(signature);
  }

  const encodedFeatures = features.map((feature) => {
    const properties = {};
    for (const [key, value] of Object.entries(feature.properties)) {
      if (value === null || value === undefined) {
        continue;
      }
      properties[getKeyIndex(key)] = getValueIndex(value);
    }
    return { ...feature, properties };
  });

  return { keys, values, features: encodedFeatures };
}

function encodeValue(value) {
  if (typeof value === 'boolean') {
    return encodeBooleanValue(value);
  }
  if (Number.isInteger(value)) {
    return encodeIntValue(value);
  }
  if (typeof value === 'number') {
    return encodeDoubleValue(value);
  }
  return encodeStringValue(String(value));
}

function encodeLayer(name, features = []) {
  const dictionaries = buildLayerDictionaries(features);
  const layer = Buffer.concat([
    encodeString(1, name),
    ...dictionaries.features.map((feature) => encodeFeature(feature)),
    ...dictionaries.keys.map((key) => encodeString(3, key)),
    ...dictionaries.values.map((value) => encodeBytesField(4, encodeValue(value))),
    encodeVarintField(5, 4096),
    encodeVarintField(15, 2),
  ]);
  return Buffer.concat([encodeVarint((3 << 3) | 2), encodeVarint(layer.length), layer]);
}

const FALLBACK_PROPERTY_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];

const FALLBACK_GHOST_PROPERTY_IDS = [
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
];

const EINDHOVEN_CLUSTER_BBOX = [5.4689, 51.4409, 5.4712, 51.4424];

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    'postgresql://huishype:huishype_dev@localhost:5440/huishype'
  );
}

async function loadEindhovenPropertyIds() {
  const sql = postgres(getDatabaseUrl(), { max: 1, onnotice: () => {} });

  try {
    const rows = await sql`
      SELECT id::text AS id
      FROM properties
      WHERE city = 'Eindhoven'
        AND status = 'active'
        AND geometry IS NOT NULL
      ORDER BY
        CASE WHEN postal_code = '5651HA' AND house_number = 41 THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        id
      LIMIT 9
    `;
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (ids.length >= 3) {
      return ids;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[mock-martin] Failed to load Eindhoven property IDs: ${message}`);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }

  return [...FALLBACK_PROPERTY_IDS, ...FALLBACK_GHOST_PROPERTY_IDS];
}

function takeIds(ids, start, count, fallback) {
  const selected = ids.slice(start, start + count);
  while (selected.length < count) {
    selected.push(fallback[selected.length % fallback.length]);
  }
  return selected;
}

function buildPropertyPointFixtures(allPropertyIds) {
  const propertyIds = takeIds(allPropertyIds, 0, 6, FALLBACK_PROPERTY_IDS);
  const ghostPropertyIds = takeIds(allPropertyIds, 6, 3, FALLBACK_GHOST_PROPERTY_IDS);

  const fixtures = [
    {
    lon: 5.4697,
    lat: 51.4416,
    minZoom: 0,
    maxZoom: 16,
    properties: {
      node_class: 'active',
      group_kind: 'cluster',
      primary_property_id: propertyIds[0],
      point_count: propertyIds.length,
      property_ids: propertyIds.join(','),
      preview_property_ids: propertyIds.join(','),
      bbox_west: EINDHOVEN_CLUSTER_BBOX[0],
      bbox_south: EINDHOVEN_CLUSTER_BBOX[1],
      bbox_east: EINDHOVEN_CLUSTER_BBOX[2],
      bbox_north: EINDHOVEN_CLUSTER_BBOX[3],
      activeListingCount: 3,
      completedListingCount: 1,
      socialCount: 5,
      recentSocialCount: 2,
      socialScoreTotal: 14,
      socialScoreMax: 5,
      recentSocialScoreTotal: 8,
      commentCount: 4,
      hasActiveListing: true,
      marketState: 'for-sale',
      id: propertyIds[0],
    },
    },
    {
    lon: 5.46958,
    lat: 51.44125,
    minZoom: 17,
    maxZoom: 22,
    properties: {
      node_class: 'active',
      group_kind: 'single',
      primary_property_id: propertyIds[0],
      point_count: 1,
      property_ids: propertyIds[0],
      preview_property_ids: propertyIds[0],
      activeListingCount: 1,
      completedListingCount: 0,
      socialCount: 2,
      recentSocialCount: 1,
      socialScoreTotal: 6,
      socialScoreMax: 4,
      recentSocialScoreTotal: 3,
      commentCount: 2,
      address: 'Markt 1',
      city: 'Eindhoven',
      askingPrice: 425000,
      hasActiveListing: true,
      marketState: 'for-sale',
      id: propertyIds[0],
    },
    },
    {
    lon: 5.46992,
    lat: 51.44098,
    minZoom: 17,
    maxZoom: 22,
    properties: {
      node_class: 'active',
      group_kind: 'single',
      primary_property_id: propertyIds[1],
      point_count: 1,
      property_ids: propertyIds[1],
      preview_property_ids: propertyIds[1],
      activeListingCount: 0,
      completedListingCount: 1,
      socialCount: 1,
      recentSocialCount: 0,
      socialScoreTotal: 2,
      socialScoreMax: 2,
      recentSocialScoreTotal: 0,
      commentCount: 1,
      address: 'Markt 2',
      city: 'Eindhoven',
      askingPrice: 385000,
      hasActiveListing: false,
      marketState: 'sold',
      id: propertyIds[1],
    },
    },
    {
    lon: 5.46928,
    lat: 51.44082,
    minZoom: 17,
    maxZoom: 22,
    properties: {
      node_class: 'ghost',
      group_kind: 'cluster',
      primary_property_id: ghostPropertyIds[0],
      point_count: ghostPropertyIds.length,
      property_ids: ghostPropertyIds.join(','),
      preview_property_ids: ghostPropertyIds.join(','),
      bbox_west: 5.4696,
      bbox_south: 51.4411,
      bbox_east: 5.4702,
      bbox_north: 51.4414,
      activeListingCount: 0,
      completedListingCount: 0,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      commentCount: 0,
      hasActiveListing: false,
      marketState: 'not-listed',
      id: ghostPropertyIds[0],
    },
    },
    {
    lon: 5.47012,
    lat: 51.44072,
    minZoom: 17,
    maxZoom: 22,
    properties: {
      node_class: 'ghost',
      group_kind: 'single',
      primary_property_id: ghostPropertyIds[1],
      point_count: 1,
      property_ids: ghostPropertyIds[1],
      preview_property_ids: ghostPropertyIds[1],
      activeListingCount: 0,
      completedListingCount: 0,
      socialCount: 0,
      recentSocialCount: 0,
      socialScoreTotal: 0,
      socialScoreMax: 0,
      recentSocialScoreTotal: 0,
      commentCount: 0,
      hasActiveListing: false,
      marketState: 'not-listed',
      id: ghostPropertyIds[1],
    },
    },
  ];

  const visualCenters = [
    [5.488, 51.4307],
    [5.746, 51.4],
  ];

  visualCenters.forEach(([lon, lat], centerIndex) => {
    fixtures.push({
      lon,
      lat,
      minZoom: 16,
      maxZoom: 22,
      properties: {
        node_class: 'active',
        group_kind: 'single',
        primary_property_id: propertyIds[centerIndex % propertyIds.length],
        point_count: 1,
        property_ids: propertyIds[centerIndex % propertyIds.length],
        preview_property_ids: propertyIds[centerIndex % propertyIds.length],
        activeListingCount: 1,
        completedListingCount: 0,
        socialCount: 2,
        recentSocialCount: 1,
        socialScoreTotal: 6,
        socialScoreMax: 4,
        recentSocialScoreTotal: 3,
        commentCount: 2,
        address: `Visual Fixture ${centerIndex + 1}`,
        city: 'Eindhoven',
        askingPrice: 425000 + centerIndex * 25000,
        hasActiveListing: true,
        marketState: 'for-sale',
        id: propertyIds[centerIndex % propertyIds.length],
      },
    });
  });

  return fixtures;
}

function treeFeaturesForTile(pathname) {
  const match = pathname.match(/^\/tiles\/trees\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
  if (!match) {
    return [];
  }

  const z = Number(match[1]);
  if (!Number.isInteger(z) || z < 15) {
    return [];
  }

  return [
    { id: 1, point: { x: 1800, y: 1800 }, properties: { kind: 'tree' } },
    { id: 2, point: { x: 2300, y: 2050 }, properties: { kind: 'tree' } },
    { id: 3, point: { x: 2050, y: 2450 }, properties: { kind: 'tree' } },
  ];
}

function buildingFeaturesForTile(pathname) {
  const match = pathname.match(/^\/tiles\/buildings\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
  if (!match) {
    return [];
  }

  const z = Number(match[1]);
  if (!Number.isInteger(z) || z < 14) {
    return [];
  }

  const points = [
    { x: 1750, y: 1750 },
    { x: 2450, y: 1750 },
    { x: 2450, y: 2450 },
    { x: 1750, y: 2450 },
    { x: 1750, y: 1750 },
  ];

  return [{
    id: 1,
    type: 3,
    geometry: encodePolygonGeometry(points),
    properties: {
      render_height: 12,
      render_base: 0,
    },
  }];
}

function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y, z) {
  const radians = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
  return (radians * 180) / Math.PI;
}

function tileBbox(z, x, y) {
  return {
    west: tileXToLon(x, z),
    north: tileYToLat(y, z),
    east: tileXToLon(x + 1, z),
    south: tileYToLat(y + 1, z),
  };
}

function activityCutoffIso(activity) {
  const now = Date.now();
  if (activity === 'today') {
    return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  }
  if (activity === '10d') {
    return new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (activity === '30d') {
    return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

async function followingPropertyFeaturesForTile(sql, url) {
  const match = url.pathname.match(
    /^\/tiles\/private_following_property_nodes\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/
  );
  if (!match) {
    return null;
  }

  const viewerId = url.searchParams.get('viewer_id');
  if (!viewerId) {
    return [];
  }

  const [, zRaw, xRaw, yRaw] = match;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return [];
  }

  const bbox = tileBbox(z, x, y);
  const cutoffIso = activityCutoffIso(url.searchParams.get('activity') ?? 'all-time');
  const rows = await sql`
    WITH tile AS (
      SELECT ST_Transform(
        ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326),
        3857
      ) AS geom_3857
    ),
    following_activity AS (
      SELECT
        a.property_id,
        COUNT(*)::int AS social_count,
        COUNT(*) FILTER (
          WHERE a.activity_at > NOW() - INTERVAL '7 days'
        )::int AS recent_social_count,
        SUM(a.score)::double precision AS social_score_total,
        MAX(a.score)::double precision AS social_score_max,
        COALESCE(SUM(a.score) FILTER (
          WHERE a.activity_at > NOW() - INTERVAL '7 days'
        ), 0)::double precision AS recent_social_score_total
      FROM user_follows uf
      INNER JOIN map_property_actor_activity a ON a.actor_user_id = uf.followed_user_id
      CROSS JOIN tile
      WHERE uf.follower_user_id = ${viewerId}
        AND ST_Intersects(a.geom_3857, tile.geom_3857)
        AND (${cutoffIso}::timestamptz IS NULL OR a.activity_at >= ${cutoffIso}::timestamptz)
      GROUP BY a.property_id
    )
    SELECT
      f.property_id::text AS id,
      ST_X(ST_Transform(f.geom_3857, 4326)) AS lon,
      ST_Y(ST_Transform(f.geom_3857, 4326)) AS lat,
      f.address,
      f.city,
      f.asking_price,
      f.thumbnail_url,
      f.has_active_listing,
      f.market_state,
      f.active_listing_count,
      f.completed_listing_count,
      f.comment_count,
      fa.social_count,
      fa.recent_social_count,
      fa.social_score_total,
      fa.social_score_max,
      fa.recent_social_score_total
    FROM map_public_property_facts f
    INNER JOIN following_activity fa ON fa.property_id = f.property_id
    CROSS JOIN tile
    WHERE ST_Intersects(f.geom_3857, tile.geom_3857)
    ORDER BY fa.recent_social_score_total DESC, fa.social_score_total DESC, f.property_id
    LIMIT 64
  `;

  return Array.from(rows).flatMap((row, index) => {
    const point = lonLatToTilePoint(Number(row.lon), Number(row.lat), z, x, y, 4096);
    if (!isPointInTile(point, 4096)) {
      return [];
    }

    return [{
      id: index + 1,
      point,
      properties: {
        node_class: 'active',
        group_kind: 'single',
        primary_property_id: row.id,
        point_count: 1,
        property_ids: row.id,
        preview_property_ids: row.id,
        activeListingCount: Number(row.active_listing_count ?? 0),
        completedListingCount: Number(row.completed_listing_count ?? 0),
        socialCount: Number(row.social_count ?? 0),
        recentSocialCount: Number(row.recent_social_count ?? 0),
        socialScoreTotal: Number(row.social_score_total ?? 0),
        socialScoreMax: Number(row.social_score_max ?? 0),
        recentSocialScoreTotal: Number(row.recent_social_score_total ?? 0),
        commentCount: Number(row.comment_count ?? 0),
        address: row.address ?? '',
        city: row.city ?? '',
        askingPrice: Number(row.asking_price ?? 0),
        thumbnailUrl: row.thumbnail_url ?? null,
        hasActiveListing: row.has_active_listing === true,
        marketState: row.market_state ?? 'not-listed',
        id: row.id,
      },
    }];
  });
}

function propertyFeaturesForTile(pathname, propertyPointFixtures) {
  const match = pathname.match(
    /^\/tiles\/(?:public_property_nodes|private_read_property_nodes|private_following_property_nodes)\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/
  );
  if (!match) {
    return [];
  }

  const [, zRaw, xRaw, yRaw] = match;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return [];
  }

  return propertyPointFixtures.flatMap((fixture, index) => {
    if (z < fixture.minZoom || z > fixture.maxZoom) {
      return [];
    }

    const point = lonLatToTilePoint(fixture.lon, fixture.lat, z, x, y, 4096);
    if (!isPointInTile(point, 4096)) {
      return [];
    }

    return [{ id: index + 1, point, properties: fixture.properties }];
  });
}

async function vectorTileForPath(url, propertyPointFixtures, sql) {
  const pathname = url.pathname;
  if (pathname.includes('/buildings/')) {
    return Buffer.concat([encodeLayer('buildings', buildingFeaturesForTile(pathname))]);
  }
  if (pathname.includes('/trees/')) {
    return Buffer.concat([encodeLayer('scattered-trees', treeFeaturesForTile(pathname))]);
  }
  if (pathname.includes('/base/')) {
    return Buffer.concat([encodeLayer('base')]);
  }

  const followingFeatures = await followingPropertyFeaturesForTile(sql, url);
  return Buffer.concat([
    encodeLayer(
      'properties',
      followingFeatures ?? propertyFeaturesForTile(pathname, propertyPointFixtures)
    ),
  ]);
}

function tileJson(sourceId, baseUrl) {
  return {
    tilejson: '3.0.0',
    name: sourceId,
    tiles: [`${baseUrl}/tiles/${sourceId}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
    bounds: [-180, -85.0511, 180, 85.0511],
  };
}

export async function startMockMartinServer({ port = 0, host = '127.0.0.1' } = {}) {
  const propertyPointFixtures = buildPropertyPointFixtures(await loadEindhovenPropertyIds());
  const sql = postgres(getDatabaseUrl(), { max: 2, onnotice: () => {} });
  const server = createServer(async (request, response) => {
    try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
    const baseUrl = `http://${request.headers.host ?? `${host}:${port}`}`;

    if (url.pathname === '/tiles/health' || url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }

    if (url.pathname === '/tiles/catalog') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          tiles: [
            'public_property_nodes',
            'private_read_property_nodes',
            'private_following_property_nodes',
            'base',
            'buildings',
            'trees',
          ],
        })
      );
      return;
    }

    const tileJsonMatch = url.pathname.match(/^\/tiles\/([^/]+)$/);
    if (tileJsonMatch) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(tileJson(tileJsonMatch[1], baseUrl)));
      return;
    }

    if (url.pathname === '/tiles/_/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('martin_mock_requests_total{app="huishype",service="martin"} 1\n');
      return;
    }

    const isPrivateTile = url.pathname.includes('/private_');
    response.writeHead(200, {
      'content-type': 'application/x-protobuf',
      'cache-control': isPrivateTile ? 'no-store' : 'public, max-age=30',
    });
    response.end(await vectorTileForPath(url, propertyPointFixtures, sql));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(message);
    }
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host }, () => {
      server.off('error', reject);
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        url: `http://${host}:${selectedPort}`,
        port: selectedPort,
        stop: () =>
          new Promise((stopResolve, stopReject) => {
            const forceCloseTimer = setTimeout(() => {
              server.closeAllConnections?.();
            }, 1_000);
            forceCloseTimer.unref?.();

            server.close((error) => {
              clearTimeout(forceCloseTimer);
              sql.end({ timeout: 1 }).finally(() =>
                error ? stopReject(error) : stopResolve()
              );
            });
            server.closeIdleConnections?.();
          }),
      });
    });
  });

  return ready;
}

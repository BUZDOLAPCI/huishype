import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { generateAccessToken } from '../../plugins/auth.js';
import { createIntegrationProperty } from './helpers/fixtures.js';
import { markPropertyRead } from '../../services/property-read-state.js';

describe('Tile gateway control plane', () => {
  let app: FastifyInstance;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const anonSessionId1 = '00000000-0000-4000-8000-000000000101';
  const anonSessionId2 = '00000000-0000-4000-8000-000000000102';
  const anonSessionId3 = '00000000-0000-4000-8000-000000000103';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  function mockMartinResponse(body = 'tile-bytes', headers: Record<string, string> = {}) {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(body, {
          status: 200,
          headers: {
            'content-type': 'application/x-protobuf',
            'cache-control': 'public, max-age=86400',
            ...headers,
          },
        })
    );
  }

  function mockMartinJsonResponse(body: unknown, headers: Record<string, string> = {}) {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'public, max-age=60',
            ...headers,
          },
        })
    );
  }

  it('issues signed read tile sessions for anonymous sessions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': anonSessionId1 },
      payload: { scope: 'read' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');

    const body = JSON.parse(response.body);
    expect(body.tokenType).toBe('HuisHypeTileSession');
    expect(body.scope).toBe('read');
    expect(body.audience).toBe('read-properties');
    expect(body.tiles.template).toContain('/tiles/private_read_property_nodes/{z}/{x}/{y}');
    expect(body.tiles.template).not.toContain('.pbf');
    expect(body.tiles.template).toContain('tile_session=');
  });

  it('rejects weak anonymous read tile session identifiers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': 'anon-session-1' },
      payload: { scope: 'read' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'BAD_REQUEST',
    });
  });

  it('rejects private tile requests without a signed session token', async () => {
    mockMartinResponse();

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/private_read_property_nodes/12/1/1',
    });

    expect(response.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('strips spoofed trusted params and injects anonymous session params before proxying', async () => {
    mockMartinResponse();

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': anonSessionId2 },
      payload: { scope: 'read', readVersion: 7 },
    });
    const session = JSON.parse(sessionResponse.body);
    const token = encodeURIComponent(session.token);

    const response = await app.inject({
      method: 'GET',
      url:
        `/tiles/private_read_property_nodes/12/1/1?tile_session=${token}` +
        '&userId=00000000-0000-4000-8000-000000009999' +
        '&viewer_id=spoof-user&viewerId=00000000-0000-4000-8000-000000009998' +
        '&anonymous_session_id=spoof-session&anonymousSessionId=spoof-camel' +
        '&sessionId=spoof-session-id&read_version=999&readVersion=888' +
        '&marketState=sold,for-sale&salePriceTo=500000',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('tile-bytes');
    expect(response.headers['cache-control']).toBe('private, no-store');

    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.pathname).toBe('/tiles/private_read_property_nodes/12/1/1');
    expect(proxiedUrl.searchParams.get('userId')).toBeNull();
    expect(proxiedUrl.searchParams.get('viewer_id')).toBeNull();
    expect(proxiedUrl.searchParams.get('viewerId')).toBeNull();
    expect(proxiedUrl.searchParams.get('readVersion')).toBeNull();
    expect(proxiedUrl.searchParams.get('sessionId')).toBeNull();
    expect(proxiedUrl.searchParams.get('anonymousSessionId')).toBeNull();
    expect(proxiedUrl.searchParams.get('anonymous_session_id')).toBeNull();
    expect(proxiedUrl.searchParams.get('session_id')).toBe(anonSessionId2);
    expect(proxiedUrl.searchParams.get('read_version')).toBe('empty');
    expect(proxiedUrl.searchParams.get('session_jti')).toEqual(expect.any(String));
    expect(proxiedUrl.searchParams.get('marketState')).toBe('for-sale,sold');
    expect(proxiedUrl.searchParams.get('salePriceTo')).toBe('500000');
  });

  it('returns 404 for non-canonical private .pbf tile routes without proxying', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    const privatePbfUrls = [
      '/tiles/private_read_property_nodes/12/1/1.pbf',
      '/tiles/private_following_property_nodes/12/1/1.pbf',
    ];

    for (const url of privatePbfUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
      });

      expect(response.statusCode).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects tile-session audience mismatches before proxying', async () => {
    mockMartinResponse();

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': anonSessionId3 },
      payload: { scope: 'read' },
    });
    const session = JSON.parse(sessionResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: `/tiles/private_following_property_nodes/12/1/1?tile_session=${encodeURIComponent(
        session.token
      )}`,
    });

    expect(response.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects stale replayed read tile sessions after read state changes', async () => {
    mockMartinResponse();
    const sessionId = '00000000-0000-4000-8000-000000000104';
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': sessionId },
      payload: { scope: 'read' },
    });
    const session = JSON.parse(sessionResponse.body);
    const property = await createIntegrationProperty({
      street: 'Tile Replay Street',
      lon: 5.52,
      lat: 51.42,
    });

    try {
      await markPropertyRead(property.id, { sessionId });

      const response = await app.inject({
        method: 'GET',
        url: `/tiles/private_read_property_nodes/12/1/1?tile_session=${encodeURIComponent(session.token)}`,
      });

      expect(response.statusCode).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
    }
  });

  it('requires authentication before issuing following tile sessions', async () => {
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      payload: { scope: 'following' },
    });

    expect(unauthenticated.statusCode).toBe(401);

    const accessToken = generateAccessToken(app, '00000000-0000-4000-8000-000000000001');
    const authenticated = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { scope: 'following' },
    });

    expect(authenticated.statusCode).toBe(200);
    expect(JSON.parse(authenticated.body).tiles.template).toContain(
      '/tiles/private_following_property_nodes/{z}/{x}/{y}'
    );
    expect(JSON.parse(authenticated.body).tiles.template).not.toContain('.pbf');
  });

  it('injects server-derived following versions separately from the token id', async () => {
    mockMartinResponse();

    const userId = '00000000-0000-4000-8000-000000000001';
    const accessToken = generateAccessToken(app, userId);
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { scope: 'following', followVersion: 'spoof' },
    });
    const session = JSON.parse(sessionResponse.body);

    const response = await app.inject({
      method: 'GET',
      url:
        `/tiles/private_following_property_nodes/12/1/1?tile_session=${encodeURIComponent(session.token)}` +
        '&viewer_id=00000000-0000-4000-8000-000000009999&follow_version=spoof',
    });

    expect(response.statusCode).toBe(200);
    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.searchParams.get('viewer_id')).toBe(userId);
    expect(proxiedUrl.searchParams.get('follow_version')).toMatch(/^[0-9a-f]{32}$/);
    expect(proxiedUrl.searchParams.get('session_jti')).toEqual(expect.any(String));
    expect(proxiedUrl.searchParams.get('follow_version')).not.toBe(
      proxiedUrl.searchParams.get('session_jti')
    );
  });

  it('serves Martin-owned style and source metadata without proxying tile bytes', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const styleResponse = await app.inject({
      method: 'GET',
      url: '/tiles/style/huishype',
      headers: { host: '127.0.0.1:3201' },
    });
    expect(styleResponse.statusCode).toBe(200);
    expect(styleResponse.headers['content-type']).toContain('application/json');
    const style = JSON.parse(styleResponse.body);
    expect(style).toMatchObject({
      version: 8,
      sources: {
        'base-source': {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
        },
        'properties-source': {
          minzoom: 8,
          maxzoom: 22,
          promoteId: 'primary_property_id',
        },
        'buildings-source': {
          minzoom: 15,
          maxzoom: 17,
        },
        'tree-source': {
          minzoom: 15,
          maxzoom: 20,
        },
      },
    });
    expect(style.sprite).toBe('http://127.0.0.1:3201/tiles/sprite/huishype');
    expect(style.glyphs).toBe('http://127.0.0.1:3201/tiles/font/{fontstack}/{range}');
    expect(style.sources['base-source'].tiles).toBeUndefined();
    expect(style.sources['base-source'].maxzoom).toBeUndefined();
    expect(style.sources['properties-source'].url).toBe(
      'http://127.0.0.1:3201/tiles/public_property_nodes'
    );
    const layerIds = style.layers.map((layer: { id: string }) => layer.id);
    expect(layerIds).toEqual(
      expect.arrayContaining([
        'park',
        'water',
        '3d-buildings',
        'paper-trees',
        'property-cluster-pulse',
        'property-clusters',
        'property-cluster-fill',
        'active-node-pulse',
        'active-nodes',
        'active-node-fill',
        'ghost-clusters',
        'ghost-cluster-count',
        'ghost-nodes',
      ])
    );

    const waterLayer = style.layers.find((layer: { id: string }) => layer.id === 'water');
    expect(waterLayer.paint).toMatchObject({
      'fill-color': '#aad0e6',
      'fill-pattern': 'water-pattern',
    });

    const propertyClusterPulse = style.layers.find(
      (layer: { id: string }) => layer.id === 'property-cluster-pulse'
    );
    expect(JSON.stringify(propertyClusterPulse)).toContain('recentSocialScoreTotal');

    const activeNodeLayer = style.layers.find(
      (layer: { id: string }) => layer.id === 'active-nodes'
    );
    expect(JSON.stringify(activeNodeLayer)).toContain('completedListingCount');

    const ghostClusterLayer = style.layers.find(
      (layer: { id: string }) => layer.id === 'ghost-clusters'
    );
    expect(ghostClusterLayer).toMatchObject({
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: 17,
    });

    const tileJsonResponse = await app.inject({
      method: 'GET',
      url: '/tiles/public_property_nodes?salePriceFrom=300000',
      headers: { host: '127.0.0.1:3201' },
    });
    expect(tileJsonResponse.statusCode).toBe(200);
    const tileJson = JSON.parse(tileJsonResponse.body);
    expect(tileJson.tiles[0]).toContain(
      'http://127.0.0.1:3201/tiles/public_property_nodes/{z}/{x}/{y}'
    );
    expect(tileJson.tiles[0]).toContain('salePriceFrom=300000');
    expect(tileJson.minzoom).toBe(8);
    expect(tileJson.maxzoom).toBe(22);

    const buildingTileJsonResponse = await app.inject({
      method: 'GET',
      url: '/tiles/buildings',
    });
    expect(buildingTileJsonResponse.statusCode).toBe(200);
    const buildingTileJson = JSON.parse(buildingTileJsonResponse.body);
    expect(buildingTileJson.minzoom).toBe(15);
    expect(buildingTileJson.maxzoom).toBe(17);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves native style with external OpenFreeMap base tiles inlined', async () => {
    mockMartinJsonResponse({
      tilejson: '3.0.0',
      tiles: ['https://tiles.openfreemap.org/planet/current/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
      bounds: [-180, -85.05113, 180, 85.05113],
      attribution: 'OpenFreeMap',
    });

    const styleResponse = await app.inject({
      method: 'GET',
      url: '/tiles/style/huishype-native',
      headers: { host: '127.0.0.1:3201' },
    });

    expect(styleResponse.statusCode).toBe(200);
    const style = JSON.parse(styleResponse.body);
    expect(style.sources['base-source']).toMatchObject({
      type: 'vector',
      tiles: ['https://tiles.openfreemap.org/planet/current/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
      attribution: 'OpenFreeMap',
    });
    expect(style.sources['base-source'].url).toBeUndefined();
    expect(style.sources['properties-source'].tiles).toEqual([
      'http://127.0.0.1:3201/tiles/public_property_nodes/{z}/{x}/{y}',
    ]);
    expect(style.sources['properties-source'].tiles[0]).not.toContain('.pbf');

    const fetchedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(fetchedUrl.href).toBe('https://tiles.openfreemap.org/planet');
  });

  it('proxies base TileJSON through Martin and rewrites tile URLs to the API origin', async () => {
    mockMartinJsonResponse({
      tilejson: '3.0.0',
      name: 'base',
      tiles: ['http://martin.internal:3111/tiles/base/{z}/{x}/{y}'],
      minzoom: 0,
      maxzoom: 1,
      bounds: [-180, -85.0511, 180, 85.0511],
      vector_layers: [{ id: 'water', fields: {} }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/base',
      headers: { host: '127.0.0.1:3201' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.tiles).toEqual(['http://127.0.0.1:3201/tiles/base/{z}/{x}/{y}']);
    expect(body.maxzoom).toBe(1);
    expect(body.vector_layers).toEqual([{ id: 'water', fields: {} }]);

    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.pathname).toBe('/tiles/base');
  });

  it('proxies tree TileJSON through Martin and preserves Martin maxzoom', async () => {
    mockMartinJsonResponse({
      tilejson: '3.0.0',
      name: 'trees',
      tiles: ['http://martin.internal:3111/tiles/trees/{z}/{x}/{y}'],
      minzoom: 15,
      maxzoom: 20,
      bounds: [-180, -85.0511, 180, 85.0511],
      vector_layers: [{ id: 'scattered-trees', fields: { tree_variant: 'Number' } }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/trees',
      headers: { host: '127.0.0.1:3201' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      description: 'Procedural tree tiles',
      minzoom: 15,
      maxzoom: 20,
    });
    expect(body.tiles).toEqual(['http://127.0.0.1:3201/tiles/trees/{z}/{x}/{y}']);
    expect(body.vector_layers).toEqual([
      { id: 'scattered-trees', fields: { tree_variant: 'Number' } },
    ]);

    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.pathname).toBe('/tiles/trees');
  });

  it('does not serve the legacy style alias', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/style.json',
    });

    expect(response.statusCode).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves sprite resources from the Martin resource bundle', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const metadata = await app.inject({
      method: 'GET',
      url: '/tiles/sprite/huishype.json',
    });
    expect(metadata.statusCode).toBe(200);
    expect(JSON.parse(metadata.body)).toMatchObject({
      'tree-0': expect.any(Object),
      'water-pattern': expect.any(Object),
    });

    const image = await app.inject({
      method: 'GET',
      url: '/tiles/sprite/huishype.png',
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.rawPayload.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves /tiles on public Martin proxy paths and strips trusted params', async () => {
    mockMartinResponse('public-tile');

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/public_property_nodes/12/1/1?salePriceTo=10&viewer_id=spoof',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('public-tile');

    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.pathname).toBe('/tiles/public_property_nodes/12/1/1');
    expect(proxiedUrl.searchParams.get('salePriceTo')).toBe('10');
    expect(proxiedUrl.searchParams.get('viewer_id')).toBeNull();
  });

  it('proxies base tile bytes through the public Martin gateway path', async () => {
    mockMartinResponse('base-tile');

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/base/13/4207/2692?viewer_id=spoof',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('base-tile');

    const proxiedUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(proxiedUrl.pathname).toBe('/tiles/base/13/4207/2692');
    expect(proxiedUrl.searchParams.get('viewer_id')).toBeNull();
  });

  it('validates base tile coordinates before proxying to Martin', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await app.inject({
      method: 'GET',
      url: '/tiles/base/12/4096/1',
    });

    expect(response.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for legacy property tile routes without proxying to Martin', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    const legacyUrls = [
      '/tiles/properties.json',
      '/tiles/properties/12/1/1.pbf',
      '/tiles/properties/read.json',
      '/tiles/properties/read/12/1/1.pbf',
      '/tiles/following/properties.json',
      '/tiles/following/properties/12/1/1.pbf',
    ];

    for (const url of legacyUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
      });

      expect(response.statusCode).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('strips stale Martin body metadata after fetch decompression', async () => {
    mockMartinResponse('private-tile', {
      'content-encoding': 'gzip',
      'content-length': '999',
    });

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/tiles/sessions',
      headers: { 'x-session-id': anonSessionId1 },
      payload: { scope: 'read' },
    });
    const session = JSON.parse(sessionResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: `/tiles/private_read_property_nodes/12/1/1?tile_session=${encodeURIComponent(session.token)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('private-tile');
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-length']).not.toBe('999');
  });
});

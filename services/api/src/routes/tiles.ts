import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vector Tile Route for Property Clustering
 *
 * Implements high-performance Dynamic Vector Tile (MVT) service that efficiently
 * renders properties based on zoom level and activity.
 *
 * Business Logic:
 * - Z0-Z16: Show only "Active" properties (has listing OR has activity)
 *   - Properties are clustered using ST_SnapToGrid for performance
 *   - Ghost nodes (no listing, no activity) are filtered out
 * - Z17+: Show ALL properties including Ghost nodes
 *   - Individual points returned without clustering
 *
 * Performance:
 * - Uses ST_SnapToGrid NOT ST_ClusterDBSCAN (much faster for dynamic tiles)
 * - Returns ST_AsMVT (binary PBF format, not GeoJSON)
 * - Tiles are cacheable with short TTL for social activity propagation
 */

// Tile coordinate schema
const tileParamsSchema = z.object({
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

// Font file path schema
const fontParamsSchema = z.object({
  fontstack: z.string(),
  range: z.string().regex(/^\d+-\d+\.pbf$/),
});

// Zoom level threshold for showing ghost nodes
const GHOST_NODE_THRESHOLD_ZOOM = 17;

// Grid cell size in degrees for clustering at different zoom levels
// Smaller = more clusters, Larger = fewer clusters
function getGridCellSize(zoom: number): number {
  // At zoom 0, world is 360 degrees
  // Each zoom level doubles resolution
  // baseCellSize equals the tile width in degrees at this zoom
  const baseCellSize = 360 / Math.pow(2, zoom);
  // Use 0.5x tile width so each tile contains ~2x2 grid cells.
  // Previously 4x, which made the grid cell larger than the tile,
  // causing ST_SnapToGrid to push cluster centroids outside the tile
  // bbox -- ST_AsMVTGeom then clipped them to NULL, returning empty tiles.
  return baseCellSize * 0.5;
}

/**
 * Convert tile coordinates to bounding box in EPSG:4326 (WGS84)
 * Standard Web Mercator tile scheme (TMS/XYZ)
 */
function tileToBBox(z: number, x: number, y: number): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  const n = Math.pow(2, z);

  // X coordinate to longitude
  const minLon = (x / n) * 360 - 180;
  const maxLon = ((x + 1) / n) * 360 - 180;

  // Y coordinate to latitude (inverted because tile Y increases downward)
  const minLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const maxLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const minLat = (minLatRad * 180) / Math.PI;
  const maxLat = (maxLatRad * 180) / Math.PI;

  return { minLon, minLat, maxLon, maxLat };
}

// Zoom threshold for ghost nodes (frontend layers)
// Must match GHOST_NODE_THRESHOLD_ZOOM so backend serves is_ghost at the same zoom frontend expects it
const GHOST_NODE_FRONTEND_ZOOM = 17;

// 3D Buildings configuration
const BUILDINGS_3D_CONFIG = {
  minZoom: 14,
  colors: {
    base: '#FFFFFF',
  },
  opacity: 1.0,
  heightMultiplier: 1.0,
};

// Resolve the fonts directory relative to this file.
// In dev (tsx) __dirname isn't available with ESM, so derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// fonts/ lives at services/api/fonts/ — two levels up from src/routes/
const FONTS_DIR = join(__dirname, '..', '..', 'fonts');

/**
 * Build the property layers array for the merged style.
 * These are the canonical layer definitions — both web and native clients
 * consume them from /tiles/style.json.
 *
 * Layer IDs match what web e2e tests expect:
 *   property-clusters, cluster-count, single-active-points, active-nodes, ghost-nodes
 */
function buildPropertyLayers(): Array<Record<string, unknown>> {
  return [
    // Cluster circles (Z0-Z16)
    {
      id: 'property-clusters',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      maxzoom: GHOST_NODE_FRONTEND_ZOOM,
      filter: ['>', ['coalesce', ['get', 'point_count'], 0], 1],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['coalesce', ['get', 'point_count'], 2],
          2, 18, 10, 24, 50, 32, 100, 40,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'has_active_children'], true], '#FF5A5F',
          '#51bbd6',
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    // Cluster count labels
    {
      id: 'cluster-count',
      type: 'symbol',
      source: 'properties-source',
      'source-layer': 'properties',
      maxzoom: GHOST_NODE_FRONTEND_ZOOM,
      filter: ['>', ['coalesce', ['get', 'point_count'], 0], 1],
      layout: {
        'text-field': ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 14,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    },
    // Single active points at low zoom (Z0-Z16) — activity-score based styling
    {
      id: 'single-active-points',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      maxzoom: GHOST_NODE_FRONTEND_ZOOM,
      filter: [
        'all',
        ['any', ['!', ['has', 'point_count']], ['==', ['coalesce', ['get', 'point_count'], 0], 1]],
      ],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0],
          0, 8,
          50, 12,
          100, 16,
        ],
        'circle-color': [
          'case',
          ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 50],
          '#EF4444', // red-500 (hot)
          ['>', ['coalesce', ['get', 'activityScore'], ['get', 'max_activity'], 0], 0],
          '#F97316', // orange-500 (warm)
          '#3B82F6', // blue-500 (cold)
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    // Active nodes (Z17+) — activity-score based styling
    {
      id: 'active-nodes',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: GHOST_NODE_FRONTEND_ZOOM,
      filter: ['==', ['get', 'is_ghost'], false],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'activityScore'], 0],
          0, 6,
          50, 10,
          100, 14,
        ],
        'circle-color': [
          'case',
          ['>', ['coalesce', ['get', 'activityScore'], 0], 50],
          '#EF4444',
          ['>', ['coalesce', ['get', 'activityScore'], 0], 0],
          '#F97316',
          '#3B82F6',
        ],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    // Ghost nodes (Z17+)
    {
      id: 'ghost-nodes',
      type: 'circle',
      source: 'properties-source',
      'source-layer': 'properties',
      minzoom: GHOST_NODE_FRONTEND_ZOOM,
      filter: ['==', ['get', 'is_ghost'], true],
      paint: {
        'circle-radius': 3,
        'circle-color': '#94A3B8',
        'circle-opacity': 0.4,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-opacity': 0.5,
      },
    },
  ];
}

/**
 * Build 3D buildings fill-extrusion layer definition.
 */
function build3DBuildingsLayer(): Record<string, unknown> {
  return {
    id: '3d-buildings',
    source: 'openmaptiles',
    'source-layer': 'building',
    type: 'fill-extrusion',
    minzoom: BUILDINGS_3D_CONFIG.minZoom,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': BUILDINGS_3D_CONFIG.colors.base,
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 1,
        [
          '*',
          ['coalesce', ['get', 'render_height'], 10],
          BUILDINGS_3D_CONFIG.heightMultiplier,
        ],
      ],
      'fill-extrusion-base': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 1,
        ['coalesce', ['get', 'render_min_height'], 0],
      ],
      'fill-extrusion-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 0.5,
        BUILDINGS_3D_CONFIG.opacity,
      ],
      'fill-extrusion-vertical-gradient': false,
    },
  };
}

export async function tileRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /fonts/:fontstack/:range.pbf
   *
   * Serves self-hosted glyph PBF files for MapLibre text rendering.
   * Replaces the external dependency on demotiles.maplibre.org.
   */
  typedApp.get(
    '/fonts/:fontstack/:range',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get glyph PBF range for a font',
        description: 'Returns a PBF file containing glyphs for the requested font and Unicode range.',
        params: fontParamsSchema,
      },
    },
    async (request, reply) => {
      const { fontstack, range } = request.params;

      // Sanitise path components to prevent directory traversal
      const safeFontstack = fontstack.replace(/[^a-zA-Z0-9 _-]/g, '');
      const safeRange = range.replace(/[^0-9-.pbf]/g, '');

      const filePath = join(FONTS_DIR, safeFontstack, safeRange);

      try {
        const data = await readFile(filePath);
        return reply
          .header('Content-Type', 'application/x-protobuf')
          .header('Cache-Control', 'public, max-age=604800, immutable')
          .send(data);
      } catch {
        // Try fallback: if a composite fontstack was requested (e.g. "Noto Sans Regular,Arial Unicode MS Regular"),
        // try just the first font in the comma-separated list
        if (safeFontstack.includes(',')) {
          const firstFont = safeFontstack.split(',')[0].trim();
          const fallbackPath = join(FONTS_DIR, firstFont, safeRange);
          try {
            const data = await readFile(fallbackPath);
            return reply
              .header('Content-Type', 'application/x-protobuf')
              .header('Cache-Control', 'public, max-age=604800, immutable')
              .send(data);
          } catch {
            // Fall through to 404
          }
        }
        return reply.status(404).send({ error: 'Font range not found' });
      }
    }
  );

  /**
   * GET /tiles/style.json
   *
   * Returns a MapLibre style JSON that merges the OpenFreeMap Positron base style
   * with our property vector tile source, property layers, and 3D buildings.
   * This is the SINGLE SOURCE OF TRUTH for map styling — both web and native
   * clients consume this endpoint.
   *
   * Cached for 60s to avoid repeated upstream fetches.
   * The cache is cloned before mutation to avoid corrupting the cached object.
   */
  let cachedStyle: { data: Record<string, unknown>; fetchedAt: number } | null = null;
  typedApp.get(
    '/tiles/style.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get merged map style with property layers',
        description: 'Returns MapLibre style JSON with base map + property vector tiles.',
      },
    },
    async (request, reply) => {
      const protocol = request.protocol;
      const host = request.host;
      const baseUrl = `${protocol}://${host}`;
      const tileUrl = `${baseUrl}/tiles/properties/{z}/{x}/{y}.pbf`;
      const glyphsUrl = `${baseUrl}/fonts/{fontstack}/{range}.pbf`;

      // Check cache (60s TTL)
      const now = Date.now();
      if (cachedStyle && now - cachedStyle.fetchedAt < 60000) {
        // Deep-clone the cached style to avoid mutating the shared cache object
        const style = JSON.parse(JSON.stringify(cachedStyle.data)) as Record<string, unknown>;
        // Patch dynamic URLs that depend on the request host
        const sources = style.sources as Record<string, unknown>;
        const propSource = sources['properties-source'] as Record<string, unknown>;
        propSource.tiles = [tileUrl];
        style.glyphs = glyphsUrl;
        return reply
          .header('Cache-Control', 'public, max-age=60')
          .send(style);
      }

      try {
        // Fetch base style from OpenFreeMap
        const resp = await fetch('https://tiles.openfreemap.org/styles/positron');
        const baseStyle = await resp.json() as Record<string, unknown>;

        const sources = { ...(baseStyle.sources as Record<string, unknown>) };
        const layers = [...(baseStyle.layers as Array<Record<string, unknown>>)];

        // Override glyphs URL to use self-hosted fonts
        baseStyle.glyphs = glyphsUrl;

        // Add property vector tile source
        sources['properties-source'] = {
          type: 'vector',
          tiles: [tileUrl],
          minzoom: 0,
          maxzoom: 22,
        };

        // Fade out existing 2D building fill layers at high zoom (for 3D transition)
        layers.forEach((layer, index) => {
          const isBuilding =
            layer.id?.toString().includes('building') &&
            layer['source-layer'] === 'building';

          if (isBuilding && layer.type === 'fill') {
            const existingPaint = (layer.paint as Record<string, unknown>) || {};
            layers[index] = {
              ...layer,
              paint: {
                ...existingPaint,
                'fill-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  BUILDINGS_3D_CONFIG.minZoom,
                  1,
                  BUILDINGS_3D_CONFIG.minZoom + 0.5,
                  0,
                ],
              },
            };
          }
        });

        // Find label layer to insert 3D buildings below
        const labelLayerIndex = layers.findIndex(
          (layer) => layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']
        );

        // Insert 3D buildings layer below labels (or at end if no label layer found)
        const buildings3DLayer = build3DBuildingsLayer();
        if (labelLayerIndex !== -1) {
          layers.splice(labelLayerIndex, 0, buildings3DLayer);
        } else {
          layers.push(buildings3DLayer);
        }

        // Add property layers on top
        layers.push(...buildPropertyLayers());

        const merged = { ...baseStyle, sources, layers };
        cachedStyle = { data: merged, fetchedAt: now };

        return reply
          .header('Cache-Control', 'public, max-age=60')
          .send(merged);
      } catch (err) {
        app.log.error(err, 'Failed to fetch base style');
        return reply.status(502).send({ error: 'Failed to build merged style' });
      }
    }
  );

  /**
   * GET /tiles/properties.json
   *
   * Returns TileJSON metadata for the property vector tiles.
   * Used by MapLibre native to discover tile URLs.
   */
  typedApp.get(
    '/tiles/properties.json',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get property tile metadata (TileJSON)',
        description: 'Returns TileJSON 2.1.0 metadata for property vector tiles.',
      },
    },
    async (request, reply) => {
      // Build the tile URL using the request's host (includes port)
      const protocol = request.protocol;
      const host = request.host; // .host includes port, .hostname does not
      const tileUrl = `${protocol}://${host}/tiles/properties/{z}/{x}/{y}.pbf`;

      return reply.send({
        tilejson: '2.1.0',
        name: 'HuisHype Properties',
        description: 'Property data with clustering',
        tiles: [tileUrl],
        minzoom: 0,
        maxzoom: 22,
        bounds: [-180, -85, 180, 85],
      });
    }
  );

  /**
   * GET /tiles/properties/:z/:x/:y.pbf
   *
   * Returns a Mapbox Vector Tile (MVT) containing property data
   * - Clustered at low zoom (Z0-Z16)
   * - Individual points at high zoom (Z17+)
   */
  typedApp.get(
    '/tiles/properties/:z/:x/:y.pbf',
    {
      schema: {
        tags: ['tiles'],
        summary: 'Get property vector tile',
        description:
          'Returns MVT/PBF vector tile with property data. Clustered at Z0-16, individual points at Z17+. Ghost nodes only shown at Z17+.',
        params: tileParamsSchema,
        // Response schema is omitted for binary data
        // Content-Type will be application/x-protobuf
      },
    },
    async (request, reply) => {
      const { z, x, y } = request.params;
      const bbox = tileToBBox(z, x, y);

      // Track query time for performance monitoring
      const startTime = Date.now();

      let mvtBuffer: Buffer;

      if (z >= GHOST_NODE_THRESHOLD_ZOOM) {
        // High zoom: Return individual points (including ghost nodes)
        mvtBuffer = await getIndividualPointsMVT(bbox, z, x, y);
      } else {
        // Low zoom: Return clustered points (filter ghost nodes)
        mvtBuffer = await getClusteredMVT(bbox, z, x, y);
      }

      const queryTime = Date.now() - startTime;

      // Log slow queries for monitoring
      if (queryTime > 100) {
        app.log.warn(
          { z, x, y, queryTime },
          `Slow tile generation: ${queryTime}ms`
        );
      }

      // Empty tile
      if (!mvtBuffer || mvtBuffer.length === 0) {
        return reply.status(204).send();
      }

      // Set appropriate headers for MVT
      return reply
        .header('Content-Type', 'application/x-protobuf')
        .header(
          'Cache-Control',
          'public, max-age=30, stale-while-revalidate=60'
        )
        .header('X-Tile-Generation-Time', `${queryTime}ms`)
        .send(mvtBuffer);
    }
  );
}

/**
 * Get clustered points MVT for low zoom levels (Z0-Z16)
 * Filters out ghost nodes (no listing, no activity)
 * Uses ST_SnapToGrid for fast clustering
 */
async function getClusteredMVT(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  z: number,
  _x: number,
  _y: number
): Promise<Buffer> {
  const gridSize = getGridCellSize(z);

  // Query to generate clustered MVT
  // 1. Filter to bounding box
  // 2. Join with activity data (listings, comments, guesses)
  // 3. Filter out ghost nodes (no listing AND no activity)
  // 4. Cluster using ST_SnapToGrid
  // 5. Aggregate cluster properties
  // 6. Generate MVT with ST_AsMVT
  const result = await db.execute<{ mvt: Buffer }>(sql`
    WITH
    -- Calculate activity for each property
    property_activity AS (
      SELECT
        p.id,
        p.geometry,
        CASE WHEN l.id IS NOT NULL THEN true ELSE false END as has_listing,
        COALESCE(comment_counts.cnt, 0) + COALESCE(guess_counts.cnt, 0) as activity_score
      FROM properties p
      LEFT JOIN listings l ON l.property_id = p.id AND l.is_active = true
      LEFT JOIN (
        SELECT property_id, COUNT(*) as cnt
        FROM comments
        GROUP BY property_id
      ) comment_counts ON comment_counts.property_id = p.id
      LEFT JOIN (
        SELECT property_id, COUNT(*) as cnt
        FROM price_guesses
        GROUP BY property_id
      ) guess_counts ON guess_counts.property_id = p.id
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND ST_Intersects(
          p.geometry,
          ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)
        )
    ),
    -- Filter out ghost nodes for low zoom (only show active properties)
    -- Also pre-compute snapped geometry to avoid GROUP BY parameter mismatch
    active_properties AS (
      SELECT
        id,
        has_listing,
        activity_score,
        ST_SnapToGrid(geometry, ${gridSize}) as snapped_geom
      FROM property_activity
      WHERE has_listing = true OR activity_score > 0
    ),
    -- Cluster using pre-computed snapped geometry
    clustered AS (
      SELECT
        snapped_geom as cluster_geom,
        COUNT(*) as point_count,
        MAX(CASE WHEN has_listing THEN 1 ELSE 0 END) as has_listing_max,
        SUM(activity_score) as total_activity,
        MAX(activity_score) as max_activity,
        array_agg(id ORDER BY activity_score DESC) as property_ids
      FROM active_properties
      GROUP BY snapped_geom
    ),
    -- Prepare MVT layer data
    mvt_data AS (
      SELECT
        ST_AsMVTGeom(
          cluster_geom,
          ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326),
          4096,
          256,
          true
        ) as geom,
        point_count,
        has_listing_max > 0 as has_active_children,
        total_activity,
        max_activity,
        property_ids[1] as first_property_id
      FROM clustered
      WHERE cluster_geom IS NOT NULL
    )
    SELECT ST_AsMVT(mvt_data.*, 'properties', 4096, 'geom') as mvt
    FROM mvt_data
    WHERE geom IS NOT NULL
  `);

  // Convert iterable result to array
  const rows = Array.from(result) as { mvt: Buffer }[];
  const row = rows[0];
  if (!row?.mvt) {
    return Buffer.alloc(0);
  }

  // Handle both Buffer and Uint8Array from postgres driver
  if (Buffer.isBuffer(row.mvt)) {
    return row.mvt;
  }
  return Buffer.from(row.mvt);
}

/**
 * Get individual points MVT for high zoom levels (Z17+)
 * Includes ALL properties (both active and ghost nodes)
 */
async function getIndividualPointsMVT(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  _z: number,
  _x: number,
  _y: number
): Promise<Buffer> {
  // Query to generate individual points MVT
  // Returns all properties with their activity status
  const result = await db.execute<{ mvt: Buffer }>(sql`
    WITH
    -- Calculate activity for each property in bounds
    property_data AS (
      SELECT
        p.id,
        p.geometry,
        p.address,
        p.city,
        p.postal_code,
        p.woz_value,
        p.oppervlakte,
        p.bouwjaar,
        CASE WHEN l.id IS NOT NULL THEN true ELSE false END as has_listing,
        COALESCE(comment_counts.cnt, 0) + COALESCE(guess_counts.cnt, 0) as activity_score
      FROM properties p
      LEFT JOIN listings l ON l.property_id = p.id AND l.is_active = true
      LEFT JOIN (
        SELECT property_id, COUNT(*) as cnt
        FROM comments
        GROUP BY property_id
      ) comment_counts ON comment_counts.property_id = p.id
      LEFT JOIN (
        SELECT property_id, COUNT(*) as cnt
        FROM price_guesses
        GROUP BY property_id
      ) guess_counts ON guess_counts.property_id = p.id
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND ST_Intersects(
          p.geometry,
          ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)
        )
    ),
    -- Prepare MVT layer data
    mvt_data AS (
      SELECT
        ST_AsMVTGeom(
          geometry,
          ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326),
          4096,
          256,
          true
        ) as geom,
        id,
        address,
        city,
        postal_code as "postalCode",
        woz_value as "wozValue",
        oppervlakte,
        bouwjaar,
        has_listing as "hasListing",
        activity_score as "activityScore",
        NOT has_listing AND activity_score = 0 as is_ghost
      FROM property_data
    )
    SELECT ST_AsMVT(mvt_data.*, 'properties', 4096, 'geom') as mvt
    FROM mvt_data
    WHERE geom IS NOT NULL
  `);

  // Convert iterable result to array
  const rows = Array.from(result) as { mvt: Buffer }[];
  const row = rows[0];
  if (!row?.mvt) {
    return Buffer.alloc(0);
  }

  // Handle both Buffer and Uint8Array from postgres driver
  if (Buffer.isBuffer(row.mvt)) {
    return row.mvt;
  }
  return Buffer.from(row.mvt);
}

// Export types
export type TileParams = z.infer<typeof tileParamsSchema>;

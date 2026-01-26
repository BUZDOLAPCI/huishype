import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

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

// Zoom level threshold for showing ghost nodes
const GHOST_NODE_THRESHOLD_ZOOM = 17;

// Grid cell size in degrees for clustering at different zoom levels
// Smaller = more clusters, Larger = fewer clusters
function getGridCellSize(zoom: number): number {
  // At zoom 0, world is 360 degrees
  // Each zoom level doubles resolution
  // We want reasonable cluster sizes at each zoom
  const baseCellSize = 360 / Math.pow(2, zoom);
  // Adjust to create visually pleasing clusters (roughly 50-100px on screen)
  return baseCellSize * 4;
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

export async function tileRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

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

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync } from 'fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import proj4 from 'proj4';
import { execSync } from 'child_process';
import { properties, type NewProperty } from '../src/db/schema.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Eindhoven area spatial filter (20km radius from city center)
// Eindhoven center in RD New: approximately X=160000, Y=383000
// Bounding box: 20km in each direction
const EINDHOVEN_BOUNDS_RD = {
  minX: 140000,
  minY: 363000,
  maxX: 180000,
  maxY: 403000,
};

// Define coordinate systems
// RD New (Amersfoort / RD New) - Dutch national grid
const RD_NEW = '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs';
const WGS84 = 'EPSG:4326';

// Register the projection
proj4.defs('EPSG:28992', RD_NEW);

// Types for BAG data
interface VerblijfsobjectRow {
  pand_identificatie: string;
  openbare_ruimte_naam: string;
  huisnummer: number;
  huisletter: string | null;
  toevoeging: string | null;
  postcode: string | null;
  woonplaats_naam: string;
}

interface PandCentroidRow {
  identificatie: string;
  bouwjaar: number | null;
  status: string | null;
  oppervlakte_min: number | null;
  centroid_x: number;
  centroid_y: number;
}

// Address info structure
interface AddressInfo {
  address: string;
  postalCode: string | null;
  city: string;
}

/**
 * Format an address from BAG verblijfsobject fields
 * Format: "Straatnaam 123A-bis"
 */
function formatBAGAddress(
  straatnaam: string,
  huisnummer: number,
  huisletter: string | null,
  toevoeging: string | null
): string {
  let address = `${straatnaam} ${huisnummer}`;
  if (huisletter) {
    address += huisletter;
  }
  if (toevoeging) {
    address += `-${toevoeging}`;
  }
  return address;
}

/**
 * Transform RD New coordinates to WGS84
 */
function transformToWGS84(x: number, y: number): { lon: number; lat: number } {
  const [lon, lat] = proj4('EPSG:28992', WGS84, [x, y]);
  return { lon, lat };
}

/**
 * Map BAG status to our property status enum
 */
function mapStatus(bagStatus: string | null): 'active' | 'inactive' | 'demolished' {
  if (!bagStatus) return 'active';

  const status = bagStatus.toLowerCase();
  if (status.includes('gesloopt') || status.includes('demolished')) {
    return 'demolished';
  }
  if (status.includes('niet') || status.includes('buiten')) {
    return 'inactive';
  }
  return 'active';
}

/**
 * Format a fallback address when address lookup fails
 */
function generateFallbackAddress(lat: number, lon: number, identificatie: string): string {
  const latPart = Math.abs(Math.round(lat * 10000) % 100);
  const lonPart = Math.abs(Math.round(lon * 10000) % 100);
  return `Straat ${latPart}${lonPart} ${identificatie.slice(-4)}`;
}

/**
 * Format elapsed time nicely
 */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Extract pand centroids using ogr2ogr to a temporary SQLite database
 * This is much faster than querying ogrinfo for each batch
 *
 * @param eindhovenOnly - If true, only extract properties within ~20km of Eindhoven center
 */
function extractPandCentroids(bagPath: string, tempDbPath: string, skipDemolished: boolean, eindhovenOnly: boolean): void {
  console.log('\nExtracting pand centroids using ogr2ogr...');

  if (eindhovenOnly) {
    console.log('Filtering to Eindhoven area (~20km radius, ~240K properties)...');
  } else {
    console.log('This may take several minutes for 11M+ records...');
  }

  // Remove existing temp file
  if (existsSync(tempDbPath)) {
    unlinkSync(tempDbPath);
  }

  // Build SQL query for centroid extraction
  const whereConditions: string[] = [];

  if (skipDemolished) {
    whereConditions.push("status NOT LIKE '%gesloopt%' AND status NOT LIKE '%demolished%'");
  }

  // Add spatial filter for Eindhoven area if requested
  if (eindhovenOnly) {
    const { minX, minY, maxX, maxY } = EINDHOVEN_BOUNDS_RD;
    whereConditions.push(
      `ST_X(ST_Centroid(geom)) BETWEEN ${minX} AND ${maxX} AND ST_Y(ST_Centroid(geom)) BETWEEN ${minY} AND ${maxY}`
    );
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Use ogr2ogr to extract centroids to a SQLite database
  // The -nlt NONE flag tells ogr2ogr to not write geometry (we just need the centroid coords)
  const sql = `SELECT identificatie, bouwjaar, status, oppervlakte_min, ST_X(ST_Centroid(geom)) as centroid_x, ST_Y(ST_Centroid(geom)) as centroid_y FROM pand ${whereClause}`;

  const command = `ogr2ogr -f SQLite "${tempDbPath}" "${bagPath}" -sql "${sql}" -nln pand_centroids -dsco SPATIALITE=NO`;

  console.log('Running ogr2ogr extraction...');
  const startTime = Date.now();

  try {
    execSync(command, {
      maxBuffer: 500 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30 * 60 * 1000 // 30 minute timeout
    });
    console.log(`Extraction complete in ${formatElapsedTime(Date.now() - startTime)}`);
  } catch (error) {
    console.error('Error during ogr2ogr extraction:', error);
    throw error;
  }
}

async function seed() {
  console.log('='.repeat(60));
  console.log('Netherlands BAG Database Seed');
  console.log('='.repeat(60));

  // Parse command line arguments
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;
  const offsetIndex = args.indexOf('--offset');
  const offset = offsetIndex !== -1 ? parseInt(args[offsetIndex + 1], 10) : 0;
  const skipDemolished = args.includes('--skip-demolished');
  const dryRun = args.includes('--dry-run');
  const skipExtract = args.includes('--skip-extract');

  // Geographic scope: Eindhoven area (default for dev) vs full Netherlands
  // Use --full or --netherlands for complete dataset
  const fullNetherlands = args.includes('--full') || args.includes('--netherlands');
  const eindhovenOnly = !fullNetherlands;

  if (eindhovenOnly) {
    console.log('Mode: EINDHOVEN AREA (development default)');
    console.log('  ~20km radius from city center, ~240K properties');
    console.log('  Use --full or --netherlands for complete dataset');
  } else {
    console.log('Mode: FULL NETHERLANDS');
    console.log('  Complete dataset: 11.3M properties');
  }
  console.log('Source: bag-light.gpkg');
  console.log('');

  if (limit) {
    console.log(`Limiting to ${limit.toLocaleString()} properties`);
  }
  if (offset > 0) {
    console.log(`Starting from offset ${offset.toLocaleString()}`);
  }
  if (skipDemolished) {
    console.log('Skipping demolished properties');
  }
  if (dryRun) {
    console.log('DRY RUN - no database changes will be made');
  }
  if (skipExtract) {
    console.log('Skipping extraction (using existing temp database)');
  }

  // Paths
  const bagPath = resolve(__dirname, '../../../data_sources/bag-light.gpkg');
  // Use different temp files for Eindhoven vs full Netherlands to allow reuse
  const tempDbPath = eindhovenOnly
    ? resolve(__dirname, '../../../data_sources/pand_centroids_eindhoven_temp.sqlite')
    : resolve(__dirname, '../../../data_sources/pand_centroids_temp.sqlite');

  console.log(`\nBAG GeoPackage: ${bagPath}`);

  // Step 1: Extract pand centroids to temp SQLite (unless skipped)
  if (!skipExtract) {
    extractPandCentroids(bagPath, tempDbPath, skipDemolished, eindhovenOnly);
  }

  // Open both databases
  console.log('\nOpening databases...');
  const bagDb = new Database(bagPath, { readonly: true });
  const tempDb = new Database(tempDbPath, { readonly: true });

  // Count total pands in temp database
  const countResult = tempDb.prepare('SELECT COUNT(*) as count FROM pand_centroids').get() as { count: number };
  const totalPands = countResult.count;
  console.log(`Total pands with centroids: ${totalPands.toLocaleString()}`);

  // Build address lookup map from verblijfsobject
  console.log('\nBuilding address lookup map from verblijfsobject...');
  const addressMapStart = Date.now();

  const addressMap = new Map<string, AddressInfo>();

  // Query verblijfsobject in batches to build address map
  const ADDRESS_BATCH_SIZE = 500000;
  let addressOffset = 0;

  const addressStmt = bagDb.prepare(`
    SELECT pand_identificatie, openbare_ruimte_naam, huisnummer, huisletter, toevoeging, postcode, woonplaats_naam
    FROM verblijfsobject
    WHERE pand_identificatie IS NOT NULL
    ORDER BY pand_identificatie
    LIMIT ? OFFSET ?
  `);

  while (true) {
    const addressBatch = addressStmt.all(ADDRESS_BATCH_SIZE, addressOffset) as VerblijfsobjectRow[];

    if (addressBatch.length === 0) break;

    for (const row of addressBatch) {
      // Only keep first address for each pand
      if (addressMap.has(row.pand_identificatie)) continue;

      const address = formatBAGAddress(
        row.openbare_ruimte_naam,
        row.huisnummer,
        row.huisletter,
        row.toevoeging
      );

      addressMap.set(row.pand_identificatie, {
        address,
        postalCode: row.postcode || null,
        city: row.woonplaats_naam || 'Unknown',
      });
    }

    addressOffset += addressBatch.length;
    process.stdout.write(`\r  Loaded ${addressOffset.toLocaleString()} verblijfsobjecten, ${addressMap.size.toLocaleString()} unique pands`);
  }

  console.log(`\n  Address map built: ${addressMap.size.toLocaleString()} unique pand addresses in ${formatElapsedTime(Date.now() - addressMapStart)}`);

  // Connect to PostgreSQL database
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5432/huishype';
  console.log('\nConnecting to PostgreSQL database...');

  const queryClient = postgres(databaseUrl, {
    max: 10, // Use connection pool for parallel inserts
    onnotice: () => {},
  });

  const db = drizzle(queryClient);

  try {
    // Process pand centroids from temp database
    const BATCH_SIZE = 50000;
    const INSERT_BATCH_SIZE = 5000;

    let processedCount = 0;
    let insertedCount = 0;
    let localLookupCount = 0;
    let fallbackCount = 0;

    const totalToProcess = limit ? Math.min(limit, totalPands - offset) : totalPands - offset;

    console.log(`\nProcessing ${totalToProcess.toLocaleString()} properties...`);
    const processStart = Date.now();

    // Prepare statement for reading centroids
    const centroidStmt = tempDb.prepare(`
      SELECT identificatie, bouwjaar, status, oppervlakte_min, centroid_x, centroid_y
      FROM pand_centroids
      ORDER BY identificatie
      LIMIT ? OFFSET ?
    `);

    let currentOffset = offset;
    let propertyBatch: NewProperty[] = [];

    while (processedCount < totalToProcess) {
      const batchLimit = Math.min(BATCH_SIZE, totalToProcess - processedCount);

      const centroidBatch = centroidStmt.all(batchLimit, currentOffset) as PandCentroidRow[];

      if (centroidBatch.length === 0) {
        console.log(`\nNo more records found at offset ${currentOffset}`);
        break;
      }

      for (const row of centroidBatch) {
        if (!row.identificatie || row.centroid_x === null || row.centroid_y === null) {
          continue;
        }

        // Transform coordinates from RD New to WGS84
        const { lon, lat } = transformToWGS84(row.centroid_x, row.centroid_y);

        // Look up address
        let address: string;
        let postalCode: string | null = null;
        let city = 'Netherlands';

        const addressInfo = addressMap.get(row.identificatie);
        if (addressInfo) {
          address = addressInfo.address;
          postalCode = addressInfo.postalCode;
          city = addressInfo.city;
          localLookupCount++;
        } else {
          address = generateFallbackAddress(lat, lon, row.identificatie);
          fallbackCount++;
        }

        const record: NewProperty = {
          bagIdentificatie: row.identificatie,
          address,
          city,
          postalCode,
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          bouwjaar: row.bouwjaar,
          oppervlakte: row.oppervlakte_min,
          status: mapStatus(row.status),
        };

        propertyBatch.push(record);
        processedCount++;

        // Insert batch when full
        if (propertyBatch.length >= INSERT_BATCH_SIZE && !dryRun) {
          await db
            .insert(properties)
            .values(propertyBatch)
            .onConflictDoUpdate({
              target: properties.bagIdentificatie,
              set: {
                address: sql`excluded.address`,
                postalCode: sql`excluded.postal_code`,
                city: sql`excluded.city`,
                geometry: sql`excluded.geometry`,
                bouwjaar: sql`excluded.bouwjaar`,
                oppervlakte: sql`excluded.oppervlakte`,
                status: sql`excluded.status`,
                updatedAt: sql`NOW()`,
              },
            });

          insertedCount += propertyBatch.length;
          propertyBatch = [];
        }
      }

      currentOffset += centroidBatch.length;

      // Progress logging
      const elapsed = Date.now() - processStart;
      const rate = processedCount / (elapsed / 1000);
      const eta = (totalToProcess - processedCount) / rate;

      process.stdout.write(
        `\r  Progress: ${processedCount.toLocaleString()}/${totalToProcess.toLocaleString()} ` +
        `(${((processedCount / totalToProcess) * 100).toFixed(1)}%) | ` +
        `${rate.toFixed(0)}/s | ` +
        `ETA: ${formatElapsedTime(eta * 1000)} | ` +
        `Addresses: ${localLookupCount.toLocaleString()} real, ${fallbackCount.toLocaleString()} fallback`
      );
    }

    // Insert remaining batch
    if (propertyBatch.length > 0 && !dryRun) {
      await db
        .insert(properties)
        .values(propertyBatch)
        .onConflictDoUpdate({
          target: properties.bagIdentificatie,
          set: {
            address: sql`excluded.address`,
            postalCode: sql`excluded.postal_code`,
            city: sql`excluded.city`,
            geometry: sql`excluded.geometry`,
            bouwjaar: sql`excluded.bouwjaar`,
            oppervlakte: sql`excluded.oppervlakte`,
            status: sql`excluded.status`,
            updatedAt: sql`NOW()`,
          },
        });

      insertedCount += propertyBatch.length;
    }

    const totalTime = Date.now() - processStart;

    console.log('\n');
    console.log('='.repeat(60));
    console.log('Seed Complete');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processedCount.toLocaleString()} properties`);
    console.log(`Total inserted/updated: ${insertedCount.toLocaleString()} properties`);
    console.log(`Total time: ${formatElapsedTime(totalTime)}`);
    console.log(`Average rate: ${(processedCount / (totalTime / 1000)).toFixed(0)} properties/second`);
    console.log('');
    console.log('Address Resolution:');
    console.log(`  - Real BAG addresses: ${localLookupCount.toLocaleString()} (${((localLookupCount / processedCount) * 100).toFixed(1)}%)`);
    console.log(`  - Generated fallback: ${fallbackCount.toLocaleString()} (${((fallbackCount / processedCount) * 100).toFixed(1)}%)`);

    if (!dryRun) {
      // Verify insertion
      const result = await queryClient`SELECT COUNT(*) as count FROM properties`;
      console.log('');
      console.log('Database Statistics:');
      console.log(`  Total properties in database: ${Number(result[0].count).toLocaleString()}`);

      // Show sample addresses
      const sampleAddresses = await queryClient`
        SELECT address, postal_code, city
        FROM properties
        WHERE address NOT LIKE 'Straat%'
        ORDER BY RANDOM()
        LIMIT 5
      `;
      console.log('');
      console.log('Sample real addresses:');
      sampleAddresses.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.address}, ${row.postal_code || 'N/A'} ${row.city}`);
      });

      // Address statistics
      const addressStats = await queryClient`
        SELECT
          COUNT(*) FILTER (WHERE address LIKE 'Straat%') as generated_count,
          COUNT(*) FILTER (WHERE address NOT LIKE 'Straat%') as real_count,
          COUNT(*) as total
        FROM properties
      `;
      console.log('');
      console.log('Address breakdown in database:');
      console.log(`  - Real addresses: ${Number(addressStats[0].real_count).toLocaleString()}`);
      console.log(`  - Generated fallback: ${Number(addressStats[0].generated_count).toLocaleString()}`);
      console.log(`  - Total: ${Number(addressStats[0].total).toLocaleString()}`);

      // Geographic distribution
      const cityStats = await queryClient`
        SELECT city, COUNT(*) as count
        FROM properties
        GROUP BY city
        ORDER BY count DESC
        LIMIT 10
      `;
      console.log('');
      console.log('Top 10 cities by property count:');
      cityStats.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.city}: ${Number(row.count).toLocaleString()}`);
      });
    }
  } catch (error) {
    console.error('\nError during seeding:', error);
    throw error;
  } finally {
    bagDb.close();
    tempDb.close();
    await queryClient.end();
    console.log('\nConnections closed');
  }
}

// Run the seed
seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

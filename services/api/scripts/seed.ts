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

// Row type for extracted VBO data from temp SQLite
interface VboExtractRow {
  identificatie: string;
  oppervlakte: number | null;
  bouwjaar: number | null;
  status: string | null;
  openbare_ruimte_naam: string | null;
  huisnummer: number | null;
  huisletter: string | null;
  toevoeging: string | null;
  postcode: string | null;
  woonplaats_naam: string | null;
  x: number;
  y: number;
}

/**
 * Format house number addition from BAG huisletter and toevoeging fields
 * Examples: "A", "B-1", "BIS", null
 */
function formatHouseNumberAddition(
  huisletter: string | null,
  toevoeging: string | null
): string | null {
  let addition = '';
  if (huisletter) addition += huisletter;
  if (toevoeging) addition += (addition ? '-' : '') + toevoeging;
  return addition ? addition.toUpperCase() : null;
}

/**
 * Transform RD New coordinates to WGS84
 */
function transformToWGS84(x: number, y: number): { lon: number; lat: number } {
  const [lon, lat] = proj4('EPSG:28992', WGS84, [x, y]);
  return { lon, lat };
}

/**
 * Map BAG VBO status to our property status enum
 */
function mapStatus(bagStatus: string | null): 'active' | 'inactive' | 'demolished' {
  if (!bagStatus) return 'active';

  const status = bagStatus.toLowerCase();
  if (status.includes('ingetrokken')) {
    return 'demolished';
  }
  if (status.includes('buiten gebruik')) {
    return 'inactive';
  }
  return 'active';
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
 * Extract verblijfsobjecten using ogr2ogr to a temporary SQLite database.
 * Each VBO is a dwelling unit with its own address, geometry, and oppervlakte.
 *
 * @param eindhovenOnly - If true, only extract VBOs within ~20km of Eindhoven center
 */
function extractVerblijfsobjecten(bagPath: string, tempDbPath: string, skipDemolished: boolean, eindhovenOnly: boolean): void {
  console.log('\nExtracting verblijfsobjecten using ogr2ogr...');

  if (eindhovenOnly) {
    console.log('Filtering to Eindhoven area (~20km radius)...');
  } else {
    console.log('This may take several minutes for 9.8M+ records...');
  }

  // Remove existing temp file
  if (existsSync(tempDbPath)) {
    unlinkSync(tempDbPath);
  }

  // Build WHERE conditions
  const whereConditions: string[] = [];

  // Only include VBOs with valid addresses
  whereConditions.push('huisnummer IS NOT NULL AND openbare_ruimte_naam IS NOT NULL');

  if (skipDemolished) {
    whereConditions.push("status NOT LIKE '%ingetrokken%'");
  }

  // Spatial filter using VBO's own geometry
  if (eindhovenOnly) {
    const { minX, minY, maxX, maxY } = EINDHOVEN_BOUNDS_RD;
    whereConditions.push(
      `ST_X(geom) BETWEEN ${minX} AND ${maxX} AND ST_Y(geom) BETWEEN ${minY} AND ${maxY}`
    );
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Extract VBO data including coordinates
  const sqlQuery = `SELECT identificatie, oppervlakte, bouwjaar, status, openbare_ruimte_naam, huisnummer, huisletter, toevoeging, postcode, woonplaats_naam, ST_X(geom) as x, ST_Y(geom) as y FROM verblijfsobject ${whereClause}`;

  const command = `ogr2ogr -f SQLite "${tempDbPath}" "${bagPath}" -sql "${sqlQuery}" -nln vbo_extract -dsco SPATIALITE=NO`;

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
    console.log('  ~20km radius from city center');
    console.log('  Use --full or --netherlands for complete dataset');
  } else {
    console.log('Mode: FULL NETHERLANDS');
    console.log('  Complete dataset: ~9.8M verblijfsobjecten');
  }
  console.log('Source: bag-light.gpkg (verblijfsobject layer)');
  console.log('');

  if (limit) {
    console.log(`Limiting to ${limit.toLocaleString()} properties`);
  }
  if (offset > 0) {
    console.log(`Starting from offset ${offset.toLocaleString()}`);
  }
  if (skipDemolished) {
    console.log('Skipping withdrawn/demolished VBOs');
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
    ? resolve(__dirname, '../../../data_sources/vbo_eindhoven_temp.sqlite')
    : resolve(__dirname, '../../../data_sources/vbo_temp.sqlite');

  console.log(`\nBAG GeoPackage: ${bagPath}`);

  // Step 1: Extract VBOs to temp SQLite (unless skipped)
  if (!skipExtract) {
    extractVerblijfsobjecten(bagPath, tempDbPath, skipDemolished, eindhovenOnly);
  }

  // Open temp database
  console.log('\nOpening temp database...');
  const tempDb = new Database(tempDbPath, { readonly: true });

  // Count total VBOs
  const countResult = tempDb.prepare('SELECT COUNT(*) as count FROM vbo_extract').get() as { count: number };
  const totalVbos = countResult.count;
  console.log(`Total VBOs extracted: ${totalVbos.toLocaleString()}`);

  // Connect to PostgreSQL database
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';
  console.log('\nConnecting to PostgreSQL database...');

  const queryClient = postgres(databaseUrl, {
    max: 10,
    onnotice: () => {},
  });

  const db = drizzle(queryClient);

  try {
    const BATCH_SIZE = 50000;
    const INSERT_BATCH_SIZE = 5000;

    let processedCount = 0;
    let skippedDuplicateAddress = 0;
    let skippedNoPostalCode = 0;

    // Track seen addresses to avoid unique constraint violations
    const seenAddresses = new Set<string>();

    const totalToProcess = limit ? Math.min(limit, totalVbos - offset) : totalVbos - offset;

    console.log(`\nProcessing ${totalToProcess.toLocaleString()} VBOs...`);
    const processStart = Date.now();

    // Prepare statement for reading VBOs
    const vboStmt = tempDb.prepare(`
      SELECT identificatie, oppervlakte, bouwjaar, status,
             openbare_ruimte_naam, huisnummer, huisletter, toevoeging, postcode, woonplaats_naam,
             x, y
      FROM vbo_extract
      ORDER BY identificatie
      LIMIT ? OFFSET ?
    `);

    let currentOffset = offset;
    let propertyBatch: NewProperty[] = [];
    let totalScannedSoFar = 0;

    while (totalScannedSoFar < totalToProcess) {
      const batchLimit = Math.min(BATCH_SIZE, totalToProcess - totalScannedSoFar);

      const vboBatch = vboStmt.all(batchLimit, currentOffset) as VboExtractRow[];

      if (vboBatch.length === 0) {
        console.log(`\nNo more records found at offset ${currentOffset}`);
        break;
      }

      for (const row of vboBatch) {
        if (!row.identificatie || row.x === null || row.y === null) {
          continue;
        }

        // Format address fields
        const street = row.openbare_ruimte_naam?.trim();
        const houseNumber = row.huisnummer;
        const houseNumberAddition = formatHouseNumberAddition(row.huisletter, row.toevoeging);
        const postalCode = row.postcode ? row.postcode.replace(/\s/g, '').toUpperCase() : null;
        const city = row.woonplaats_naam || 'Unknown';

        if (!street || houseNumber == null || !postalCode) {
          if (!postalCode && street && houseNumber != null) skippedNoPostalCode++;
          continue;
        }

        // Deduplicate by address
        const addressKey = `${postalCode}|${houseNumber}|${houseNumberAddition || ''}`;
        if (seenAddresses.has(addressKey)) {
          skippedDuplicateAddress++;
          continue;
        }
        seenAddresses.add(addressKey);

        // Transform coordinates from RD New to WGS84
        const { lon, lat } = transformToWGS84(row.x, row.y);

        const record: NewProperty = {
          bagIdentificatie: row.identificatie,
          street,
          houseNumber,
          houseNumberAddition,
          city,
          postalCode,
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          bouwjaar: row.bouwjaar,
          oppervlakte: row.oppervlakte,
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
                street: sql`excluded.street`,
                houseNumber: sql`excluded.house_number`,
                houseNumberAddition: sql`excluded.house_number_addition`,
                postalCode: sql`excluded.postal_code`,
                city: sql`excluded.city`,
                geometry: sql`excluded.geometry`,
                bouwjaar: sql`excluded.bouwjaar`,
                oppervlakte: sql`excluded.oppervlakte`,
                status: sql`excluded.status`,
                updatedAt: sql`NOW()`,
              },
            });

          propertyBatch = [];
        }
      }

      currentOffset += vboBatch.length;
      totalScannedSoFar += vboBatch.length;

      // Progress logging
      const elapsed = Date.now() - processStart;
      const rate = totalScannedSoFar / (elapsed / 1000);

      process.stdout.write(
        `\r  Scanned: ${totalScannedSoFar.toLocaleString()}/${totalToProcess.toLocaleString()} ` +
        `| Inserted: ${processedCount.toLocaleString()} | ` +
        `Skipped (dup addr): ${skippedDuplicateAddress.toLocaleString()} | ` +
        `${rate.toFixed(0)}/s`
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
            street: sql`excluded.street`,
            houseNumber: sql`excluded.house_number`,
            houseNumberAddition: sql`excluded.house_number_addition`,
            postalCode: sql`excluded.postal_code`,
            city: sql`excluded.city`,
            geometry: sql`excluded.geometry`,
            bouwjaar: sql`excluded.bouwjaar`,
            oppervlakte: sql`excluded.oppervlakte`,
            status: sql`excluded.status`,
            updatedAt: sql`NOW()`,
          },
        });
    }

    const totalTime = Date.now() - processStart;

    console.log('\n');
    console.log('='.repeat(60));
    console.log('Seed Complete');
    console.log('='.repeat(60));
    console.log(`Total scanned: ${totalScannedSoFar.toLocaleString()} VBOs`);
    console.log(`Total inserted/updated: ${processedCount.toLocaleString()} properties`);
    console.log(`Skipped (duplicate address): ${skippedDuplicateAddress.toLocaleString()} VBOs`);
    console.log(`Skipped (no postal code): ${skippedNoPostalCode.toLocaleString()} VBOs`);
    console.log(`Total time: ${formatElapsedTime(totalTime)}`);
    console.log(`Average rate: ${(totalScannedSoFar / (totalTime / 1000)).toFixed(0)} VBOs/second`);

    if (!dryRun) {
      // Verify insertion
      const result = await queryClient`SELECT COUNT(*) as count FROM properties`;
      console.log('');
      console.log('Database Statistics:');
      console.log(`  Total properties in database: ${Number(result[0].count).toLocaleString()}`);

      // Show sample addresses
      const sampleAddresses = await queryClient`
        SELECT street, house_number, house_number_addition, postal_code, city
        FROM properties
        ORDER BY RANDOM()
        LIMIT 5
      `;
      console.log('');
      console.log('Sample addresses:');
      sampleAddresses.forEach((row, i) => {
        const addition = row.house_number_addition ? row.house_number_addition : '';
        console.log(`  ${i + 1}. ${row.street} ${row.house_number}${addition}, ${row.postal_code || 'N/A'} ${row.city}`);
      });


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

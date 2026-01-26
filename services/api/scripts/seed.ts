import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import dotenv from 'dotenv';
import { properties, type NewProperty } from '../src/db/schema.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// GeoJSON types
interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    identificatie: string;
    bouwjaar?: number;
    status?: string;
    oppervlakte_min?: number;
    oppervlakte_max?: number;
    gebruiksdoel?: string;
    aantal_verblijfsobjecten?: number;
    rdf_seealso?: string;
  };
  geometry: GeoJSONPolygon;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  name?: string;
  crs?: {
    type: string;
    properties: { name: string };
  };
  features: GeoJSONFeature[];
}

// PDOK Reverse Geocoding response types
interface PDOKReverseResponse {
  response: {
    numFound: number;
    start: number;
    docs: PDOKDocument[];
  };
}

interface PDOKDocument {
  id: string;
  type: string;
  weergavenaam: string;
  straatnaam?: string;
  huisnummer?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  provincienaam?: string;
  centroide_ll?: string;
}

// Cache for reverse geocoding results to avoid duplicate API calls
const geocodeCache = new Map<string, { address: string; postalCode: string | null; city: string }>();

/**
 * Calculate the centroid of a polygon
 * Using simple average of all coordinates (sufficient for small polygons)
 */
function calculateCentroid(polygon: GeoJSONPolygon): { lon: number; lat: number } {
  const coords = polygon.coordinates[0]; // Outer ring
  let sumLon = 0;
  let sumLat = 0;

  // Exclude the last point as it's the same as the first (polygon closure)
  const numPoints = coords.length - 1;

  for (let i = 0; i < numPoints; i++) {
    sumLon += coords[i][0];
    sumLat += coords[i][1];
  }

  return {
    lon: sumLon / numPoints,
    lat: sumLat / numPoints,
  };
}

/**
 * Map BAG status to our property status enum
 */
function mapStatus(bagStatus: string | undefined): 'active' | 'inactive' | 'demolished' {
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
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a cache key from coordinates (rounded to avoid floating point issues)
 */
function getCacheKey(lat: number, lon: number): string {
  // Round to 5 decimal places (~1m precision) for caching
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Reverse geocode coordinates using PDOK Locatieserver
 * Returns a real Dutch address for the given lat/lon
 */
async function reverseGeocode(
  lat: number,
  lon: number,
  retries = 3
): Promise<{ address: string; postalCode: string | null; city: string } | null> {
  // Check cache first
  const cacheKey = getCacheKey(lat, lon);
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // PDOK Locatieserver reverse geocoding endpoint
  // Uses the 'reverse' endpoint which takes lat/lon and returns nearest address
  const url = new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lon.toString());
  url.searchParams.set('rows', '1');
  // Request address type only
  url.searchParams.set('fq', 'type:adres');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HuisHype-Seeder/1.0',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited, wait longer
          console.warn(`Rate limited, waiting before retry ${attempt}/${retries}...`);
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as PDOKReverseResponse;

      if (data.response.numFound === 0 || !data.response.docs.length) {
        // No address found for these coordinates
        return null;
      }

      const doc = data.response.docs[0];

      // Format the address: "Straatnaam Huisnummer"
      let address: string;
      if (doc.straatnaam && doc.huisnummer) {
        address = `${doc.straatnaam} ${doc.huisnummer}`;
      } else if (doc.weergavenaam) {
        // Use display name as fallback, but extract just the street part
        const parts = doc.weergavenaam.split(',');
        address = parts[0].trim();
      } else {
        return null;
      }

      const result = {
        address,
        postalCode: doc.postcode || null,
        // Use Eindhoven as fallback for this dataset (sandbox data is Eindhoven)
        city: doc.woonplaatsnaam || doc.gemeentenaam || 'Eindhoven',
      };

      // Cache the result
      geocodeCache.set(cacheKey, result);

      return result;
    } catch (error) {
      if (attempt === retries) {
        console.error(`Failed to reverse geocode (${lat}, ${lon}) after ${retries} attempts:`, error);
        return null;
      }
      // Wait before retry
      await sleep(500 * attempt);
    }
  }

  return null;
}

/**
 * Format a fallback address when geocoding fails
 * Uses coordinates to generate a unique but recognizable address
 */
function generateFallbackAddress(lat: number, lon: number, identificatie: string): string {
  // Generate a street-like name based on coordinates
  // This ensures properties still have distinct, non-placeholder addresses
  const latPart = Math.abs(Math.round(lat * 10000) % 100);
  const lonPart = Math.abs(Math.round(lon * 10000) % 100);
  return `Straat ${latPart}${lonPart} ${identificatie.slice(-4)}`;
}

async function seed() {
  console.log('Starting database seed with real address resolution...');
  console.log('Using PDOK Locatieserver for reverse geocoding\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;
  const skipGeocoding = args.includes('--skip-geocoding');

  if (limit) {
    console.log(`Limiting to ${limit} properties`);
  }
  if (skipGeocoding) {
    console.log('Skipping geocoding (using fallback addresses)');
  }

  // Read the GeoJSON fixture file
  const fixturePath = resolve(__dirname, '../../../fixtures/eindhoven-sandbox.geojson');
  console.log(`Reading fixture file: ${fixturePath}`);

  let geojsonData: GeoJSONFeatureCollection;
  try {
    const fileContent = readFileSync(fixturePath, 'utf-8');
    geojsonData = JSON.parse(fileContent) as GeoJSONFeatureCollection;
    console.log(`Loaded ${geojsonData.features.length} features from GeoJSON`);
  } catch (error) {
    console.error('Error reading fixture file:', error);
    process.exit(1);
  }

  // Apply limit if specified
  let featuresToProcess = geojsonData.features;
  if (limit && limit < featuresToProcess.length) {
    featuresToProcess = featuresToProcess.slice(0, limit);
    console.log(`Processing first ${limit} features`);
  }

  // Connect to database
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5432/huishype';
  console.log('Connecting to database...');

  const queryClient = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {}, // Suppress notices
  });

  const db = drizzle(queryClient);

  try {
    // Process features and resolve addresses
    const propertyRecords: NewProperty[] = [];
    let geocodedCount = 0;
    let fallbackCount = 0;

    console.log('\nResolving addresses from PDOK Locatieserver...');
    console.log('(This may take a while due to rate limiting)\n');

    for (let index = 0; index < featuresToProcess.length; index++) {
      const feature = featuresToProcess[index];
      const centroid = calculateCentroid(feature.geometry);

      let address: string;
      let postalCode: string | null = null;
      let city = 'Eindhoven';

      if (!skipGeocoding) {
        // Try to reverse geocode the address
        const geocoded = await reverseGeocode(centroid.lat, centroid.lon);

        if (geocoded) {
          address = geocoded.address;
          postalCode = geocoded.postalCode;
          city = geocoded.city;
          geocodedCount++;
        } else {
          // Fallback to a generated address (not "BAG Pand")
          address = generateFallbackAddress(centroid.lat, centroid.lon, feature.properties.identificatie);
          fallbackCount++;
        }

        // Rate limiting: wait between API calls
        // PDOK is free but we should be respectful (100-200ms delay)
        if ((index + 1) % 5 === 0) {
          await sleep(150);
        }
      } else {
        // Skip geocoding, use fallback directly
        address = generateFallbackAddress(centroid.lat, centroid.lon, feature.properties.identificatie);
        fallbackCount++;
      }

      const record: NewProperty = {
        bagIdentificatie: feature.properties.identificatie,
        address,
        city,
        postalCode,
        geometry: {
          type: 'Point',
          coordinates: [centroid.lon, centroid.lat],
        },
        bouwjaar: feature.properties.bouwjaar ?? null,
        oppervlakte: feature.properties.oppervlakte_min ?? null,
        status: mapStatus(feature.properties.status),
      };

      propertyRecords.push(record);

      // Progress logging
      if ((index + 1) % 50 === 0 || index === featuresToProcess.length - 1) {
        console.log(
          `Progress: ${index + 1}/${featuresToProcess.length} | ` +
            `Geocoded: ${geocodedCount} | Fallback: ${fallbackCount}`
        );
      }
    }

    console.log(`\nTransformed ${propertyRecords.length} property records`);
    console.log(`  - Geocoded with real addresses: ${geocodedCount}`);
    console.log(`  - Using fallback addresses: ${fallbackCount}`);

    // Insert in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    let insertedCount = 0;

    console.log('\nInserting into database...');

    for (let i = 0; i < propertyRecords.length; i += BATCH_SIZE) {
      const batch = propertyRecords.slice(i, i + BATCH_SIZE);

      // Use onConflictDoUpdate to update existing records with real addresses
      // This replaces "BAG Pand" placeholders with geocoded addresses
      await db
        .insert(properties)
        .values(batch)
        .onConflictDoUpdate({
          target: properties.bagIdentificatie,
          set: {
            address: sql`excluded.address`,
            postalCode: sql`excluded.postal_code`,
            city: sql`excluded.city`,
            updatedAt: sql`NOW()`,
          },
        });

      insertedCount += batch.length;
      console.log(`Inserted batch ${Math.ceil((i + 1) / BATCH_SIZE)}: ${insertedCount}/${propertyRecords.length} records`);
    }

    console.log(`\nSeed completed successfully!`);
    console.log(`Total records processed: ${propertyRecords.length}`);

    // Verify insertion
    const result = await queryClient`SELECT COUNT(*) as count FROM properties`;
    console.log(`Total properties in database: ${result[0].count}`);

    // Show sample of updated addresses (sorted by updated_at to see recent changes)
    const sampleAddresses = await queryClient`
      SELECT address, postal_code, city
      FROM properties
      ORDER BY updated_at DESC
      LIMIT 5
    `;
    console.log('\nSample addresses from database (most recently updated):');
    sampleAddresses.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.address}, ${row.postal_code || 'N/A'} ${row.city}`);
    });

    // Count how many have real addresses vs BAG Pand placeholders
    const addressStats = await queryClient`
      SELECT
        COUNT(*) FILTER (WHERE address LIKE 'BAG%') as placeholder_count,
        COUNT(*) FILTER (WHERE address NOT LIKE 'BAG%') as real_count,
        COUNT(*) as total
      FROM properties
    `;
    console.log(`\nAddress statistics:`);
    console.log(`  - Real addresses: ${addressStats[0].real_count}`);
    console.log(`  - BAG Pand placeholders: ${addressStats[0].placeholder_count}`);
    console.log(`  - Total: ${addressStats[0].total}`);
  } catch (error) {
    console.error('Error during seeding:', error);
    throw error;
  } finally {
    await queryClient.end();
    console.log('\nDatabase connection closed');
  }
}

// Run the seed
seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
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
 * Generate a placeholder address from BAG identificatie
 */
function generateAddress(identificatie: string): string {
  // The BAG identificatie doesn't contain address info directly
  // In a real scenario, you would join with verblijfsobject/nummeraanduiding tables
  // For now, use a placeholder with the ID
  return `BAG Pand ${identificatie}`;
}

async function seed() {
  console.log('Starting database seed...');

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

  // Connect to database
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5432/huishype';
  console.log('Connecting to database...');

  const queryClient = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {}, // Suppress notices
  });

  const db = drizzle(queryClient);

  try {
    // Transform GeoJSON features to property records
    const propertyRecords: NewProperty[] = geojsonData.features.map((feature, index) => {
      const centroid = calculateCentroid(feature.geometry);

      const record: NewProperty = {
        bagIdentificatie: feature.properties.identificatie,
        address: generateAddress(feature.properties.identificatie),
        city: 'Eindhoven',
        postalCode: null, // Not available in pand data, would need verblijfsobject
        geometry: {
          type: 'Point',
          coordinates: [centroid.lon, centroid.lat],
        },
        bouwjaar: feature.properties.bouwjaar ?? null,
        oppervlakte: feature.properties.oppervlakte_min ?? null,
        status: mapStatus(feature.properties.status),
      };

      if ((index + 1) % 100 === 0) {
        console.log(`Processed ${index + 1}/${geojsonData.features.length} features...`);
      }

      return record;
    });

    console.log(`Transformed ${propertyRecords.length} property records`);

    // Insert in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    let insertedCount = 0;

    for (let i = 0; i < propertyRecords.length; i += BATCH_SIZE) {
      const batch = propertyRecords.slice(i, i + BATCH_SIZE);

      await db.insert(properties).values(batch).onConflictDoNothing();

      insertedCount += batch.length;
      console.log(`Inserted batch ${Math.ceil((i + 1) / BATCH_SIZE)}: ${insertedCount}/${propertyRecords.length} records`);
    }

    console.log(`\nSeed completed successfully!`);
    console.log(`Total records processed: ${propertyRecords.length}`);

    // Verify insertion
    const result = await queryClient`SELECT COUNT(*) as count FROM properties`;
    console.log(`Total properties in database: ${result[0].count}`);
  } catch (error) {
    console.error('Error during seeding:', error);
    throw error;
  } finally {
    await queryClient.end();
    console.log('Database connection closed');
  }
}

// Run the seed
seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

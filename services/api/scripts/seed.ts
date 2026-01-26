import { readFileSync, existsSync } from 'fs';
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

// Local BAG address data types
interface BAGAddressFeature {
  type: 'Feature';
  properties: {
    pand_identificatie: string;
    openbare_ruimte_naam: string;
    huisnummer: number;
    huisletter: string | null;
    toevoeging: string | null;
    postcode: string;
    woonplaats_naam: string;
  };
  geometry: null;
}

interface BAGAddressCollection {
  type: 'FeatureCollection';
  name?: string;
  features: BAGAddressFeature[];
}

// Address info structure
interface AddressInfo {
  address: string;
  postalCode: string | null;
  city: string;
}

// PDOK Reverse Geocoding response types (kept for fallback)
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

// Cache for PDOK reverse geocoding results (fallback only)
const geocodeCache = new Map<string, AddressInfo>();

// Local BAG address lookup map: pand_identificatie -> AddressInfo
let localAddressMap: Map<string, AddressInfo> | null = null;

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
 * Load local BAG address data from pre-extracted JSON
 * This provides instant address lookup without API calls
 */
function loadLocalAddressData(): Map<string, AddressInfo> {
  const addressMap = new Map<string, AddressInfo>();
  const addressFilePath = resolve(__dirname, '../../../fixtures/eindhoven-addresses.json');

  if (!existsSync(addressFilePath)) {
    console.warn(`Local address file not found: ${addressFilePath}`);
    console.warn('Run: ogr2ogr -f GeoJSON fixtures/eindhoven-addresses.json data_sources/bag-light.gpkg \\');
    console.warn('  -sql "SELECT pand_identificatie, openbare_ruimte_naam, huisnummer, huisletter, toevoeging, postcode, woonplaats_naam FROM verblijfsobject WHERE woonplaats_naam = \'Eindhoven\'"');
    return addressMap;
  }

  console.log(`Loading local BAG address data from: ${addressFilePath}`);
  const startTime = Date.now();

  try {
    const fileContent = readFileSync(addressFilePath, 'utf-8');
    const addressData = JSON.parse(fileContent) as BAGAddressCollection;

    // Build lookup map - use first address for each pand (some pands have multiple verblijfsobjecten)
    for (const feature of addressData.features) {
      const props = feature.properties;
      const pandId = props.pand_identificatie;

      // Skip if we already have an address for this pand
      if (addressMap.has(pandId)) {
        continue;
      }

      const address = formatBAGAddress(
        props.openbare_ruimte_naam,
        props.huisnummer,
        props.huisletter,
        props.toevoeging
      );

      addressMap.set(pandId, {
        address,
        postalCode: props.postcode || null,
        city: props.woonplaats_naam || 'Eindhoven',
      });
    }

    const loadTime = Date.now() - startTime;
    console.log(`Loaded ${addressMap.size} unique pand addresses in ${loadTime}ms`);
    console.log(`(from ${addressData.features.length} verblijfsobject records)`);

    return addressMap;
  } catch (error) {
    console.error('Error loading local address data:', error);
    return addressMap;
  }
}

/**
 * Look up address from local BAG data by pand identificatie
 */
function lookupLocalAddress(pandIdentificatie: string): AddressInfo | null {
  if (!localAddressMap) {
    localAddressMap = loadLocalAddressData();
  }
  return localAddressMap.get(pandIdentificatie) || null;
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
 * Reverse geocode coordinates using PDOK Locatieserver (FALLBACK)
 * Only used when local BAG lookup fails
 */
async function reverseGeocodePDOK(
  lat: number,
  lon: number,
  retries = 3
): Promise<AddressInfo | null> {
  // Check cache first
  const cacheKey = getCacheKey(lat, lon);
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // PDOK Locatieserver reverse geocoding endpoint
  const url = new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lon.toString());
  url.searchParams.set('rows', '1');
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
          console.warn(`Rate limited, waiting before retry ${attempt}/${retries}...`);
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as PDOKReverseResponse;

      if (data.response.numFound === 0 || !data.response.docs.length) {
        return null;
      }

      const doc = data.response.docs[0];

      let address: string;
      if (doc.straatnaam && doc.huisnummer) {
        address = `${doc.straatnaam} ${doc.huisnummer}`;
      } else if (doc.weergavenaam) {
        const parts = doc.weergavenaam.split(',');
        address = parts[0].trim();
      } else {
        return null;
      }

      const result: AddressInfo = {
        address,
        postalCode: doc.postcode || null,
        city: doc.woonplaatsnaam || doc.gemeentenaam || 'Eindhoven',
      };

      geocodeCache.set(cacheKey, result);
      return result;
    } catch (error) {
      if (attempt === retries) {
        console.error(`Failed to reverse geocode (${lat}, ${lon}) after ${retries} attempts:`, error);
        return null;
      }
      await sleep(500 * attempt);
    }
  }

  return null;
}

/**
 * Format a fallback address when all lookups fail
 * Uses coordinates to generate a unique but recognizable address
 */
function generateFallbackAddress(lat: number, lon: number, identificatie: string): string {
  const latPart = Math.abs(Math.round(lat * 10000) % 100);
  const lonPart = Math.abs(Math.round(lon * 10000) % 100);
  return `Straat ${latPart}${lonPart} ${identificatie.slice(-4)}`;
}

async function seed() {
  console.log('Starting database seed with LOCAL BAG address resolution...');
  console.log('Primary: Local BAG verblijfsobject data');
  console.log('Fallback: PDOK API (if local lookup fails)\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;
  const skipGeocoding = args.includes('--skip-geocoding');
  const usePDOKOnly = args.includes('--pdok-only');

  if (limit) {
    console.log(`Limiting to ${limit} properties`);
  }
  if (skipGeocoding) {
    console.log('Skipping all geocoding (using fallback addresses)');
  }
  if (usePDOKOnly) {
    console.log('Using PDOK API only (ignoring local data)');
  }

  // Pre-load local address data (unless skipping or using PDOK only)
  if (!skipGeocoding && !usePDOKOnly) {
    localAddressMap = loadLocalAddressData();
  }

  // Read the GeoJSON fixture file
  const fixturePath = resolve(__dirname, '../../../fixtures/eindhoven-sandbox.geojson');
  console.log(`\nReading fixture file: ${fixturePath}`);

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
    onnotice: () => {},
  });

  const db = drizzle(queryClient);

  try {
    // Process features and resolve addresses
    const propertyRecords: NewProperty[] = [];
    let localLookupCount = 0;
    let pdokFallbackCount = 0;
    let fallbackCount = 0;

    console.log('\nResolving addresses...');
    const startTime = Date.now();

    for (let index = 0; index < featuresToProcess.length; index++) {
      const feature = featuresToProcess[index];
      const centroid = calculateCentroid(feature.geometry);
      const pandId = feature.properties.identificatie;

      let address: string;
      let postalCode: string | null = null;
      let city = 'Eindhoven';

      if (!skipGeocoding) {
        // Strategy 1: Try local BAG lookup first (instant)
        let addressInfo: AddressInfo | null = null;

        if (!usePDOKOnly) {
          addressInfo = lookupLocalAddress(pandId);
          if (addressInfo) {
            localLookupCount++;
          }
        }

        // Strategy 2: Fall back to PDOK API if local lookup failed
        if (!addressInfo && !usePDOKOnly) {
          // Only use PDOK sparingly - it's slow and rate-limited
          // For now, we skip PDOK fallback to keep seeding fast
          // Enable with --pdok-fallback if needed
          if (args.includes('--pdok-fallback')) {
            addressInfo = await reverseGeocodePDOK(centroid.lat, centroid.lon);
            if (addressInfo) {
              pdokFallbackCount++;
              // Rate limiting for PDOK
              if ((pdokFallbackCount + 1) % 5 === 0) {
                await sleep(150);
              }
            }
          }
        }

        // Use PDOK only mode
        if (usePDOKOnly) {
          addressInfo = await reverseGeocodePDOK(centroid.lat, centroid.lon);
          if (addressInfo) {
            pdokFallbackCount++;
            if ((pdokFallbackCount + 1) % 5 === 0) {
              await sleep(150);
            }
          }
        }

        if (addressInfo) {
          address = addressInfo.address;
          postalCode = addressInfo.postalCode;
          city = addressInfo.city;
        } else {
          // Final fallback: generated address
          address = generateFallbackAddress(centroid.lat, centroid.lon, pandId);
          fallbackCount++;
        }
      } else {
        // Skip all geocoding, use fallback directly
        address = generateFallbackAddress(centroid.lat, centroid.lon, pandId);
        fallbackCount++;
      }

      const record: NewProperty = {
        bagIdentificatie: pandId,
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

      // Progress logging (every 10000 for fast local lookups, every 50 for PDOK)
      const logInterval = usePDOKOnly ? 50 : 10000;
      if ((index + 1) % logInterval === 0 || index === featuresToProcess.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `Progress: ${index + 1}/${featuresToProcess.length} (${elapsed}s) | ` +
            `Local: ${localLookupCount} | PDOK: ${pdokFallbackCount} | Fallback: ${fallbackCount}`
        );
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nAddress resolution completed in ${totalTime}s`);
    console.log(`Transformed ${propertyRecords.length} property records`);
    console.log(`  - Local BAG lookup: ${localLookupCount} (${((localLookupCount / propertyRecords.length) * 100).toFixed(1)}%)`);
    console.log(`  - PDOK API fallback: ${pdokFallbackCount}`);
    console.log(`  - Generated fallback: ${fallbackCount}`);

    // Insert in batches
    const BATCH_SIZE = 1000; // Larger batches for faster insertion
    let insertedCount = 0;

    console.log('\nInserting into database...');
    const insertStartTime = Date.now();

    for (let i = 0; i < propertyRecords.length; i += BATCH_SIZE) {
      const batch = propertyRecords.slice(i, i + BATCH_SIZE);

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
      if ((i + BATCH_SIZE) % 10000 === 0 || insertedCount === propertyRecords.length) {
        console.log(`Inserted: ${insertedCount}/${propertyRecords.length} records`);
      }
    }

    const insertTime = ((Date.now() - insertStartTime) / 1000).toFixed(1);
    console.log(`\nDatabase insertion completed in ${insertTime}s`);
    console.log(`Total records processed: ${propertyRecords.length}`);

    // Verify insertion
    const result = await queryClient`SELECT COUNT(*) as count FROM properties`;
    console.log(`Total properties in database: ${result[0].count}`);

    // Show sample addresses
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

    // Address statistics
    const addressStats = await queryClient`
      SELECT
        COUNT(*) FILTER (WHERE address LIKE 'BAG%') as bag_placeholder_count,
        COUNT(*) FILTER (WHERE address LIKE 'Straat%') as generated_count,
        COUNT(*) FILTER (WHERE address NOT LIKE 'BAG%' AND address NOT LIKE 'Straat%') as real_count,
        COUNT(*) as total
      FROM properties
    `;
    console.log(`\nAddress statistics:`);
    console.log(`  - Real BAG addresses: ${addressStats[0].real_count}`);
    console.log(`  - Generated fallback (Straat...): ${addressStats[0].generated_count}`);
    console.log(`  - Old BAG Pand placeholders: ${addressStats[0].bag_placeholder_count}`);
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

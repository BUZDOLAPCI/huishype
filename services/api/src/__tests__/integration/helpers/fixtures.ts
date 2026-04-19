import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../../../db/index.js';
import { users } from '../../../db/schema.js';
import { generateAccessToken } from '../../../plugins/auth.js';

// Shared builders for integration suites that create and clean up their own
// rows instead of relying on ambient seeded property/listing data.

type PropertyStatus = 'active' | 'inactive' | 'demolished';
type ListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';

interface CreateUserOptions {
  label: string;
}

interface CreatePropertyOptions {
  id?: string;
  countryCode?: string;
  nationalId?: string | null;
  street?: string;
  houseNumber?: number;
  houseNumberAddition?: string | null;
  city?: string;
  region?: string | null;
  postalCode?: string;
  status?: PropertyStatus;
  lon?: number;
  lat?: number;
  officialValuation?: number | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
}

interface CreateListingOptions {
  id?: string;
  propertyId: string;
  sourceName?: string;
  sourceUrl?: string;
  status?: ListingStatus;
  askingPrice?: number | null;
  thumbnailUrl?: string | null;
  priceType?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CreatePriceHistoryOptions {
  id?: string;
  propertyId: string;
  listingId: string;
  price: number;
  priceDate?: Date;
  eventType: string;
  source: string;
  createdAt?: Date;
}

interface CreateOsmBuildingRectangleOptions {
  osmId?: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function normalizeFixtureIdentifier(label: string, maxLength: number) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

export async function createIntegrationUser(app: FastifyInstance, options: CreateUserOptions) {
  // Integration fixtures only need a persisted user row plus a valid JWT. Do
  // not route this through OAuth, otherwise unrelated auth/profile changes can
  // break suites that are only exercising downstream API behavior.
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const normalizedLabel = normalizeFixtureIdentifier(options.label, 24) || 'fixture-user';
  const username = `${normalizedLabel}-${suffix}`.slice(0, 50);
  const emailLocalPart = `${normalizedLabel}-${suffix}`.slice(0, 64);
  const googleId = `fixture-google-${normalizedLabel}-${suffix}`.slice(0, 255);
  const displayName = options.label.slice(0, 100) || 'Fixture User';

  const [user] = await db
    .insert(users)
    .values({
      googleId,
      email: `${emailLocalPart}@gmail.com`,
      username,
      displayName,
    })
    .returning({ id: users.id });

  return {
    userId: user.id,
    accessToken: generateAccessToken(app, user.id),
  };
}

export async function createIntegrationProperty(options: CreatePropertyOptions = {}) {
  const property = {
    id: options.id ?? crypto.randomUUID(),
    countryCode: options.countryCode ?? 'NL',
    nationalId: options.nationalId ?? null,
    street: options.street ?? `Fixture Street ${Date.now()}`,
    houseNumber: options.houseNumber ?? 1,
    houseNumberAddition: options.houseNumberAddition ?? null,
    city: options.city ?? 'Fixture City',
    region: options.region ?? null,
    postalCode: options.postalCode ?? '1234AB',
    status: options.status ?? 'active',
    lon: options.lon ?? 5.47,
    lat: options.lat ?? 51.44,
    officialValuation: options.officialValuation ?? null,
    yearBuilt: options.yearBuilt ?? null,
    floorAreaM2: options.floorAreaM2 ?? null,
  };

  await db.execute(sql`
    INSERT INTO properties (
      id,
      country_code,
      national_id,
      street,
      house_number,
      house_number_addition,
      city,
      region,
      postal_code,
      status,
      geometry,
      official_valuation,
      year_built,
      floor_area_m2
    )
    VALUES (
      ${property.id},
      ${property.countryCode},
      ${property.nationalId},
      ${property.street},
      ${property.houseNumber},
      ${property.houseNumberAddition},
      ${property.city},
      ${property.region},
      ${property.postalCode},
      ${property.status},
      ST_SetSRID(ST_MakePoint(${property.lon}, ${property.lat}), 4326),
      ${property.officialValuation},
      ${property.yearBuilt},
      ${property.floorAreaM2}
    )
  `);

  return property;
}

export async function createIntegrationListing(options: CreateListingOptions) {
  const createdAt = options.createdAt ?? new Date();
  const updatedAt = options.updatedAt ?? createdAt;
  const listing = {
    id: options.id ?? crypto.randomUUID(),
    propertyId: options.propertyId,
    sourceName: options.sourceName ?? 'funda',
    sourceUrl:
      options.sourceUrl ?? `https://example.com/listing-${options.propertyId}-${crypto.randomUUID()}`,
    status: options.status ?? 'active',
    askingPrice: options.askingPrice ?? null,
    thumbnailUrl: options.thumbnailUrl ?? null,
    priceType: options.priceType ?? 'sale',
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };

  await db.execute(sql`
    INSERT INTO listings (
      id,
      property_id,
      source_name,
      source_url,
      status,
      asking_price,
      thumbnail_url,
      price_type,
      created_at,
      updated_at
    )
    VALUES (
      ${listing.id},
      ${listing.propertyId},
      ${listing.sourceName},
      ${listing.sourceUrl},
      ${listing.status},
      ${listing.askingPrice},
      ${listing.thumbnailUrl},
      ${listing.priceType},
      ${listing.createdAt},
      ${listing.updatedAt}
    )
  `);

  return listing;
}

export async function createIntegrationPriceHistory(options: CreatePriceHistoryOptions) {
  const priceDate = options.priceDate ?? new Date();
  const createdAt = options.createdAt ?? new Date();
  const priceHistory = {
    id: options.id ?? crypto.randomUUID(),
    propertyId: options.propertyId,
    listingId: options.listingId,
    price: options.price,
    priceDate: priceDate.toISOString(),
    eventType: options.eventType,
    source: options.source,
    createdAt: createdAt.toISOString(),
  };

  await db.execute(sql`
    INSERT INTO price_history (
      id,
      property_id,
      listing_id,
      price,
      price_date,
      event_type,
      source,
      created_at
    )
    VALUES (
      ${priceHistory.id},
      ${priceHistory.propertyId},
      ${priceHistory.listingId},
      ${priceHistory.price},
      ${priceHistory.priceDate},
      ${priceHistory.eventType},
      ${priceHistory.source},
      ${priceHistory.createdAt}
    )
  `);

  return priceHistory;
}

export async function createIntegrationOsmBuildingRectangle(
  options: CreateOsmBuildingRectangleOptions,
) {
  const osmId = options.osmId ?? Number(`8${Date.now()}`.slice(0, 12));

  await db.execute(sql`
    INSERT INTO osm_buildings (osm_id, geometry)
    VALUES (
      ${osmId},
      ST_GeomFromText(
        ${`MULTIPOLYGON(((${options.minLon} ${options.minLat}, ${options.maxLon} ${options.minLat}, ${options.maxLon} ${options.maxLat}, ${options.minLon} ${options.maxLat}, ${options.minLon} ${options.minLat})))`},
        4326
      )
    )
  `);

  return { osmId };
}

export async function refreshLatestActiveListingsView() {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);
}

export function tileCoordinatesForPoint(lon: number, lat: number, z: number) {
  const latRad = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * Math.pow(2, z)),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z),
    ),
  };
}

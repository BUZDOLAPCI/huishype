import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db, properties as propertiesTable } from '../../db/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for GET /properties/resolve endpoint.
 *
 * Tests against hermetic Dutch property fixtures created within this suite.
 * The endpoint resolves a postal code + house number to a local property.
 */
describe('GET /properties/resolve', () => {
  let app: FastifyInstance;
  const cleanupPropertyIds: string[] = [];

  let knownPostalCode: string;
  let knownHouseNumber: number;
  let knownHouseNumberAddition: string | null;
  let knownPropertyId: string;
  let knownCity: string;
  let knownCountryCode: string;
  let disambiguationFixture: {
    postalCode: string;
    houseNumber: number;
    street: string;
    city: string;
    countryCode: string;
  } | null = null;

  async function findUnusedAddressKey(countryCode: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const postalCode = `${9000 + attempt}${String.fromCharCode(65 + (attempt % 26))}${String.fromCharCode(90 - (attempt % 26))}`;
      const houseNumber = 7000 + attempt;
      const [row] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.countryCode, countryCode),
            eq(propertiesTable.postalCode, postalCode),
            eq(propertiesTable.houseNumber, houseNumber),
            sql`${propertiesTable.houseNumberAddition} IS NULL`,
          ),
        );

      if (Number(row?.count ?? 0) === 0) {
        return { postalCode, houseNumber };
      }
    }

    throw new Error('Failed to find an unused address key for resolve integration tests');
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const knownProperty = await createIntegrationProperty({
      street: 'Resolve Known Street',
      houseNumber: 16,
      houseNumberAddition: 'A',
      city: 'Resolve Known City',
      postalCode: '5658DP',
      lon: 5.472,
      lat: 51.442,
    });
    cleanupPropertyIds.push(knownProperty.id);
    knownPostalCode = knownProperty.postalCode;
    knownHouseNumber = knownProperty.houseNumber;
    knownHouseNumberAddition = knownProperty.houseNumberAddition;
    knownPropertyId = knownProperty.id;
    knownCity = knownProperty.city;
    knownCountryCode = knownProperty.countryCode;

    const key = await findUnusedAddressKey('NL');
    const tempRows = Array.from({ length: 11 }, (_, index) => ({
      countryCode: 'NL',
      postalCode: key.postalCode,
      houseNumber: key.houseNumber,
      houseNumberAddition: null,
      street:
        index === 10
          ? 'Resolve Matchstraat'
          : `Resolve Decoy ${String(index + 1).padStart(2, '0')}`,
      city:
        index === 10
          ? 'Resolve Matchstad'
          : `Resolve Decoystad ${String(index + 1).padStart(2, '0')}`,
      status: 'active' as const,
    }));

    const inserted = await db
      .insert(propertiesTable)
      .values(tempRows)
      .returning({ id: propertiesTable.id });
    cleanupPropertyIds.push(...inserted.map((row) => row.id));

    disambiguationFixture = {
      postalCode: key.postalCode,
      houseNumber: key.houseNumber,
      street: 'Resolve Matchstraat',
      city: 'Resolve Matchstad',
      countryCode: 'NL',
    };
  });

  function getDisambiguationFixture() {
    if (!disambiguationFixture) {
      throw new Error('Resolve disambiguation fixture was not initialized');
    }

    return disambiguationFixture;
  }

  afterAll(async () => {
    for (const id of cleanupPropertyIds) {
      try {
        await db.delete(propertiesTable).where(eq(propertiesTable.id, id));
      } catch {
        // Ignore cleanup failures so the app can still close cleanly.
      }
    }
    await app.close();
  });

  it('should resolve a known property by postal code and house number', async () => {
    const query = knownHouseNumberAddition
      ? `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.id).toBe(knownPropertyId);
    expect(body.countryCode).toBe(knownCountryCode);
    expect(body.postalCode).toBe(knownPostalCode);
    expect(body.city).toBe(knownCity);
    expect(body).toHaveProperty('address');
    expect(body).toHaveProperty('coordinates');
    expect(body.coordinates).toHaveProperty('lon');
    expect(body.coordinates).toHaveProperty('lat');
    expect(typeof body.coordinates.lon).toBe('number');
    expect(typeof body.coordinates.lat).toBe('number');
    expect(typeof body.hasActiveListing).toBe('boolean');
    expect(typeof body.marketState).toBe('string');
    expect(body.officialValuation === null || typeof body.officialValuation === 'number').toBe(true);
  });

  it('keeps /properties/resolve lean for preview bootstrap', async () => {
    const query = knownHouseNumberAddition
      ? `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('hasListing');
    expect(body).not.toHaveProperty('latestListingStatus');
    expect(body).not.toHaveProperty('socialScore');
    expect(body).not.toHaveProperty('recentSocialScore');
    expect(body).not.toHaveProperty('commentCount');
  });

  it('should return null for a non-existent address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=9999ZZ&houseNumber=99999',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toBeNull();
  });

  it('should handle postal code with space (e.g. "5658 DP")', async () => {
    // Insert a space into the known postal code (e.g. "5658DP" -> "5658 DP")
    const withSpace = knownPostalCode.slice(0, 4) + ' ' + knownPostalCode.slice(4);

    const query = knownHouseNumberAddition
      ? `postalCode=${encodeURIComponent(withSpace)}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${encodeURIComponent(withSpace)}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(knownPropertyId);
  });

  it('should handle lowercase postal code', async () => {
    const query = knownHouseNumberAddition
      ? `postalCode=${knownPostalCode.toLowerCase()}&houseNumber=${knownHouseNumber}&houseNumberAddition=${knownHouseNumberAddition}`
      : `postalCode=${knownPostalCode.toLowerCase()}&houseNumber=${knownHouseNumber}`;

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?${query}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(knownPropertyId);
  });

  it('canonicalizes blank stored additions as missing during resolve lookups', async () => {
    const key = await findUnusedAddressKey('NL');
    const propertyId = crypto.randomUUID();
    cleanupPropertyIds.push(propertyId);

    await db.execute(sql`
      INSERT INTO properties (
        id,
        country_code,
        street,
        house_number,
        house_number_addition,
        city,
        postal_code,
        status,
        geometry
      )
      VALUES (
        ${propertyId},
        'NL',
        'Resolve Blank Addition Street',
        ${key.houseNumber},
        '   ',
        'Resolve Blank City',
        ${key.postalCode},
        'active',
        ST_SetSRID(ST_MakePoint(5.473, 51.443), 4326)
      )
    `);

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?postalCode=${key.postalCode}&houseNumber=${key.houseNumber}&countryCode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(propertyId);
    expect(body.address).toBe(`${'Resolve Blank Addition Street'} ${key.houseNumber}, ${key.postalCode} Resolve Blank City`);
  });

  it('should differentiate between null addition and non-null addition', async () => {
    // If the known property has no addition, querying with an addition should resolve null.
    // If the known property has an addition, querying without should resolve null unless
    // another property exists at the same address without the addition.
    if (knownHouseNumberAddition) {
      // Property has addition - query without it should fail
      const response = await app.inject({
        method: 'GET',
        url: `/properties/resolve?postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}`,
      });
      const body = JSON.parse(response.body);
      // Could resolve to a different property if a no-addition peer exists.
      // Otherwise the nullable not-found contract returns null with 200.
      if (body) {
        // It should be a different property (or the same address without addition)
        expect(body.id).not.toBe(knownPropertyId);
      } else {
        expect(response.statusCode).toBe(200);
        expect(body).toBeNull();
      }
    } else {
      // Property has no addition - query with a fake addition should resolve null
      const response = await app.inject({
        method: 'GET',
        url: `/properties/resolve?postalCode=${knownPostalCode}&houseNumber=${knownHouseNumber}&houseNumberAddition=ZZZ`,
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toBeNull();
    }
  });

  it('should return 400 for missing postalCode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?houseNumber=1',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 400 for missing houseNumber', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=5658DP',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 400 for invalid houseNumber (non-numeric)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/resolve?postalCode=5658DP&houseNumber=abc',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should resolve the correct property even when more than ten peers share the same postal code and house number', async () => {
    const fixture = getDisambiguationFixture();
    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?postalCode=${fixture.postalCode}&houseNumber=${fixture.houseNumber}&street=${encodeURIComponent(fixture.street)}&city=${encodeURIComponent(fixture.city)}&countryCode=${fixture.countryCode}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.postalCode).toBe(fixture.postalCode);
    expect(body.city).toBe(fixture.city);
    expect(body.countryCode).toBe(fixture.countryCode);
    expect(body.address).toContain(fixture.street);
  });

  it('should match accented street and city names using the shared normalization contract', async () => {
    const key = await findUnusedAddressKey('NL');
    const street = 'Café de la Résistance';
    const city = 'München';

    const [inserted] = await db
      .insert(propertiesTable)
      .values({
        countryCode: 'NL',
        postalCode: key.postalCode,
        houseNumber: key.houseNumber,
        houseNumberAddition: null,
        street,
        city,
        status: 'active',
      })
      .returning({ id: propertiesTable.id });

    cleanupPropertyIds.push(inserted.id);

    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?postalCode=${key.postalCode}&houseNumber=${key.houseNumber}&street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&countryCode=NL`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe(inserted.id);
    expect(body.address).toContain('Café');
    expect(body.city).toBe(city);
  });

  it('should return 409 when multiple real matches remain after filtering', async () => {
    const fixture = getDisambiguationFixture();
    const response = await app.inject({
      method: 'GET',
      url: `/properties/resolve?postalCode=${fixture.postalCode}&houseNumber=${fixture.houseNumber}&countryCode=${fixture.countryCode}`,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('AMBIGUOUS_ADDRESS');
  });
});

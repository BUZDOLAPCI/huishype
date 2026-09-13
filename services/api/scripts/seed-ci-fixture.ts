import postgres from 'postgres';
import { PLAYWRIGHT_TEST_PROPERTIES } from '../../../scripts/playwright/property-tile-fixture.mjs';
import { assertCiDatabaseFixtureTarget, assertConnectedCiFixtureTarget } from '../../../scripts/playwright/ci-database-fixture.mjs';

const args = process.argv.slice(2);
const databaseName = args.length === 2 && args[0] === '--database-name' ? args[1] : undefined;
const target = assertCiDatabaseFixtureTarget(process.env, databaseName);
const client = postgres(target.databaseUrl, { max: 1, onnotice: () => {} });
const listingIds = PLAYWRIGHT_TEST_PROPERTIES.map(property => property.id.replace(/^91/, '92'));
let closeApplicationConnection: (() => Promise<void>) | undefined;

try {
  const [connected] = await client`SELECT current_database() AS database_name,
    current_user AS user_name,inet_server_addr()::text AS server_addr`;
  assertConnectedCiFixtureTarget(target, connected);

  await client.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('playwright-ci-database-fixture'))`;
    // This command owns an otherwise empty test database. Repeating its own
    // bootstrap is safe; existing development, imported, or user data is not.
    const [occupied] = await transaction`SELECT
      EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM listings)
      OR EXISTS (SELECT 1 FROM source_listing_identities)
      OR EXISTS (SELECT 1 FROM properties WHERE id <> ALL(${PLAYWRIGHT_TEST_PROPERTIES.map(property => property.id)}::uuid[]))
      OR EXISTS (SELECT 1 FROM canonical_listings WHERE id <> ALL(${listingIds}::uuid[])) AS occupied`;
    if (occupied?.occupied) throw new Error('CI fixture bootstrap requires an empty database or only its own fixture rows.');

    for (const [index, property] of PLAYWRIGHT_TEST_PROPERTIES.entries()) {
      const nationalId = `playwright-ci-property-${index + 1}`;
      const listingId = listingIds[index]!;
      const url = `https://test.huishype.nl/playwright-ci/property-${index + 1}`;
      const [conflict] = await transaction`SELECT
        EXISTS (SELECT 1 FROM properties WHERE id = ${property.id} AND national_id IS DISTINCT FROM ${nationalId})
        OR EXISTS (SELECT 1 FROM canonical_listings WHERE id = ${listingId}
          AND (property_id <> ${property.id} OR canonical_url IS DISTINCT FROM ${url})) AS conflict`;
      if (conflict?.conflict) throw new Error('Reserved CI fixture identifiers belong to other data.');

      await transaction`INSERT INTO properties
        (id,country_code,national_id,street,house_number,postal_code,city,region,geometry,status,official_valuation,official_valuation_year)
        VALUES (${property.id},'NL',${nationalId},${property.street},${property.houseNumber},${property.postalCode},
          ${property.city},'Noord-Brabant',ST_SetSRID(ST_MakePoint(${property.lon},${property.lat}),4326),'active',${property.officialValuation},2025)
        ON CONFLICT (id) DO NOTHING`;

      await transaction`INSERT INTO canonical_listings
        (id,property_id,source_name,primary_source_listing_id,canonical_url,display_url,status,status_source,
         verification_state,origin_summary,title,asking_price,price_currency,price_type,price_period,price_unit,price_condition,
         living_area_m2,listed_at,first_seen_at,last_seen_at,last_positive_availability_at,availability_expires_at,active_eligible)
        VALUES (${listingId},${property.id},'funda',${nationalId},${url},${url},'active','mirror','validated','mirror',
          ${`Playwright fixture: ${property.street} ${property.houseNumber}`},${property.askingPrice},'EUR','sale','total','listing','asking',
          120,now(),now(),now(),now(),now() + interval '720 hours',true)
        ON CONFLICT (id) DO NOTHING`;
    }
  });

  const { refreshLocationSearchAreasForPropertyKeys } = await import('../src/services/location-search-areas.js');
  const { closeConnection } = await import('../src/db/index.js');
  closeApplicationConnection = closeConnection;
  await refreshLocationSearchAreasForPropertyKeys(PLAYWRIGHT_TEST_PROPERTIES.map(property => ({
    countryCode: 'NL', city: property.city, region: 'Noord-Brabant', postalCode: property.postalCode, street: property.street,
  })));
  // Fresh materialized views may be unpopulated. This runs before the test API.
  await client`REFRESH MATERIALIZED VIEW mv_latest_active_listings`;
  await client`REFRESH MATERIALIZED VIEW mv_price_guess_start_market_summaries`;
  console.log(JSON.stringify({ databaseName: target.databaseName, properties: PLAYWRIGHT_TEST_PROPERTIES.length,
    canonicalListings: listingIds.length, owner: 'ephemeral-ci-test-database' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeApplicationConnection?.();
  await client.end();
}

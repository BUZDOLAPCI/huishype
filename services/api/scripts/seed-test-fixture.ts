// ---------------------------------------------------------------------------
// seed-test-fixture.ts
//
// Seeds deterministic test data for the Maestro consolidated test flow.
// Target property: Beeldbuisring 41, 5651HA, Eindhoven
//
// Creates: 3 users, 1 listing, 5 comments (with reply chain), 3 price guesses,
//          5 reactions, and sets WOZ value on the fixture property.
//
// All inserts use ON CONFLICT ... DO NOTHING for idempotency.
// The BAG seed must have run first (property must exist in the properties table).
//
// Usage:
//   npx tsx scripts/seed-test-fixture.ts
// ---------------------------------------------------------------------------

import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_POSTAL_CODE = '5651HA';
const FIXTURE_HOUSE_NUMBER = 41;
const FIXTURE_ADDRESS_LABEL = 'Beeldbuisring 41, 5651HA, Eindhoven';

// Fixed UUIDs for test users (must be valid RFC 4122 v4 UUIDs for Zod 4 validation)
const USER_ANNA_ID = 'a0000000-0000-4000-a000-000000000a01';
const USER_BART_ID = 'b0000000-0000-4000-b000-000000000b02';
const USER_CARLOS_ID = 'c0000000-0000-4000-a000-000000000c03';

// Fixed UUIDs for comments (must be valid RFC 4122 v4 UUIDs for Zod 4 validation)
const COMMENT_1_ID = 'd0000000-0000-4000-a001-000000000001';
const COMMENT_2_ID = 'd0000000-0000-4000-a001-000000000002';
const COMMENT_3_ID = 'd0000000-0000-4000-a001-000000000003';
const COMMENT_4_ID = 'd0000000-0000-4000-a001-000000000004';
const COMMENT_5_ID = 'd0000000-0000-4000-a001-000000000005';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedTestFixture() {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('Seed Test Fixture');
  console.log('='.repeat(60));
  console.log(`Target: ${FIXTURE_ADDRESS_LABEL}`);
  console.log('');

  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';
  const sql = postgres(databaseUrl, { max: 3, onnotice: () => {} });

  try {
    // ------------------------------------------------------------------
    // Step 1: Look up fixture property by address
    // ------------------------------------------------------------------
    console.log('Step 1: Looking up fixture property...');

    const propertyRows = await sql`
      SELECT id, street, house_number, postal_code, city,
             ST_X(geometry::geometry) as lon, ST_Y(geometry::geometry) as lat
      FROM properties
      WHERE postal_code = ${FIXTURE_POSTAL_CODE}
        AND house_number = ${FIXTURE_HOUSE_NUMBER}
        AND (house_number_addition IS NULL OR house_number_addition = '')
      LIMIT 1
    `;

    if (propertyRows.length === 0) {
      console.error(`  ERROR: Property not found at ${FIXTURE_ADDRESS_LABEL}`);
      console.error('  Make sure the BAG seed has been run first (pnpm run db:seed)');
      process.exit(1);
    }

    const property = propertyRows[0];
    const propertyId = property.id as string;
    console.log(`  Found: ${property.street} ${property.house_number}, ${property.postal_code} ${property.city}`);
    console.log(`  ID: ${propertyId}`);
    console.log(`  Location: ${property.lon}, ${property.lat}`);
    console.log('');

    // ------------------------------------------------------------------
    // Step 2: Seed test users
    // ------------------------------------------------------------------
    console.log('Step 2: Seeding test users...');

    const testUsers = [
      {
        id: USER_ANNA_ID,
        google_id: 'test-user-anna',
        email: 'anna@test.huishype.nl',
        username: 'anna_devries',
        display_name: 'Anna de Vries',
      },
      {
        id: USER_BART_ID,
        google_id: 'test-user-bart',
        email: 'bart@test.huishype.nl',
        username: 'bart_jansen',
        display_name: 'Bart Jansen',
      },
      {
        id: USER_CARLOS_ID,
        google_id: 'test-user-carlos',
        email: 'carlos@test.huishype.nl',
        username: 'carlos_bakker',
        display_name: 'Carlos Bakker',
      },
    ];

    for (const user of testUsers) {
      await sql`
        INSERT INTO users (id, google_id, email, username, display_name)
        VALUES (${user.id}, ${user.google_id}, ${user.email}, ${user.username}, ${user.display_name})
        ON CONFLICT (id) DO NOTHING
      `;
      console.log(`  User: ${user.display_name} (${user.username})`);
    }
    console.log('');

    // ------------------------------------------------------------------
    // Step 3: Seed listing
    // ------------------------------------------------------------------
    console.log('Step 3: Seeding listing...');

    const listingSourceUrl = 'https://test.huishype.nl/fixture/beeldbuisring-41';

    await sql`
      INSERT INTO listings (
        property_id, source_url, source_name, asking_price, status,
        num_rooms, living_area_m2, energy_label, thumbnail_url, og_title, price_type
      )
      VALUES (
        ${propertyId},
        ${listingSourceUrl},
        'funda',
        ${395000},
        'active',
        ${3},
        ${144},
        ${'C'},
        ${'https://placeholder.test/fixture.jpg'},
        ${'Te koop: Beeldbuisring 41, Eindhoven'},
        ${'sale'}
      )
      ON CONFLICT (source_url) DO NOTHING
    `;
    console.log(`  Listing: ${listingSourceUrl} (395000 EUR)`);
    console.log('');

    // ------------------------------------------------------------------
    // Step 4: Seed comments
    // ------------------------------------------------------------------
    console.log('Step 4: Seeding comments...');

    const testComments = [
      {
        id: COMMENT_1_ID,
        property_id: propertyId,
        user_id: USER_ANNA_ID,
        parent_id: null,
        content: 'Mooie woning in een rustige buurt!',
      },
      {
        id: COMMENT_2_ID,
        property_id: propertyId,
        user_id: USER_BART_ID,
        parent_id: null,
        content: 'Wat is de staat van de keuken?',
      },
      {
        id: COMMENT_3_ID,
        property_id: propertyId,
        user_id: USER_ANNA_ID,
        parent_id: COMMENT_2_ID, // Reply to Comment 2
        content: 'Keuken is recent gerenoveerd volgens de makelaar',
      },
      {
        id: COMMENT_4_ID,
        property_id: propertyId,
        user_id: USER_CARLOS_ID,
        parent_id: null,
        content: 'Goede prijs voor deze buurt',
      },
      {
        id: COMMENT_5_ID,
        property_id: propertyId,
        user_id: USER_BART_ID,
        parent_id: null,
        content: 'Is er parkeergelegenheid?',
      },
    ];

    for (const comment of testComments) {
      await sql`
        INSERT INTO comments (id, property_id, user_id, parent_id, content)
        VALUES (${comment.id}, ${comment.property_id}, ${comment.user_id}, ${comment.parent_id}, ${comment.content})
        ON CONFLICT (id) DO NOTHING
      `;
      const replyLabel = comment.parent_id ? ` (reply to ${comment.parent_id.slice(-1)})` : '';
      console.log(`  Comment ${comment.id.slice(-1)}: "${comment.content.substring(0, 40)}..."${replyLabel}`);
    }
    console.log('');

    // ------------------------------------------------------------------
    // Step 5: Seed price guesses
    // ------------------------------------------------------------------
    console.log('Step 5: Seeding price guesses...');

    const priceGuesses = [
      { user_id: USER_ANNA_ID, guessed_price: 380000, name: 'Anna' },
      { user_id: USER_BART_ID, guessed_price: 410000, name: 'Bart' },
      { user_id: USER_CARLOS_ID, guessed_price: 395000, name: 'Carlos' },
    ];

    for (const guess of priceGuesses) {
      await sql`
        INSERT INTO price_guesses (property_id, user_id, guessed_price)
        VALUES (${propertyId}, ${guess.user_id}, ${guess.guessed_price})
        ON CONFLICT (user_id, property_id) DO NOTHING
      `;
      console.log(`  ${guess.name}: ${guess.guessed_price.toLocaleString()} EUR`);
    }
    console.log('');

    // ------------------------------------------------------------------
    // Step 6: Seed reactions
    // ------------------------------------------------------------------
    console.log('Step 6: Seeding reactions...');

    const testReactions = [
      // 3 likes on the property (one per user)
      { user_id: USER_ANNA_ID, target_type: 'property', target_id: propertyId, label: 'Anna likes property' },
      { user_id: USER_BART_ID, target_type: 'property', target_id: propertyId, label: 'Bart likes property' },
      { user_id: USER_CARLOS_ID, target_type: 'property', target_id: propertyId, label: 'Carlos likes property' },
      // 2 likes on comments
      { user_id: USER_BART_ID, target_type: 'comment', target_id: COMMENT_1_ID, label: 'Bart likes comment 1' },
      { user_id: USER_ANNA_ID, target_type: 'comment', target_id: COMMENT_4_ID, label: 'Anna likes comment 4' },
    ];

    for (const reaction of testReactions) {
      await sql`
        INSERT INTO reactions (user_id, target_type, target_id, reaction_type)
        VALUES (${reaction.user_id}, ${reaction.target_type}, ${reaction.target_id}, 'like')
        ON CONFLICT (user_id, target_type, target_id) DO NOTHING
      `;
      console.log(`  ${reaction.label}`);
    }
    console.log('');

    // ------------------------------------------------------------------
    // Step 7: Set WOZ value
    // ------------------------------------------------------------------
    console.log('Step 7: Setting WOZ value...');

    await sql`
      UPDATE properties SET woz_value = ${385000} WHERE id = ${propertyId}
    `;
    console.log(`  WOZ value: 385,000 EUR`);
    console.log('');

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------
    console.log('='.repeat(60));
    console.log('Test Fixture Seed Complete');
    console.log('='.repeat(60));
    console.log(`  Property: ${property.street} ${property.house_number}, ${property.postal_code} ${property.city}`);
    console.log(`  Users:    3`);
    console.log(`  Listing:  1 (active, 395,000 EUR)`);
    console.log(`  Comments: 5 (1 reply)`);
    console.log(`  Guesses:  3`);
    console.log(`  Reactions: 5`);
    console.log(`  WOZ:      385,000 EUR`);
    console.log(`  Time:     ${formatTime(Date.now() - startTime)}`);
  } finally {
    await sql.end();
  }
}

seedTestFixture().catch((error) => {
  console.error('\nTest fixture seed failed:', error);
  process.exit(1);
});

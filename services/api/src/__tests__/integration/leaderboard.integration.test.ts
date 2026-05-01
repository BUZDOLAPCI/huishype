import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, comments, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty, createIntegrationUser } from './helpers/fixtures.js';

describe('Leaderboard routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const createdCommentIds: string[] = [];
  const fixtureStreet = 'Leaderboard Fixture Street';
  const fixtureCity = 'Leaderboard City';
  const fixturePostalCode = '9060AA';

  async function deleteLeaderboardFixtureData() {
    await db.execute(sql`
      WITH fixture_properties AS (
        SELECT id
        FROM properties
        WHERE street = ${fixtureStreet}
          AND city = ${fixtureCity}
          AND postal_code = ${fixturePostalCode}
      )
      DELETE FROM reactions r
      USING fixture_properties fp
      WHERE r.target_type = 'property'
        AND r.target_id = fp.id
    `);

    await db.execute(sql`
      DELETE FROM properties
      WHERE street = ${fixtureStreet}
        AND city = ${fixtureCity}
        AND postal_code = ${fixturePostalCode}
    `);
  }

  async function getMaxFeaturedEngagementScore() {
    const rows = await db.execute<{ max_score: number | null }>(sql`
      WITH featured_events AS (
        SELECT
          sub.property_id,
          COUNT(*)::int AS comment_count,
          0::int AS like_count,
          0::int AS guess_count,
          0::int AS view_count,
          MAX(sub.created_at) AS last_at
        FROM comments sub
        GROUP BY sub.property_id

        UNION ALL

        SELECT
          sub.target_id AS property_id,
          0::int AS comment_count,
          COUNT(*)::int AS like_count,
          0::int AS guess_count,
          0::int AS view_count,
          MAX(sub.created_at) AS last_at
        FROM reactions sub
        WHERE sub.target_type = 'property'
          AND sub.reaction_type = 'like'
        GROUP BY sub.target_id

        UNION ALL

        SELECT
          sub.property_id,
          0::int AS comment_count,
          0::int AS like_count,
          COUNT(*)::int AS guess_count,
          0::int AS view_count,
          MAX(sub.created_at) AS last_at
        FROM price_guesses sub
        WHERE sub.is_meme_guess = false
        GROUP BY sub.property_id

        UNION ALL

        SELECT
          sub.property_id,
          0::int AS comment_count,
          0::int AS like_count,
          0::int AS guess_count,
          COUNT(*)::int AS view_count,
          MAX(sub.viewed_at) AS last_at
        FROM property_views sub
        GROUP BY sub.property_id
      ),
      featured_scores AS (
        SELECT
          property_id,
          SUM(comment_count)::int AS comment_count,
          SUM(like_count)::int AS like_count,
          SUM(guess_count)::int AS guess_count,
          SUM(view_count)::int AS view_count,
          MAX(last_at) AS latest_activity_at
        FROM featured_events
        GROUP BY property_id
      )
      SELECT MAX(
        (
          (comment_count * 5)
          + (guess_count * 4)
          + (like_count * 2)
          + (LEAST(view_count, 40) * 0.25)
          + CASE
              WHEN latest_activity_at IS NULL THEN 0
              ELSE GREATEST(
                0,
                14 - (EXTRACT(EPOCH FROM (NOW() - latest_activity_at)) / 86400.0)
              )
            END
        )::float8
      ) AS max_score
      FROM featured_scores
    `);

    return Number(Array.from(rows)[0]?.max_score ?? 0);
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await deleteLeaderboardFixtureData();
    const maxFeaturedScore = await getMaxFeaturedEngagementScore();
    const bulkCommentCount = Math.max(1, Math.ceil((maxFeaturedScore + 50) / 5));

    const user = await createIntegrationUser(app, {
      label: `leaderboard-${Date.now()}`,
    });
    userId = user.userId;
    accessToken = user.accessToken;
    testUserIds.push(userId);

    const property = await createIntegrationProperty({
      street: fixtureStreet,
      houseNumber: 1,
      city: fixtureCity,
      postalCode: fixturePostalCode,
      lon: 5.4706,
      lat: 51.4406,
      officialValuation: 612000,
      officialValuationYear: 2024,
    });
    propertyId = property.id;

    // Seed engagement: add a comment and a like on this property
    const commentResp = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Leaderboard featured test comment' },
    });
    const commentBody = JSON.parse(commentResp.body);
    createdCommentIds.push(commentBody.id);

    await db.execute(sql`
      INSERT INTO comments (id, property_id, user_id, content, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        ${propertyId},
        ${userId},
        'Leaderboard featured weighting ' || series::text,
        NOW(),
        NOW()
      FROM generate_series(1, ${bulkCommentCount}) AS series
    `);

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
  });

  afterAll(async () => {
    // Clean up: unlike, delete comments, delete users
    try {
      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Ignore
    }
    for (const commentId of createdCommentIds) {
      try {
        await db.delete(comments).where(eq(comments.id, commentId));
      } catch {
        // Ignore
      }
    }
    for (const uid of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
      } catch {
        // Ignore
      }
    }
    if (propertyId) {
      await deleteLeaderboardFixtureData();
    }
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('GET /leaderboard', () => {
    it('should return rankings with default period (all)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('all');
      expect(Array.isArray(body.rankings)).toBe(true);
      expect(body.currentUserRank).toBeNull(); // Not authenticated
    });

    it('should include currentUserRank when authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // User may or may not be in top 50, but the field should be present
      expect(body).toHaveProperty('currentUserRank');
    });

    it('should accept period=week', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=week',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('week');
      expect(Array.isArray(body.rankings)).toBe(true);
    });

    it('should accept period=month', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=month',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('month');
      expect(Array.isArray(body.rankings)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.rankings.length).toBeLessThanOrEqual(5);
    });

    it('should include karmaRank in each ranking entry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.rankings.length > 0) {
        const entry = body.rankings[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('userId');
        expect(entry).toHaveProperty('displayName');
        expect(entry).toHaveProperty('handle');
        expect(entry).toHaveProperty('karma');
        expect(entry).toHaveProperty('karmaRank');
        expect(entry.karmaRank).toHaveProperty('title');
        expect(entry.karmaRank).toHaveProperty('level');
      }
    });

    it('should return featuredProperty with engagement data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // We seeded a comment and a like, so featuredProperty should not be null
      expect(body.featuredProperty).not.toBeNull();
      const fp = body.featuredProperty;
      expect(fp).toHaveProperty('id');
      expect(fp).toHaveProperty('address');
      expect(fp).toHaveProperty('city');
      expect(fp).toHaveProperty('postalCode');
      expect(fp).toHaveProperty('countryCode');
      expect(fp).toHaveProperty('geometry');
      expect(fp).toHaveProperty('imageryGeometry');
      expect(fp).toHaveProperty('officialValuation');
      expect(fp).toHaveProperty('officialValuationYear');
      expect(fp).toHaveProperty('thumbnailUrl');
      expect(fp).toHaveProperty('commentCount');
      expect(fp).toHaveProperty('likeCount');
      expect(fp).toHaveProperty('engagementScore');
      expect(fp.engagementScore).toBeGreaterThan(0);
      expect(fp.id).toBe(propertyId);
      expect(fp.officialValuation).toBe(612000);
      expect(fp.officialValuationYear).toBe(2024);
      expect(typeof fp.commentCount).toBe('number');
      expect(typeof fp.likeCount).toBe('number');
      expect(fp.geometry).toMatchObject({ type: 'Point' });
      expect(fp.imageryGeometry).toMatchObject({ type: 'Point' });
    });

    it('should return featuredProperty respecting period filter', async () => {
      // The seeded engagement is recent (just created), so week should find it
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=week',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.featuredProperty).not.toBeNull();
      expect(body.featuredProperty.engagementScore).toBeGreaterThan(0);
    });
  });
});

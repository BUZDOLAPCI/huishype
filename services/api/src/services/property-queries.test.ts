import { describe, expect, it } from '@jest/globals';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildPropertyListCountQuery, buildPropertyListRowsQuery } from '../routes/properties.js';
import { normalizeMapFilters } from './map-filters.js';
import {
  PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE,
  PROPERTY_ACTIVITY_FILTERED_IDS_CTE,
  PROPERTY_ACTIVITY_SOCIAL_FACTS_CTE,
  buildPropertyActivityFilterCtes,
} from './property-queries.js';

const dialect = new PgDialect();

function renderSql(query: SQL) {
  return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

const cityArea = {
  type: 'city' as const,
  countryCode: 'NL',
  value: 'eindhoven',
  label: 'Eindhoven',
  city: 'Eindhoven',
};

describe('property activity list queries', () => {
  it('builds count activity filtering from candidate-first set-based social CTEs', () => {
    const query = buildPropertyListCountQuery({
      radius: 1000,
      filters: normalizeMapFilters({
        activity: '30d',
        areas: [cityArea],
        marketState: ['for-sale'],
        salePriceFrom: 400000,
        salePriceTo: 450000,
      }),
    });
    const text = renderSql(query);

    expect(text).toContain(`${PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE} AS MATERIALIZED`);
    expect(text).toContain(`${PROPERTY_ACTIVITY_SOCIAL_FACTS_CTE} AS MATERIALIZED`);
    expect(text).toContain(`${PROPERTY_ACTIVITY_FILTERED_IDS_CTE} AS MATERIALIZED`);
    expect(text).toContain(`FROM ${PROPERTY_ACTIVITY_FILTERED_IDS_CTE}`);
    expect(text).toContain(
      `FROM comments c INNER JOIN ${PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE} pac ON pac.id = c.property_id`
    );
    expect(text).toContain(
      `FROM property_views pv INNER JOIN ${PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE} pac ON pac.id = pv.property_id`
    );
    expect(text).not.toContain('LEFT JOIN LATERAL ( WITH top_level_comments AS');
    expect(text).not.toContain('FROM comments c WHERE c.property_id = p.id');
    expect(text).not.toContain('property_tile_social_facts');
  });

  it('keeps page-id activity filtering set-based while final page enrichment stays lateral', () => {
    const query = buildPropertyListRowsQuery({
      limit: 3,
      offset: 0,
      radius: 1000,
      filters: normalizeMapFilters({
        activity: '10d',
        areas: [cityArea],
      }),
    });
    const text = renderSql(query);
    const finalSelectIndex = text.indexOf('SELECT p.id, p.national_id');

    expect(finalSelectIndex).toBeGreaterThan(0);
    const pageIdPathSql = text.slice(0, finalSelectIndex);
    const finalPageSql = text.slice(finalSelectIndex);

    expect(pageIdPathSql).toContain(`${PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE} AS MATERIALIZED`);
    expect(pageIdPathSql).toContain(`${PROPERTY_ACTIVITY_FILTERED_IDS_CTE} AS MATERIALIZED`);
    expect(pageIdPathSql).toContain(`FROM ${PROPERTY_ACTIVITY_FILTERED_IDS_CTE} ORDER BY id`);
    expect(pageIdPathSql).not.toContain('LEFT JOIN LATERAL ( WITH top_level_comments AS');
    expect(pageIdPathSql).not.toContain('FROM comments c WHERE c.property_id = p.id');
    expect(finalPageSql).toContain('LEFT JOIN LATERAL ( WITH top_level_comments AS');
  });

  it('preserves live social semantics in the set-based activity CTE shape', () => {
    const text = renderSql(sql`
      WITH ${sql.raw(PROPERTY_ACTIVITY_FILTER_CANDIDATE_CTE)} AS MATERIALIZED (
        SELECT id, comments_disabled_at
        FROM properties
      ),
      ${buildPropertyActivityFilterCtes('today')}
      SELECT id
      FROM ${sql.raw(PROPERTY_ACTIVITY_FILTERED_IDS_CTE)}
    `);

    expect(text).toContain('SELECT DISTINCT ON (pg.property_id, pg.user_id)');
    expect(text).toContain('ORDER BY pg.property_id, pg.user_id, GREATEST(pg.created_at, pg.updated_at) DESC, pg.created_at DESC, pg.id DESC');
    expect(text).toContain('WHERE pac.comments_disabled_at IS NULL AND c.parent_id IS NULL');
    expect(text).toContain('AND pac.comments_disabled_at IS NULL AND c.hidden_at IS NULL');
    expect(text).toContain('COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id))');
    expect(text).not.toContain('property_tile_social_facts');
  });
});

import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  buildPropertyMarketFilterQuery,
  createDefaultMapFilters,
  parseFollowingMapFiltersQuery,
} from './map-filters.js';

const dialect = new PgDialect();

function renderSql(query: SQL) {
  return dialect.sqlToQuery(query).sql;
}

describe('parseFollowingMapFiltersQuery', () => {
  it('defaults Following activity to all-time instead of the public all filter', () => {
    expect(parseFollowingMapFiltersQuery({}).activity).toBe('all-time');
  });

  it('treats legacy activity=all as all-time for Following safety', () => {
    expect(parseFollowingMapFiltersQuery({ activity: 'all' }).activity).toBe('all-time');
  });

  it('preserves explicit Following time-window filters', () => {
    expect(parseFollowingMapFiltersQuery({ activity: '10d' }).activity).toBe('10d');
  });
});

describe('buildPropertyMarketFilterQuery', () => {
  it('does not build listing facts for activity-only requests', () => {
    const query = buildPropertyMarketFilterQuery({
      ...createDefaultMapFilters(),
      activity: '10d',
    });

    expect(query.filters.activity).toBe('all');
    expect(renderSql(query.join).trim()).toBe('');
    expect(renderSql(query.predicate).toLowerCase()).toBe('true');
  });

  it('skips effective-price joins when only market-state filtering is requested', () => {
    const query = buildPropertyMarketFilterQuery({
      ...createDefaultMapFilters(),
      marketState: ['sold'],
    });
    const joinSql = renderSql(query.join);

    expect(joinSql).toContain('latest_listing');
    expect(joinSql).not.toContain('price_history ph');
    expect(joinSql).not.toContain('guess_facts');
  });

  it('includes effective-price joins when price filters are present', () => {
    const query = buildPropertyMarketFilterQuery({
      ...createDefaultMapFilters(),
      marketState: ['not-listed'],
      salePriceFrom: 400000,
    });
    const joinSql = renderSql(query.join);

    expect(joinSql).toContain('price_history ph');
    expect(joinSql).toContain('guess_facts');
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

type ExecuteMock = (query: SQL) => Promise<unknown>;
type TransactionMock = (
  run: (tx: { execute: ExecuteMock }) => Promise<unknown>
) => Promise<unknown>;

const executeMock = jest.fn<ExecuteMock>();
const txExecuteMock = jest.fn<ExecuteMock>();
const transactionMock = jest.fn<TransactionMock>();
const dialect = new PgDialect();

jest.unstable_mockModule('../db/index.js', () => ({
  db: {
    execute: executeMock,
    transaction: transactionMock,
  },
  closeConnection: async () => undefined,
}));

function renderExecutedSql(mock: jest.Mock<ExecuteMock>): string[] {
  return mock.mock.calls.map(([query]) =>
    dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
  );
}

function findExecutedSql(mock: jest.Mock<ExecuteMock>, pattern: string): string {
  const statement = renderExecutedSql(mock).find((sqlText) => sqlText.includes(pattern));
  expect(statement).toBeDefined();
  return statement ?? '';
}

describe('location search area city fallbacks', () => {
  beforeEach(() => {
    jest.resetModules();
    executeMock.mockReset();
    txExecuteMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (run) => run({ execute: txExecuteMock }));
  });

  it('keeps full-rebuild property city fallbacks unless an Overture city has the same normalized name', async () => {
    executeMock.mockResolvedValue([{ count: 0 }]);
    txExecuteMock.mockImplementation(async (query) => {
      const sqlText = dialect.sqlToQuery(query).sql;

      if (sqlText.includes('GROUP BY area_kind')) {
        return [{ area_kind: 'country', count: 1 }];
      }

      if (sqlText.includes('COUNT(*)::int AS count FROM location_search_areas')) {
        return [{ count: 1 }];
      }

      return undefined;
    });

    const { rebuildLocationSearchAreas } = await import('./location-search-areas.js');

    await rebuildLocationSearchAreas();

    const broadCityInsert = findExecutedSql(
      txExecuteMock,
      "'city:' || country_code || ':' || city_token AS area_key"
    );
    expect(broadCityInsert).toContain('FROM location_search_areas_rebuild existing');
    expect(broadCityInsert).toContain("existing.area_kind = 'city'");
    expect(broadCityInsert).toContain("existing.source = 'overture'");
    expect(broadCityInsert).toContain(
      'existing.country_code = active_properties.country_code'
    );
    expect(broadCityInsert).toContain('existing.match_value = active_properties.city_match');
    expect(broadCityInsert).not.toContain("membership.property_id = active_properties.id");
  });

  it('routes key-based refresh through scoped dependency targets', async () => {
    const { refreshLocationSearchAreasForPropertyKeys } = await import(
      './location-search-areas.js'
    );

    await refreshLocationSearchAreasForPropertyKeys([
      {
        countryCode: 'NL',
        city: 'Geldrop',
        region: 'Noord-Brabant',
        postalCode: '5661 AA',
        street: 'Bogardeind',
      },
    ]);

    const broadCityInsert = findExecutedSql(
      txExecuteMock,
      "'city:' || p.country_code || ':' || target.city_token"
    );
    expect(broadCityInsert).toContain('affected_location_search_area_targets');
    expect(broadCityInsert).toContain('FROM location_search_areas existing');
    expect(broadCityInsert).toContain("existing.area_kind = 'city'");
    expect(broadCityInsert).toContain("existing.source = 'overture'");
    expect(broadCityInsert).toContain('existing.country_code = p.country_code');
    expect(broadCityInsert).toContain('existing.match_value = target.city_match');
    expect(broadCityInsert).not.toContain("membership.area_kind = 'city'");

    const streetInsert = findExecutedSql(
      txExecuteMock,
      "'street:' || p.country_code || ':' || target.street_token"
    );
    expect(streetInsert).toContain('target.scope_key');
    expect(streetInsert).not.toContain("':region=' || region_token");
  });

  it('builds persisted Overture area subdivisions from imported division areas', async () => {
    const { buildOvertureDivisionAreaSubdivisionsRefreshSql } = await import(
      './location-search-areas.js'
    );

    const query = buildOvertureDivisionAreaSubdivisionsRefreshSql(['NL', 'BE']);

    expect(query).toContain('DELETE FROM overture_division_area_subdivisions');
    expect(query).toContain("country_code IN ('NL', 'BE')");
    expect(query).toContain('INSERT INTO overture_division_area_subdivisions');
    expect(query).toContain('ST_Subdivide(area.geometry, 256)');
    expect(query).toContain("WHEN 'locality' THEN 0");
    expect(query).toContain("WHEN 'localadmin' THEN 1");
    expect(query).toContain('ST_Area(area.geometry)');
    expect(query).toContain('ANALYZE overture_division_area_subdivisions');
  });

  it('uses subdivision-backed ranked membership selection for full rebuilds', async () => {
    executeMock.mockResolvedValue([{ count: 0 }]);
    txExecuteMock.mockImplementation(async (query) => {
      const sqlText = dialect.sqlToQuery(query).sql;

      if (sqlText.includes('GROUP BY area_kind')) {
        return [{ area_kind: 'country', count: 1 }];
      }

      if (sqlText.includes('COUNT(*)::int AS count FROM location_search_areas')) {
        return [{ count: 1 }];
      }

      return undefined;
    });

    const { rebuildLocationSearchAreas } = await import('./location-search-areas.js');

    await rebuildLocationSearchAreas({
      countries: ['BE'],
      rebuildOvertureMemberships: true,
    });

    const cityMembershipInsert = findExecutedSql(
      txExecuteMock,
      "subdivision.subtype IN ('locality', 'localadmin')"
    );
    expect(cityMembershipInsert).toContain('overture_division_area_subdivisions subdivision');
    expect(cityMembershipInsert).toContain("subdivision.country_code = p.country_code");
    expect(cityMembershipInsert).toContain('subdivision.geometry && p.geometry');
    expect(cityMembershipInsert).toContain('ST_Covers(subdivision.geometry, p.geometry)');
    expect(cityMembershipInsert).toContain('ORDER BY p.id, subdivision.selection_rank, subdivision.area_sort, subdivision.division_area_id');
    expect(cityMembershipInsert).toContain('ON CONFLICT (property_id, area_kind) DO UPDATE');
  });

  it('matches country memberships by country code without spatial predicates', async () => {
    executeMock.mockResolvedValue([{ count: 0 }]);
    txExecuteMock.mockImplementation(async (query) => {
      const sqlText = dialect.sqlToQuery(query).sql;

      if (sqlText.includes('GROUP BY area_kind')) {
        return [{ area_kind: 'country', count: 1 }];
      }

      if (sqlText.includes('COUNT(*)::int AS count FROM location_search_areas')) {
        return [{ count: 1 }];
      }

      return undefined;
    });

    const { rebuildLocationSearchAreas } = await import('./location-search-areas.js');

    await rebuildLocationSearchAreas({
      countries: ['NL'],
      rebuildOvertureMemberships: true,
    });

    const countryMembershipInsert = findExecutedSql(txExecuteMock, 'WITH country_area AS');
    expect(countryMembershipInsert).toContain('JOIN country_area ON country_area.country_code = p.country_code');
    expect(countryMembershipInsert).not.toContain('ST_Covers');
    expect(countryMembershipInsert).not.toContain('geometry && p.geometry');
  });

  it('uses the same ranked membership candidate path for targeted property refreshes', async () => {
    const { refreshLocationSearchAreasForPropertyIds } = await import(
      './location-search-areas.js'
    );

    await refreshLocationSearchAreasForPropertyIds([
      '00000000-0000-4000-8000-000000000001',
    ]);

    const cityMembershipInsert = findExecutedSql(
      txExecuteMock,
      "subdivision.subtype IN ('locality', 'localadmin')"
    );
    expect(cityMembershipInsert).toContain('affected_property_ids affected');
    expect(cityMembershipInsert).toContain('overture_division_area_subdivisions subdivision');
    expect(cityMembershipInsert).toContain('ON CONFLICT (property_id, area_kind) DO UPDATE');

    const finalMembershipInsert = findExecutedSql(
      txExecuteMock,
      'FROM affected_property_location_division_memberships'
    );
    expect(finalMembershipInsert).toContain('INSERT INTO property_location_division_memberships');
  });
});

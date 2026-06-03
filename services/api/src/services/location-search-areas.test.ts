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
});

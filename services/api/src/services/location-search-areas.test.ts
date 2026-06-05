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

function mockSuccessfulRebuildCounts(): void {
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
}

describe('location search areas', () => {
  beforeEach(() => {
    jest.resetModules();
    executeMock.mockReset();
    txExecuteMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (run) => run({ execute: txExecuteMock }));
  });

  it('rebuilds property-derived city, postcode, postcode-prefix, street, region, and country areas', async () => {
    mockSuccessfulRebuildCounts();
    const { rebuildLocationSearchAreas } = await import('./location-search-areas.js');

    await rebuildLocationSearchAreas();

    const executedSql = renderExecutedSql(txExecuteMock).join('\n');
    expect(executedSql).toContain("'country:' || country_code AS area_key");
    expect(executedSql).toContain("'city:' || country_code || ':' || city_token AS area_key");
    expect(executedSql).toContain("'region:' || country_code || ':' || region_token AS area_key");
    expect(executedSql).toContain("'postcode:' || country_code || ':' || postcode_match AS area_key");
    expect(executedSql).toContain("'postcode-prefix:' || country_code || ':' || LEFT(postcode_match, 4) AS area_key");
    expect(executedSql).toContain("'street:' || country_code || ':' || street_token || ':city=' || city_token AS area_key");
    expect(executedSql).not.toContain('property_location_division_memberships');
    expect(executedSql).not.toContain('overture_division');
    expect(executedSql).not.toContain('source =');
  });

  it('routes key-based refresh through property-derived affected keys', async () => {
    const { refreshLocationSearchAreasForPropertyKeys } = await import(
      './location-search-areas.js'
    );

    await refreshLocationSearchAreasForPropertyKeys([
      {
        countryCode: 'nl',
        city: 'Geldrop',
        region: 'Noord-Brabant',
        postalCode: '5661 AA',
        street: 'Bogardeind',
      },
    ]);

    const cityInsert = findExecutedSql(
      txExecuteMock,
      "'city:' || p.country_code || ':' || target.city_token"
    );
    expect(cityInsert).toContain('affected_location_search_area_keys');
    expect(cityInsert).not.toContain('source');
    expect(renderExecutedSql(txExecuteMock).join('\n')).not.toContain(
      'property_location_division_memberships'
    );
  });
});

/**
 * Unit tests for Overture Maps address import pipeline.
 *
 * Tests the pure-logic functions (STAC discovery, query building,
 * house number parsing, country filtering) without touching DuckDB or DB.
 */
import {
  discoverLatestRelease,
  buildParquetSource,
  buildCountryFilter,
  buildDuckDbQuery,
  buildOvertureUpsertQuery,
  parseHouseNumber,
} from '../../scripts/import-overture-addresses.js';

function mockFetchResolve(value: Partial<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = (() => Promise.resolve(value)) as any;
}

function mockFetchReject(err: Error): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = (() => Promise.reject(err)) as any;
}

// ---------------------------------------------------------------------------
// STAC catalog discovery
// ---------------------------------------------------------------------------

describe('discoverLatestRelease', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return a valid release string from STAC catalog', async () => {
    mockFetchResolve({
      ok: true,
      json: async () => ({
        links: [
          { rel: 'child', href: '/2026-01-22.0', title: '2026-01-22.0' },
          { rel: 'child', href: '/2026-02-18.0', title: '2026-02-18.0' },
          { rel: 'child', href: '/2025-12-01.0', title: '2025-12-01.0' },
          { rel: 'self', href: '/' },
        ],
      }),
    });

    const release = await discoverLatestRelease();
    expect(release).toBe('2026-02-18.0');
  });

  it('should return fallback when STAC returns non-OK status', async () => {
    mockFetchResolve({ ok: false, status: 503 });

    const release = await discoverLatestRelease();
    expect(release).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('should return fallback when fetch throws', async () => {
    mockFetchReject(new Error('Network error'));

    const release = await discoverLatestRelease();
    expect(release).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('should return fallback when no child links exist', async () => {
    mockFetchResolve({
      ok: true,
      json: async () => ({
        links: [{ rel: 'self', href: '/' }],
      }),
    });

    const release = await discoverLatestRelease();
    expect(release).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('should pick the latest release when multiple exist', async () => {
    mockFetchResolve({
      ok: true,
      json: async () => ({
        links: [
          { rel: 'child', href: '/2024-06-01.0', title: '2024-06-01.0' },
          { rel: 'child', href: '/2025-01-15.0', title: '2025-01-15.0' },
          { rel: 'child', href: '/2024-12-31.0', title: '2024-12-31.0' },
        ],
      }),
    });

    const release = await discoverLatestRelease();
    expect(release).toBe('2025-01-15.0');
  });
});

// ---------------------------------------------------------------------------
// Parquet source URL construction
// ---------------------------------------------------------------------------

describe('buildParquetSource', () => {
  it('should build S3 URL for remote source', () => {
    const source = buildParquetSource('2026-02-18.0');
    expect(source).toContain('s3://overturemaps-us-west-2/release/2026-02-18.0/');
    expect(source).toContain('theme=addresses/type=address/*');
  });

  it('should use local path when provided', () => {
    const source = buildParquetSource('2026-02-18.0', '/data/addresses.parquet');
    expect(source).toBe("'/data/addresses.parquet'");
    expect(source).not.toContain('s3://');
  });
});

// ---------------------------------------------------------------------------
// Country filter construction
// ---------------------------------------------------------------------------

describe('buildCountryFilter', () => {
  it('should create SQL IN clause for single country', () => {
    const filter = buildCountryFilter(['NL']);
    expect(filter).toBe("country IN ('NL')");
  });

  it('should create SQL IN clause for multiple countries', () => {
    const filter = buildCountryFilter(['NL', 'DE', 'BE']);
    expect(filter).toBe("country IN ('NL', 'DE', 'BE')");
  });

  it('should handle all supported countries', () => {
    const filter = buildCountryFilter(['NL', 'DE', 'BE', 'FR', 'GB']);
    expect(filter).toContain("'NL'");
    expect(filter).toContain("'GB'");
  });
});

// ---------------------------------------------------------------------------
// DuckDB query construction
// ---------------------------------------------------------------------------

describe('buildDuckDbQuery', () => {
  it('should include spatial and httpfs extensions', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain('INSTALL spatial');
    expect(query).toContain('LOAD spatial');
    expect(query).toContain('INSTALL httpfs');
    expect(query).toContain('LOAD httpfs');
  });

  it('should set S3 region', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain("SET s3_region = 'us-west-2'");
  });

  it('should include bbox filtering for Europe', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain('bbox.xmin BETWEEN');
    expect(query).toContain('bbox.ymin BETWEEN');
  });

  it('should include country filter', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL', 'DE']);
    expect(query).toContain("country IN ('NL', 'DE')");
  });

  it('should select expected Overture columns', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain('id');
    expect(query).toContain('country');
    expect(query).toContain('street');
    expect(query).toContain('number AS house_number');
    expect(query).toContain('unit');
    expect(query).toContain('postcode');
    expect(query).toContain('postal_city');
    expect(query).toContain('address_levels');
    expect(query).toContain('longitude');
    expect(query).toContain('latitude');
  });

  it('should filter out null street and number', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain('street IS NOT NULL');
    expect(query).toContain('number IS NOT NULL');
  });

  it('should output to CSV', () => {
    const query = buildDuckDbQuery("'s3://bucket/path/*'", ['NL']);
    expect(query).toContain("TO '/tmp/overture_addresses.csv'");
    expect(query).toContain('HEADER');
  });
});

// ---------------------------------------------------------------------------
// Upsert query construction
// ---------------------------------------------------------------------------

describe('buildOvertureUpsertQuery', () => {
  it('preserves BAG-backed NL geometry instead of overwriting it with Overture points', () => {
    const query = buildOvertureUpsertQuery();

    expect(query).toContain("properties.country_code = 'NL'");
    expect(query).toContain("properties.national_id ~ '^[0-9]{16}$'");
    expect(query).toContain('national_id = CASE');
    expect(query).toContain('THEN properties.national_id');
    expect(query).toContain('geometry = CASE');
    expect(query).toContain('THEN properties.geometry');
    expect(query).toContain('ELSE EXCLUDED.geometry');
  });
});

// ---------------------------------------------------------------------------
// House number parsing
// ---------------------------------------------------------------------------

describe('parseHouseNumber', () => {
  it('should parse plain integer', () => {
    expect(parseHouseNumber('42')).toEqual({ num: 42, addition: '' });
  });

  it('should parse number with letter suffix', () => {
    expect(parseHouseNumber('12a')).toEqual({ num: 12, addition: 'A' });
  });

  it('should parse number with dash suffix', () => {
    expect(parseHouseNumber('12-14')).toEqual({ num: 12, addition: '-14' });
  });

  it('should parse number with space and word', () => {
    expect(parseHouseNumber('3 bis')).toEqual({ num: 3, addition: 'BIS' });
  });

  it('should parse number with leading/trailing whitespace', () => {
    expect(parseHouseNumber('  15b  ')).toEqual({ num: 15, addition: 'B' });
  });

  it('should return null for non-numeric string', () => {
    expect(parseHouseNumber('abc')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseHouseNumber('')).toBeNull();
  });

  it('should return null for zero', () => {
    expect(parseHouseNumber('0')).toBeNull();
  });

  it('should return null for negative numbers', () => {
    expect(parseHouseNumber('-5')).toBeNull();
  });

  it('should handle large house numbers', () => {
    expect(parseHouseNumber('1234')).toEqual({ num: 1234, addition: '' });
  });

  it('should handle complex additions', () => {
    expect(parseHouseNumber('10 III')).toEqual({ num: 10, addition: 'III' });
  });
});

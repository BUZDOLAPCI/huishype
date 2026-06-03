import {
  buildDivisionCountryFilter,
  buildDivisionParquetSource,
  buildDivisionsDuckDbQuery,
  buildOvertureDivisionsUpsertQuery,
} from '../../scripts/import-overture-divisions.js';

describe('buildDivisionParquetSource', () => {
  it('builds the remote division path', () => {
    const source = buildDivisionParquetSource('2026-02-18.0', 'division');

    expect(source).toContain('s3://overturemaps-us-west-2/release/2026-02-18.0/');
    expect(source).toContain('theme=divisions/type=division/*');
  });

  it('builds the remote division area path', () => {
    const source = buildDivisionParquetSource('2026-02-18.0', 'division_area');

    expect(source).toContain('theme=divisions/type=division_area/*');
  });

  it('uses an explicit local parquet glob when provided', () => {
    const source = buildDivisionParquetSource(
      '2026-02-18.0',
      'division_area',
      '/data/division_area/*.parquet'
    );

    expect(source).toBe("'/data/division_area/*.parquet'");
  });
});

describe('buildDivisionCountryFilter', () => {
  it('creates an Overture country IN clause', () => {
    expect(buildDivisionCountryFilter(['NL', 'DE', 'BE'])).toBe(
      "country IN ('NL', 'DE', 'BE')"
    );
  });
});

describe('buildDivisionsDuckDbQuery', () => {
  it('loads DuckDB spatial and httpfs extensions', () => {
    const query = buildDivisionsDuckDbQuery("'division-source'", "'area-source'", ['NL']);

    expect(query).toContain('INSTALL spatial');
    expect(query).toContain('LOAD spatial');
    expect(query).toContain('INSTALL httpfs');
    expect(query).toContain('LOAD httpfs');
  });

  it('queries both division and division_area parquet sources', () => {
    const query = buildDivisionsDuckDbQuery("'division-source'", "'area-source'", ['NL']);

    expect(query).toContain("FROM read_parquet('division-source', hive_partitioning=1)");
    expect(query).toContain("FROM read_parquet('area-source', hive_partitioning=1)");
    expect(query).toContain("TO '/tmp/overture_divisions.csv'");
    expect(query).toContain("TO '/tmp/overture_division_areas.csv'");
  });

  it('filters supported countries, admin subtypes, and Europe bbox overlap', () => {
    const query = buildDivisionsDuckDbQuery("'division-source'", "'area-source'", [
      'NL',
      'DE',
    ]);

    expect(query).toContain("country IN ('NL', 'DE')");
    expect(query).toContain(
      "subtype IN ('country', 'region', 'locality', 'localadmin')"
    );
    expect(query).toContain('bbox.xmax >= -25');
    expect(query).toContain('bbox.xmin <= 45');
    expect(query).toContain('bbox.ymax >= 34');
    expect(query).toContain('bbox.ymin <= 72');
  });

  it('requires land-clipped division areas and emits WKB hex geometry', () => {
    const query = buildDivisionsDuckDbQuery("'division-source'", "'area-source'", ['NL']);

    expect(query).toContain('is_land = true');
    expect(query).toContain('hex(ST_AsWKB(geometry)) AS geometry_wkb');
    expect(query).toContain('division_id IS NOT NULL');
  });

  it('selects names and hierarchy columns needed by PostGIS import', () => {
    const query = buildDivisionsDuckDbQuery("'division-source'", "'area-source'", ['NL']);

    expect(query).toContain('names.primary AS name');
    expect(query).toContain('parent_division_id');
    expect(query).toContain('admin_level');
    expect(query).toContain('bbox.xmin AS min_lon');
    expect(query).toContain('bbox.xmax AS max_lon');
  });
});

describe('buildOvertureDivisionsUpsertQuery', () => {
  it('upserts divisions before areas and decodes WKB hex into PostGIS geometry', () => {
    const query = buildOvertureDivisionsUpsertQuery();

    expect(query).toContain('INSERT INTO overture_divisions');
    expect(query).toContain('INSERT INTO overture_division_areas');
    expect(query).toContain("ST_GeomFromWKB(decode(geometry_wkb, 'hex'))");
    expect(query).toContain('JOIN overture_divisions division ON division.id = area.division_id');
    expect(query).toContain('ON CONFLICT (id) DO UPDATE SET');
  });
});

import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  buildLocationAreaFilterPredicate,
  buildPropertyMarketFilterQuery,
  createDefaultMapFilters,
  parseFollowingMapFiltersQuery,
  parseLocationFilterToken,
  parseMapFiltersQuery,
} from './map-filters.js';

const dialect = new PgDialect();

function renderSql(query: SQL) {
  return dialect.sqlToQuery(query).sql;
}

function renderQuery(query: SQL) {
  return dialect.sqlToQuery(query);
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

describe('selected area filters', () => {
  it('dedupes compact, spaced, and dashed postcode area tokens', () => {
    const filters = parseMapFiltersQuery({
      area: ['postcode:NL:5651HA', 'postcode:NL:5651 HA', 'postcode:NL:5651-ha'],
    });

    expect(filters.areas).toHaveLength(1);
    expect(filters.areas[0]).toEqual(
      expect.objectContaining({
        type: 'postcode',
        countryCode: 'NL',
        value: '5651ha',
      })
    );
  });

  it('parses repeated area params without treating them as market filters', () => {
    const filters = parseMapFiltersQuery({
      area: ['city:NL:eindhoven', 'city:NL:waalre'],
    });
    const marketQuery = buildPropertyMarketFilterQuery(filters);

    expect(filters.areas).toEqual([
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'eindhoven' }),
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'waalre' }),
    ]);
    expect(renderSql(marketQuery.join).trim()).toBe('');
    expect(renderSql(marketQuery.predicate).toLowerCase()).toBe('true');
  });

  it('keeps Waalre and Aalst as separate exact city token branches', () => {
    const query = renderQuery(
      buildLocationAreaFilterPredicate([
        { type: 'city', countryCode: 'NL', value: 'waalre', label: 'Waalre' },
        { type: 'city', countryCode: 'NL', value: 'aalst', label: 'Aalst' },
      ])
    );

    expect(query.sql).toContain(' OR ');
    expect(query.sql.match(/p\.city/g)).toHaveLength(2);
    expect(query.params).toEqual(['NL', 'waalre', 'NL', 'aalst']);
  });

  it('keeps regionless city predicates broad across backing region variants', () => {
    const token = parseLocationFilterToken('city:NL:eindhoven');
    const query = renderQuery(buildLocationAreaFilterPredicate(token ? [token] : []));

    expect(query.sql).toContain('p.country_code');
    expect(query.sql).toContain('LOWER(p.city)');
    expect(query.sql).not.toContain('p.region');
    expect(query.params).toEqual(['NL', 'eindhoven']);
  });

  it('parses Overture division metadata from readable area tokens', () => {
    expect(
      parseLocationFilterToken(
        'city:NL:eindhoven:division=D724E74F-017A-4902-9031-BC784FFC1789:source=Overture'
      )
    ).toEqual(
      expect.objectContaining({
        type: 'city',
        countryCode: 'NL',
        value: 'eindhoven',
        divisionId: 'd724e74f-017a-4902-9031-bc784ffc1789',
        source: 'overture',
      })
    );
  });

  it('uses Overture division memberships for city, region, and country area tokens', () => {
    const divisionId = 'd724e74f-017a-4902-9031-bc784ffc1789';
    const cityToken = parseLocationFilterToken(
      `city:NL:eindhoven:division=${divisionId}:source=overture`
    );
    const regionToken = parseLocationFilterToken(`region:BE:vlaanderen:division=${divisionId}`);
    const countryToken = parseLocationFilterToken(`country:DE:deutschland:division=${divisionId}`);

    const query = renderQuery(
      buildLocationAreaFilterPredicate(
        [cityToken, regionToken, countryToken].filter(
          (token): token is NonNullable<typeof token> => token != null
        ),
        'property'
      )
    );

    expect(query.sql).toContain('FROM property_location_division_memberships pldm');
    expect(query.sql).toContain('pldm.property_id = property.id');
    expect(query.sql).toContain('pldm.area_kind =');
    expect(query.sql).toContain('pldm.division_id =');
    expect(query.sql).toContain('pldm.country_code =');
    expect(query.sql).not.toContain('LOWER(property.city)');
    expect(query.sql).not.toContain('LOWER(property.region)');
    expect(query.params).toEqual([
      'city',
      divisionId,
      'NL',
      'region',
      divisionId,
      'BE',
      'country',
      divisionId,
      'DE',
    ]);
  });

  it('keeps legacy text behavior for area tokens without division metadata', () => {
    const token = parseLocationFilterToken('region:NL:noord-brabant');
    const query = renderQuery(buildLocationAreaFilterPredicate(token ? [token] : []));

    expect(query.sql).not.toContain('property_location_division_memberships');
    expect(query.sql).toContain('LOWER(p.region)');
    expect(query.params).toEqual(['NL', 'noord brabant', 'noord-brabant']);
  });

  it('only narrows city predicates by region when the city token explicitly has region metadata', () => {
    const token = parseLocationFilterToken('city:NL:eindhoven:region=noord-brabant');
    const query = renderQuery(buildLocationAreaFilterPredicate(token ? [token] : []));

    expect(query.sql).toContain('LOWER(p.city)');
    expect(query.sql).toContain('LOWER(p.region)');
    expect(query.params).toEqual(['NL', 'eindhoven', 'noord brabant', 'noord-brabant']);
  });

  it('uses index-friendly selected street predicates for generated location area tokens', () => {
    const token = parseLocationFilterToken(
      'street:NL:zwaanstraat:city=eindhoven:region=eindhoven'
    );
    const query = renderQuery(buildLocationAreaFilterPredicate(token ? [token] : []));

    expect(query.sql).toContain('p.country_code =');
    expect(query.sql).toContain('LOWER(p.street)');
    expect(query.sql).toContain('LOWER(p.city)');
    expect(query.sql).toContain('LOWER(p.region)');
    expect(query.sql).not.toContain('UPPER(p.country_code)');
    expect(query.sql).not.toContain('BTRIM(LOWER(REGEXP_REPLACE');
    expect(query.sql).not.toContain('COALESCE(p.street');
    expect(query.sql).not.toContain('COALESCE(p.city');
    expect(query.sql).not.toContain('COALESCE(p.region');
    expect(query.params).toEqual(['NL', 'zwaanstraat', 'eindhoven', 'eindhoven']);
  });

  it('keeps dashed street tokens matched through LOWER expressions', () => {
    const token = parseLocationFilterToken('street:NL:strijp-s:city=eindhoven');
    const query = renderQuery(buildLocationAreaFilterPredicate(token ? [token] : []));

    expect(query.sql).toContain('LOWER(p.street)');
    expect(query.sql).toContain(' OR ');
    expect(query.sql).not.toContain('BTRIM(LOWER(REGEXP_REPLACE');
    expect(query.params).toEqual(['NL', 'strijp s', 'strijp-s', 'eindhoven']);
  });

  it('parses readable street metadata so reload predicates keep city context', () => {
    const token = parseLocationFilterToken('street:NL:boschdijk:city=eindhoven');
    expect(token).toEqual(
      expect.objectContaining({
        type: 'street',
        countryCode: 'NL',
        value: 'boschdijk',
        city: 'Eindhoven',
      })
    );

    const sqlText = renderSql(buildLocationAreaFilterPredicate(token ? [token] : []));
    expect(sqlText).toContain('p.street');
    expect(sqlText).toContain('p.city');
    expect(sqlText).toContain(' AND ');
  });

  it('builds OR area predicates with AND field constraints inside each token', () => {
    const sqlText = renderSql(
      buildLocationAreaFilterPredicate([
        { type: 'city', countryCode: 'NL', value: 'eindhoven', label: 'Eindhoven' },
        { type: 'street', countryCode: 'NL', value: 'bloklaan', label: 'Bloklaan', city: 'Eindhoven' },
      ])
    );

    expect(sqlText).toContain('p.country_code');
    expect(sqlText).toContain('p.city');
    expect(sqlText).toContain('p.street');
    expect(sqlText).toContain(' OR ');
    expect(sqlText).toContain(' AND ');
  });

  it('uses street metadata constraints for city and region without narrowing by postcode', () => {
    const query = renderQuery(
      buildLocationAreaFilterPredicate([
        {
          type: 'street',
          countryCode: 'NL',
          value: 'markt',
          label: 'Markt',
          city: 'Aalst',
          region: 'Noord-Brabant',
          postalCode: '5651 HA',
        },
      ])
    );

    expect(query.sql).toContain('p.country_code');
    expect(query.sql).toContain('p.street');
    expect(query.sql).toContain('p.city');
    expect(query.sql).toContain('p.region');
    expect(query.sql).toContain(' AND ');
    expect(query.sql).not.toContain('p.postal_code');
    expect(query.params).toEqual(['NL', 'markt', 'aalst', 'noord-brabant']);
  });

  it('keeps postcode token metadata exact without broadening to a whole postcode area', () => {
    const query = renderQuery(
      buildLocationAreaFilterPredicate([
        {
          type: 'postcode',
          countryCode: 'NL',
          value: '5651 HA',
          label: '5651 HA',
          city: 'Aalst',
          region: 'Noord-Brabant',
          street: 'Markt',
        },
      ])
    );

    expect(query.sql).toContain('p.country_code');
    expect(query.sql).toContain('p.postal_code');
    expect(query.sql).toContain('p.city');
    expect(query.sql).toContain('p.region');
    expect(query.sql).toContain('p.street');
    expect(query.sql).toContain("REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g')");
    expect(query.sql).not.toContain('p.postal_code) <');
    expect(query.sql).not.toContain('COALESCE(p.postal_code');
    expect(query.sql).toContain(' AND ');
    expect(query.params).toEqual(['NL', '5651HA', 'aalst', 'noord-brabant', 'markt']);
  });

  it('supports four-digit NL postcode area tokens with an index-friendly prefix range', () => {
    const query = renderQuery(
      buildLocationAreaFilterPredicate([
        {
          type: 'postcode',
          countryCode: 'NL',
          value: '5617',
          label: 'Strijp-S',
          postalCode: '5617',
          city: 'Eindhoven',
        },
      ])
    );

    expect(query.sql).toContain('p.country_code');
    expect(query.sql).toContain('p.postal_code');
    expect(query.sql).toContain("REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g') >=");
    expect(query.sql).toContain("REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g') <");
    expect(query.sql).toContain('>=');
    expect(query.sql).toContain('<');
    expect(query.sql).not.toContain('COALESCE(p.postal_code');
    expect(query.params).toEqual(['NL', '5617', '5618', 'eindhoven']);
  });
});

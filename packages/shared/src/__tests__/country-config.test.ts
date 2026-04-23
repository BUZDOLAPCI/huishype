import { describe, it, expect } from 'vitest';
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getAllCountryCodes,
  getAllListingDomains,
  getCountryForDomain,
  getCountryDefaultGuessStart,
  getPriceGuessPostalScope,
  isValidCountryCode,
  type CountryCode,
  type AddressParts,
} from '../config/country-config';

// ---------------------------------------------------------------------------
// Registry completeness
// ---------------------------------------------------------------------------

describe('COUNTRY_CONFIGS', () => {
  const expectedCodes: CountryCode[] = [
    'NL', 'DE', 'BE', 'FR', 'GB', 'AT', 'CH', 'LU', 'DK', 'SE',
    'NO', 'FI', 'PL', 'CZ', 'SK', 'IT', 'ES', 'PT', 'IE',
  ];

  it('contains all 19 expected countries', () => {
    expect(Object.keys(COUNTRY_CONFIGS).sort()).toEqual([...expectedCodes].sort());
  });

  it('every config has matching code property', () => {
    for (const [key, cfg] of Object.entries(COUNTRY_CONFIGS)) {
      expect(cfg.code).toBe(key);
    }
  });

  it('every config has a non-empty name', () => {
    for (const cfg of Object.values(COUNTRY_CONFIGS)) {
      expect(cfg.name.length).toBeGreaterThan(0);
    }
  });

  it('every config has valid defaultCenter [lng, lat]', () => {
    for (const cfg of Object.values(COUNTRY_CONFIGS)) {
      const [lng, lat] = cfg.defaultCenter;
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });

  it('every config has at least one listing domain', () => {
    for (const cfg of Object.values(COUNTRY_CONFIGS)) {
      expect(cfg.listingDomains.length).toBeGreaterThan(0);
    }
  });

  it('every config has a positive projectionSrid', () => {
    for (const cfg of Object.values(COUNTRY_CONFIGS)) {
      expect(cfg.projectionSrid).toBeGreaterThan(0);
    }
  });

  it('every config has a pbfUrl pointing to geofabrik', () => {
    for (const cfg of Object.values(COUNTRY_CONFIGS)) {
      expect(cfg.pbfUrl).toContain('download.geofabrik.de');
    }
  });
});

// ---------------------------------------------------------------------------
// NL config — values must match current codebase
// ---------------------------------------------------------------------------

describe('NL config', () => {
  const nl = COUNTRY_CONFIGS.NL;

  it('has locale nl-NL', () => {
    expect(nl.locale).toBe('nl-NL');
  });

  it('has currency EUR', () => {
    expect(nl.currency).toBe('EUR');
  });

  it('has defaultCenter [5.4697, 51.4416]', () => {
    expect(nl.defaultCenter).toEqual([5.4697, 51.4416]);
  });

  it('has defaultZoom 13', () => {
    expect(nl.defaultZoom).toBe(13);
  });

  it('has projectionSrid 28992 (RD New)', () => {
    expect(nl.projectionSrid).toBe(28992);
  });

  it('has listing domains funda.nl, pararius.nl, pararius.com', () => {
    expect(nl.listingDomains).toEqual(['funda.nl', 'pararius.nl', 'pararius.com']);
  });

  it('has correct pbfUrl', () => {
    expect(nl.pbfUrl).toBe(
      'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf',
    );
  });
});

// ---------------------------------------------------------------------------
// Postal-code regex tests
// ---------------------------------------------------------------------------

describe('postalCodeRegex', () => {
  const cases: { code: CountryCode; valid: string[]; invalid: string[] }[] = [
    { code: 'NL', valid: ['1234AB', '1234 AB', '5600AA'], invalid: ['123AB', '12345', '1234 ab'] },
    { code: 'DE', valid: ['10115', '80331'], invalid: ['1011', '101150', 'ABCDE'] },
    { code: 'BE', valid: ['1000', '9999'], invalid: ['100', '10000'] },
    { code: 'FR', valid: ['75001', '13001'], invalid: ['7500', '750010'] },
    { code: 'GB', valid: ['SW1A 1AA', 'EC1A1BB', 'W1A 0AX', 'M1 1AE', 'B33 8TH'], invalid: ['12345', 'ABCDEF'] },
    { code: 'AT', valid: ['1010', '5020'], invalid: ['101', '10100'] },
    { code: 'CH', valid: ['8001', '3000'], invalid: ['800', '80010'] },
    { code: 'LU', valid: ['1234', '2345'], invalid: ['123', '12345'] },
    { code: 'DK', valid: ['1000', '2100'], invalid: ['100', '10000'] },
    { code: 'SE', valid: ['11120', '111 20'], invalid: ['1112', '111200'] },
    { code: 'NO', valid: ['0150', '5003'], invalid: ['015', '50030'] },
    { code: 'FI', valid: ['00100', '33100'], invalid: ['0010', '001000'] },
    { code: 'PL', valid: ['00-001', '00001'], invalid: ['0001', '000010'] },
    { code: 'CZ', valid: ['11000', '110 00'], invalid: ['1100', '110000'] },
    { code: 'SK', valid: ['81101', '811 01'], invalid: ['8110', '811010'] },
    { code: 'IT', valid: ['00100', '20100'], invalid: ['0010', '001000'] },
    { code: 'ES', valid: ['28001', '08001'], invalid: ['2800', '280010'] },
    { code: 'PT', valid: ['1000', '1000-001'], invalid: ['100', '1000-00'] },
    { code: 'IE', valid: ['D02AF30', 'D02 AF30', 'A65F4E2'], invalid: ['D02', '12345678'] },
  ];

  for (const { code, valid, invalid } of cases) {
    describe(code, () => {
      const cfg = COUNTRY_CONFIGS[code];
      for (const v of valid) {
        it(`accepts "${v}"`, () => {
          expect(cfg.postalCodeRegex.test(v)).toBe(true);
        });
      }
      for (const inv of invalid) {
        it(`rejects "${inv}"`, () => {
          expect(cfg.postalCodeRegex.test(inv)).toBe(false);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Postal-code normalizers
// ---------------------------------------------------------------------------

describe('postalCodeNormalize', () => {
  it('NL: "1234AB" → "1234 AB"', () => {
    expect(COUNTRY_CONFIGS.NL.postalCodeNormalize('1234AB')).toBe('1234 AB');
  });

  it('NL: "1234 ab" → "1234 AB"', () => {
    expect(COUNTRY_CONFIGS.NL.postalCodeNormalize('1234 ab')).toBe('1234 AB');
  });

  it('GB: "SW1A1AA" → "SW1A 1AA"', () => {
    expect(COUNTRY_CONFIGS.GB.postalCodeNormalize('SW1A1AA')).toBe('SW1A 1AA');
  });

  it('SE: "11120" → "111 20"', () => {
    expect(COUNTRY_CONFIGS.SE.postalCodeNormalize('11120')).toBe('111 20');
  });

  it('PL: "00001" → "00-001"', () => {
    expect(COUNTRY_CONFIGS.PL.postalCodeNormalize('00001')).toBe('00-001');
  });

  it('CZ: "11000" → "110 00"', () => {
    expect(COUNTRY_CONFIGS.CZ.postalCodeNormalize('11000')).toBe('110 00');
  });

  it('PT: "1000001" → "1000-001"', () => {
    expect(COUNTRY_CONFIGS.PT.postalCodeNormalize('1000001')).toBe('1000-001');
  });

  it('IE: "D02AF30" → "D02 AF30"', () => {
    expect(COUNTRY_CONFIGS.IE.postalCodeNormalize('D02AF30')).toBe('D02 AF30');
  });
});

// ---------------------------------------------------------------------------
// Address formatters
// ---------------------------------------------------------------------------

describe('addressFormatter', () => {
  const nlParts: AddressParts = {
    street: 'Kalverstraat',
    houseNumber: '1',
    houseNumberAddition: 'A',
    postalCode: '1012 NX',
    city: 'Amsterdam',
    countryCode: 'NL',
  };

  it('NL: "Street Number[Addition], PostalCode City"', () => {
    expect(COUNTRY_CONFIGS.NL.addressFormatter(nlParts)).toBe(
      'Kalverstraat 1A, 1012 NX Amsterdam',
    );
  });

  it('NL without addition', () => {
    const parts = { ...nlParts, houseNumberAddition: undefined };
    expect(COUNTRY_CONFIGS.NL.addressFormatter(parts)).toBe(
      'Kalverstraat 1, 1012 NX Amsterdam',
    );
  });

  it('GB: "Number[Addition] Street, City, PostalCode"', () => {
    const parts: AddressParts = {
      street: 'Downing Street',
      houseNumber: '10',
      postalCode: 'SW1A 2AA',
      city: 'London',
      countryCode: 'GB',
    };
    expect(COUNTRY_CONFIGS.GB.addressFormatter(parts)).toBe(
      '10 Downing Street, London, SW1A 2AA',
    );
  });

  it('FR: "Number Street, PostalCode City"', () => {
    const parts: AddressParts = {
      street: 'Rue de Rivoli',
      houseNumber: '55',
      postalCode: '75001',
      city: 'Paris',
      countryCode: 'FR',
    };
    expect(COUNTRY_CONFIGS.FR.addressFormatter(parts)).toBe(
      '55 Rue de Rivoli, 75001 Paris',
    );
  });

  it('IT: "Street, Number, PostalCode City"', () => {
    const parts: AddressParts = {
      street: 'Via del Corso',
      houseNumber: '10',
      postalCode: '00186',
      city: 'Roma',
      countryCode: 'IT',
    };
    expect(COUNTRY_CONFIGS.IT.addressFormatter(parts)).toBe(
      'Via del Corso, 10, 00186 Roma',
    );
  });

  it('DE: "Street Number, PostalCode City"', () => {
    const parts: AddressParts = {
      street: 'Friedrichstraße',
      houseNumber: '43',
      postalCode: '10117',
      city: 'Berlin',
      countryCode: 'DE',
    };
    expect(COUNTRY_CONFIGS.DE.addressFormatter(parts)).toBe(
      'Friedrichstraße 43, 10117 Berlin',
    );
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('getCountryConfig', () => {
  it('returns NL config', () => {
    expect(getCountryConfig('NL').name).toBe('Netherlands');
  });

  it('throws for unknown code', () => {
    expect(() => getCountryConfig('XX' as CountryCode)).toThrow('Unknown country code');
  });
});

describe('getAllCountryCodes', () => {
  it('returns 19 codes', () => {
    expect(getAllCountryCodes()).toHaveLength(19);
  });

  it('includes NL, DE, GB', () => {
    const codes = getAllCountryCodes();
    expect(codes).toContain('NL');
    expect(codes).toContain('DE');
    expect(codes).toContain('GB');
  });
});

describe('getAllListingDomains', () => {
  it('returns a flat array with no duplicates', () => {
    const domains = getAllListingDomains();
    expect(domains.length).toBe(new Set(domains).size);
  });

  it('includes domains from multiple countries', () => {
    const domains = getAllListingDomains();
    expect(domains).toContain('funda.nl');
    expect(domains).toContain('rightmove.co.uk');
    expect(domains).toContain('immobilienscout24.de');
  });
});

describe('getCountryForDomain', () => {
  it('maps funda.nl → NL', () => {
    expect(getCountryForDomain('funda.nl')).toBe('NL');
  });

  it('maps www.funda.nl → NL (subdomain)', () => {
    expect(getCountryForDomain('www.funda.nl')).toBe('NL');
  });

  it('maps rightmove.co.uk → GB', () => {
    expect(getCountryForDomain('rightmove.co.uk')).toBe('GB');
  });

  it('maps immobilienscout24.de → DE', () => {
    expect(getCountryForDomain('immobilienscout24.de')).toBe('DE');
  });

  it('returns undefined for unknown domain', () => {
    expect(getCountryForDomain('evil.com')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(getCountryForDomain('FUNDA.NL')).toBe('NL');
  });
});

describe('projectionSrid', () => {
  const expectedSrids: { code: CountryCode; srid: number }[] = [
    { code: 'NL', srid: 28992 },
    { code: 'DE', srid: 25832 },
    { code: 'GB', srid: 27700 },
    { code: 'FR', srid: 2154 },
    { code: 'IT', srid: 6875 },
    { code: 'ES', srid: 25830 },
  ];

  for (const { code, srid } of expectedSrids) {
    it(`${code} → EPSG:${srid}`, () => {
      expect(getCountryConfig(code).projectionSrid).toBe(srid);
    });
  }
});

describe('isValidCountryCode', () => {
  it('returns true for valid codes', () => {
    expect(isValidCountryCode('NL')).toBe(true);
    expect(isValidCountryCode('DE')).toBe(true);
    expect(isValidCountryCode('GB')).toBe(true);
  });

  it('returns false for invalid codes', () => {
    expect(isValidCountryCode('XX')).toBe(false);
    expect(isValidCountryCode('nl')).toBe(false);
    expect(isValidCountryCode('')).toBe(false);
  });
});

describe('price guess helpers', () => {
  it('uses NL postcode4 after postal-code normalization', () => {
    expect(getPriceGuessPostalScope('NL', '1234AB')).toBe('1234');
    expect(getPriceGuessPostalScope('NL', '1234 ab')).toBe('1234');
  });

  it('skips postal scope for unsupported country prefix rules', () => {
    expect(getPriceGuessPostalScope('DE', '10115')).toBeNull();
    expect(getPriceGuessPostalScope('GB', 'SW1A 1AA')).toBeNull();
  });

  it('skips malformed or missing postal codes', () => {
    expect(getPriceGuessPostalScope('NL', '123')).toBeNull();
    expect(getPriceGuessPostalScope('NL', null)).toBeNull();
  });

  it('uses the configured conservative country default', () => {
    expect(getCountryDefaultGuessStart('NL')).toBe(350_000);
    expect(getCountryDefaultGuessStart('DE')).toBe(350_000);
  });
});

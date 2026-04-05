import { describe, it, expect } from 'vitest';
import {
  validatePostalCode,
  normalizePostalCode,
  postalCodeSchemaForCountry,
  feedQuerySchema,
  propertyFeedFilterSchema,
} from '../utils/validation';

// ---------------------------------------------------------------------------
// validatePostalCode
// ---------------------------------------------------------------------------

describe('validatePostalCode', () => {
  describe('NL (default)', () => {
    it('accepts "1234AB"', () => {
      expect(validatePostalCode('1234AB')).toBe(true);
    });

    it('accepts "1234 AB" (with space)', () => {
      expect(validatePostalCode('1234 AB')).toBe(true);
    });

    it('accepts lowercase "1234ab"', () => {
      expect(validatePostalCode('1234ab')).toBe(true);
    });

    it('rejects "123AB" (too few digits)', () => {
      expect(validatePostalCode('123AB')).toBe(false);
    });

    it('rejects "12345" (no letters)', () => {
      expect(validatePostalCode('12345')).toBe(false);
    });
  });

  describe('DE', () => {
    it('accepts "10115"', () => {
      expect(validatePostalCode('10115', 'DE')).toBe(true);
    });

    it('rejects "1011" (too few digits)', () => {
      expect(validatePostalCode('1011', 'DE')).toBe(false);
    });
  });

  describe('GB', () => {
    it('accepts "SW1A 1AA"', () => {
      expect(validatePostalCode('SW1A 1AA', 'GB')).toBe(true);
    });

    it('accepts "EC1A1BB" (no space)', () => {
      expect(validatePostalCode('EC1A1BB', 'GB')).toBe(true);
    });

    it('accepts lowercase "sw1a 1aa"', () => {
      expect(validatePostalCode('sw1a 1aa', 'GB')).toBe(true);
    });

    it('rejects "12345"', () => {
      expect(validatePostalCode('12345', 'GB')).toBe(false);
    });
  });

  describe('BE', () => {
    it('accepts "1000"', () => {
      expect(validatePostalCode('1000', 'BE')).toBe(true);
    });

    it('rejects "10000" (too many digits)', () => {
      expect(validatePostalCode('10000', 'BE')).toBe(false);
    });
  });

  describe('PL', () => {
    it('accepts "00-001"', () => {
      expect(validatePostalCode('00-001', 'PL')).toBe(true);
    });

    it('accepts "00001" (without hyphen)', () => {
      expect(validatePostalCode('00001', 'PL')).toBe(true);
    });
  });

  describe('IE', () => {
    it('accepts "D02AF30"', () => {
      expect(validatePostalCode('D02AF30', 'IE')).toBe(true);
    });

    it('accepts "D02 AF30" (with space)', () => {
      expect(validatePostalCode('D02 AF30', 'IE')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizePostalCode
// ---------------------------------------------------------------------------

describe('normalizePostalCode', () => {
  it('NL: "1234AB" → "1234 AB"', () => {
    expect(normalizePostalCode('1234AB')).toBe('1234 AB');
  });

  it('NL: "1234 ab" → "1234 AB"', () => {
    expect(normalizePostalCode('1234 ab')).toBe('1234 AB');
  });

  it('GB: "SW1A1AA" → "SW1A 1AA"', () => {
    expect(normalizePostalCode('SW1A1AA', 'GB')).toBe('SW1A 1AA');
  });

  it('DE: "10115" passes through', () => {
    expect(normalizePostalCode('10115', 'DE')).toBe('10115');
  });

  it('PL: "00001" → "00-001"', () => {
    expect(normalizePostalCode('00001', 'PL')).toBe('00-001');
  });

  it('IE: "D02AF30" → "D02 AF30"', () => {
    expect(normalizePostalCode('D02AF30', 'IE')).toBe('D02 AF30');
  });

  it('defaults to NL', () => {
    expect(normalizePostalCode('5658DP')).toBe('5658 DP');
  });
});

// ---------------------------------------------------------------------------
// postalCodeSchemaForCountry
// ---------------------------------------------------------------------------

describe('postalCodeSchemaForCountry', () => {
  it('NL schema accepts "1234AB"', () => {
    const schema = postalCodeSchemaForCountry('NL');
    expect(schema.safeParse('1234AB').success).toBe(true);
  });

  it('NL schema accepts "1234 AB"', () => {
    const schema = postalCodeSchemaForCountry('NL');
    expect(schema.safeParse('1234 AB').success).toBe(true);
  });

  it('NL schema rejects "12345"', () => {
    const schema = postalCodeSchemaForCountry('NL');
    expect(schema.safeParse('12345').success).toBe(false);
  });

  it('DE schema accepts "10115"', () => {
    const schema = postalCodeSchemaForCountry('DE');
    expect(schema.safeParse('10115').success).toBe(true);
  });

  it('DE schema rejects "1234AB"', () => {
    const schema = postalCodeSchemaForCountry('DE');
    expect(schema.safeParse('1234AB').success).toBe(false);
  });

  it('GB schema accepts "SW1A 1AA"', () => {
    const schema = postalCodeSchemaForCountry('GB');
    expect(schema.safeParse('SW1A 1AA').success).toBe(true);
  });

  it('GB schema rejects "12345"', () => {
    const schema = postalCodeSchemaForCountry('GB');
    expect(schema.safeParse('12345').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// feedQuerySchema
// ---------------------------------------------------------------------------

describe('feedQuerySchema', () => {
  it('accepts the canonical property feed query shape', () => {
    const parsed = feedQuerySchema.safeParse({
      filter: 'latest',
      page: '2',
      limit: '10',
      lat: '52.37',
      lon: '4.89',
      country: 'nl',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        filter: 'latest',
        page: 2,
        limit: 10,
        lat: 52.37,
        lon: 4.89,
        country: 'NL',
      });
    }
  });

  it('rejects obsolete feed filters', () => {
    expect(feedQuerySchema.safeParse({ filter: 'new' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ filter: 'controversial' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ filter: 'overpriced' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ filter: 'underpriced' }).success).toBe(false);
  });

  it('exports the canonical property feed filter enum', () => {
    expect(propertyFeedFilterSchema.options).toEqual(['trending', 'latest']);
  });
});

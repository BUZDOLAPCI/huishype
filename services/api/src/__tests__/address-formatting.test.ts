import { describe, it, expect } from '@jest/globals';
import { formatAddition, formatDisplayAddress, canonicalizeAddress } from '../utils/address.js';

describe('formatAddition', () => {
  it('returns empty string for null', () => {
    expect(formatAddition(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatAddition(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatAddition('')).toBe('');
  });

  it('concatenates single uppercase letter directly (no separator)', () => {
    expect(formatAddition('A')).toBe('A');
    expect(formatAddition('B')).toBe('B');
    expect(formatAddition('Z')).toBe('Z');
  });

  it('uses hyphen for numeric additions', () => {
    expect(formatAddition('1')).toBe('-1');
    expect(formatAddition('2')).toBe('-2');
    expect(formatAddition('10')).toBe('-10');
  });

  it('uses hyphen for multi-character additions', () => {
    expect(formatAddition('BIS')).toBe('-BIS');
    expect(formatAddition('HS')).toBe('-HS');
    expect(formatAddition('3A')).toBe('-3A');
  });

  it('uses hyphen for lowercase single letter (additions are uppercased upstream)', () => {
    // normalizeAddition() uppercases, but if somehow a lowercase sneaks through
    expect(formatAddition('a')).toBe('-a');
  });
});

describe('formatDisplayAddress', () => {
  it('formats address with no addition', () => {
    expect(
      formatDisplayAddress({
        street: 'Keizersgracht',
        houseNumber: 100,
        houseNumberAddition: null,
        postalCode: '1015AA',
        city: 'Amsterdam',
      })
    ).toBe('Keizersgracht 100, 1015AA Amsterdam');
  });

  it('formats address with single letter addition (no separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'Reehorst',
        houseNumber: 13,
        houseNumberAddition: 'A',
        postalCode: '5658DP',
        city: 'Eindhoven',
      })
    ).toBe('Reehorst 13A, 5658DP Eindhoven');
  });

  it('formats address with numeric addition (hyphen separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'De Ruijterkade',
        houseNumber: 105,
        houseNumberAddition: '1',
        postalCode: '1011AB',
        city: 'Amsterdam',
      })
    ).toBe('De Ruijterkade 105-1, 1011AB Amsterdam');
  });

  it('formats address with multi-char addition (hyphen separator)', () => {
    expect(
      formatDisplayAddress({
        street: 'Dorpstraat',
        houseNumber: 7,
        houseNumberAddition: 'BIS',
        postalCode: '3500AA',
        city: 'Utrecht',
      })
    ).toBe('Dorpstraat 7-BIS, 3500AA Utrecht');
  });

  it('formats address with empty string addition (treated as no addition)', () => {
    expect(
      formatDisplayAddress({
        street: 'Dorpstraat',
        houseNumber: 7,
        houseNumberAddition: '',
        postalCode: '3500AA',
        city: 'Utrecht',
      })
    ).toBe('Dorpstraat 7, 3500AA Utrecht');
  });

  it('formats address without street', () => {
    expect(
      formatDisplayAddress({
        street: '',
        houseNumber: 42,
        houseNumberAddition: null,
        postalCode: '1234AB',
        city: 'TestCity',
      })
    ).toBe('42, 1234AB TestCity');
  });

  it('formats address without street but with numeric addition', () => {
    expect(
      formatDisplayAddress({
        street: '',
        houseNumber: 42,
        houseNumberAddition: '3',
        postalCode: '1234AB',
        city: 'TestCity',
      })
    ).toBe('42-3, 1234AB TestCity');
  });
});

describe('formatDisplayAddress with countryCode', () => {
  it('NL default: "Straat 13A, 1234AB Amsterdam"', () => {
    expect(
      formatDisplayAddress({
        street: 'Straat',
        houseNumber: 13,
        houseNumberAddition: 'A',
        postalCode: '1234AB',
        city: 'Amsterdam',
      })
    ).toBe('Straat 13A, 1234AB Amsterdam');
  });

  it('NL explicit: same as default', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Straat',
          houseNumber: 13,
          houseNumberAddition: 'A',
          postalCode: '1234AB',
          city: 'Amsterdam',
        },
        'NL',
      )
    ).toBe('Straat 13A, 1234AB Amsterdam');
  });

  it('GB: "13A High Street, London, SW1A 1AA"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'High Street',
          houseNumber: 13,
          houseNumberAddition: 'A',
          postalCode: 'SW1A 1AA',
          city: 'London',
        },
        'GB',
      )
    ).toBe('13A High Street, London, SW1A 1AA');
  });

  it('DE: "Hauptstraße 13A, 10115 Berlin"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Hauptstraße',
          houseNumber: 13,
          houseNumberAddition: 'A',
          postalCode: '10115',
          city: 'Berlin',
        },
        'DE',
      )
    ).toBe('Hauptstraße 13A, 10115 Berlin');
  });

  it('FR: "13A Rue de Rivoli, 75001 Paris"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Rue de Rivoli',
          houseNumber: 13,
          houseNumberAddition: 'A',
          postalCode: '75001',
          city: 'Paris',
        },
        'FR',
      )
    ).toBe('13A Rue de Rivoli, 75001 Paris');
  });

  it('IT: "Via Roma, 13A, 00100 Roma"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Via Roma',
          houseNumber: 13,
          houseNumberAddition: 'A',
          postalCode: '00100',
          city: 'Roma',
        },
        'IT',
      )
    ).toBe('Via Roma, 13A, 00100 Roma');
  });

  it('IE: British-style — "10 Grafton Street, Dublin, D02 AF30"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Grafton Street',
          houseNumber: 10,
          houseNumberAddition: null,
          postalCode: 'D02 AF30',
          city: 'Dublin',
        },
        'IE',
      )
    ).toBe('10 Grafton Street, Dublin, D02 AF30');
  });

  it('ES: Southern European-style — "Calle Mayor, 5, 28013 Madrid"', () => {
    expect(
      formatDisplayAddress(
        {
          street: 'Calle Mayor',
          houseNumber: 5,
          houseNumberAddition: null,
          postalCode: '28013',
          city: 'Madrid',
        },
        'ES',
      )
    ).toBe('Calle Mayor, 5, 28013 Madrid');
  });
});

describe('formatAddition is NL-specific', () => {
  it('applies Dutch separator convention (single letter = no separator)', () => {
    expect(formatAddition('A')).toBe('A');
  });

  it('applies Dutch separator convention (multi-char = hyphen)', () => {
    expect(formatAddition('BIS')).toBe('-BIS');
  });

  it('non-NL formatDisplayAddress does not use Dutch separator', () => {
    // GB style: addition is concatenated directly by country config
    const result = formatDisplayAddress(
      {
        street: 'High Street',
        houseNumber: 105,
        houseNumberAddition: '1',
        postalCode: 'SW1A 1AA',
        city: 'London',
      },
      'GB',
    );
    // GB puts houseNumber first, then addition directly (no hyphen)
    expect(result).toBe('1051 High Street, London, SW1A 1AA');
  });
});

describe('canonicalizeAddress', () => {
  it('normalizes NL postal code by default', () => {
    const result = canonicalizeAddress({
      street: 'Kalverstraat',
      houseNumber: '1',
      postalCode: '1012 NX',
      city: 'Amsterdam',
    });
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe('1012NX');
  });

  it('returns null for invalid NL postal code', () => {
    const result = canonicalizeAddress({
      street: 'Kalverstraat',
      houseNumber: '1',
      postalCode: '12345',
      city: 'Amsterdam',
    });
    expect(result).toBeNull();
  });

  it('accepts DE postal code with countryCode DE', () => {
    const result = canonicalizeAddress({
      street: 'Friedrichstraße',
      houseNumber: '43',
      postalCode: '10117',
      city: 'Berlin',
      countryCode: 'DE',
    });
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe('10117');
  });

  it('rejects NL postal code when countryCode is DE', () => {
    const result = canonicalizeAddress({
      street: 'Friedrichstraße',
      houseNumber: '43',
      postalCode: '1012NX',
      city: 'Berlin',
      countryCode: 'DE',
    });
    expect(result).toBeNull();
  });

  it('accepts GB postal code with countryCode GB', () => {
    const result = canonicalizeAddress({
      street: 'Downing Street',
      houseNumber: '10',
      postalCode: 'SW1A1AA',
      city: 'London',
      countryCode: 'GB',
    });
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe('SW1A1AA');
  });

  it('returns null for empty postal code', () => {
    const result = canonicalizeAddress({
      street: 'Kalverstraat',
      houseNumber: '1',
      postalCode: '',
      city: 'Amsterdam',
    });
    expect(result).toBeNull();
  });

  it('returns null for non-numeric source house numbers', () => {
    const result = canonicalizeAddress({
      street: 'Kalverstraat',
      houseNumber: 'None',
      postalCode: '1012 NX',
      city: 'Amsterdam',
    });
    expect(result).toBeNull();
  });

  it('returns null for empty source house numbers', () => {
    const result = canonicalizeAddress({
      street: 'Kalverstraat',
      houseNumber: '',
      postalCode: '1012 NX',
      city: 'Amsterdam',
    });
    expect(result).toBeNull();
  });
});
